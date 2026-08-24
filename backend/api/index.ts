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
  return url;
}

// Load-time registration of lazy housekeeping so the existing app object is
// untouched yet every request into Vercel runs the sweep first.
app.use(async (_req, _res, next) => {
  await runHousekeeping();
  next();
});

// Default handler for all /api/* requests, plus the /health and /paygate/*
// rewrites.
export default function handler(req: NodeRequest, res: NodeResponse): void {
  req.url = normalizePath(req.url ?? '');
  app(req, res);
}

// Vercel cron target. Cron scheduler is once per day on the Hobby plan; the
// lazy middleware above handles real-time correctness, this is just a safety
// net. Optional CRON_SECRET authorization matches Vercel's recommendation.
export async function cron(
  req: NodeRequest,
  res: NodeResponse,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization;
  if (secret && auth !== `Bearer ${secret}`) {
    res.statusCode = 401;
    res.end('Unauthorized');
    return;
  }
  await runHousekeeping();
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true }));
}