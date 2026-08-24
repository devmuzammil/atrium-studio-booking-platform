/**
 * Vercel serverless entrypoint for the Atrium Express API.
 *
 * This wraps the EXISTING Express app (exported from ../src/app, unchanged)
 * so it can run as a Vercel Function. It does NOT modify any backend source.
 *
 * Vercel has no long-lived process, so the 2s background worker in server.ts
 * does not run here. To preserve the assessment invariants we add two cheap,
 * safe substitutes inside this adapter only:
 *
 *   1. Lazy housekeeping middleware — before every request, expire due holds
 *      (HELD/PENDING_PAYMENT with hold_expires_at <= now -> EXPIRED) and mark
 *      finished CONFIRMED bookings COMPLETED. The two services are exactly the
 *      same batch functions the worker ran, using FOR UPDATE SKIP LOCKED so
 *      they are safe across concurrent serverless instances.
 *   2. A daily /api/cron endpoint (secure with CRON_SECRET) that runs the same
 *      sweep once a day as a catch-all for anything a burst missed (Hobby cron
 *      is limited to once per day).
 *
 * Raw-body handling: Vercel normally parses JSON bodies, which would break the
 * paygate webhook HMAC signature check (the app reads the raw buffer via
 * express.json's `verify`). We disable Vercel's body parser below so Express
 * receives the untouched request stream. Do NOT remove that config.
 *
 * The webhook/charge/refund/charge paths reach the same origin, so the
 * in-process paygate works unchanged: set PAYGATE_URL and PAYGATE_CALLBACK_URL
 * to this Function's public URL in the Vercel environment.
 */
import { app } from '../src/app';
import { prisma } from '../src/config/prisma';
import { expireDueHolds } from '../src/services/holdExpiryService';
import { completeDueBookings } from '../src/services/bookingCompletionService';

type NodeRequest = Parameters<typeof app>[0];
type NodeResponse = Parameters<typeof app>[1];

export const config = {
  runtime: 'nodejs',
  maxDuration: 30,
  api: { bodyParser: false },
};

async function runHousekeeping(): Promise<void> {
  try {
    await expireDueHolds(prisma);
  } catch (error) {
    console.error('Housekeeping expireDueHolds failed:', error);
  }
  try {
    await completeDueBookings(prisma);
  } catch (error) {
    console.error('Housekeeping completeDueBookings failed:', error);
  }
}

// Vercel rewrites /health -> /api/health and /paygate/* -> /api/paygate/* so
// they reach this function. Re-map those back to the paths Express already knows.
function normalizePath(url: string): string {
  if (url.startsWith('/api/health')) {
    return `/health${url.slice('/api/health'.length)}`;
  }
  if (url.startsWith('/api/paygate/')) {
    return `/paygate${url.slice('/api'.length)}`;
  }
  if (url.startsWith('/api/')) {
    return url;
  }
  if (url.startsWith('/auth/') || url.startsWith('/bookings') || url.startsWith('/venues/') || url.startsWith('/reports/')) {
    return `/api${url}`;
  }
  return url;
}

// Load-time registration of lazy housekeeping so the existing app object is
// untouched yet every request into Vercel runs the sweep first.
app.use(async (_req, _res, next) => {
  await runHousekeeping();
  next();
});

// Default handler for all /api/* requests, plus /health and /paygate/*
// rewrites, and the /api/cron scheduled sweep.
export default function handler(req: NodeRequest, res: NodeResponse): void {
  const url = req.url ?? '';

  // Vercel Cron (daily, Hobby max) hits /api/cron, which this fallback
  // function serves. Run the same housekeeping sweep as a safety net.
  if (url === '/api/cron' || url.startsWith('/api/cron?')) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization;
    if (secret && auth !== `Bearer ${secret}`) {
      res.statusCode = 401;
      res.end('Unauthorized');
      return;
    }
    void runHousekeeping().then(() => {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  req.url = normalizePath(url);
  app(req, res);
}