import { app } from './app';
import { getConfig } from './config/env';
import { prisma } from './config/prisma';
import { expireDueHolds } from './services/holdExpiryService';

function startHoldExpiryLoop(): NodeJS.Timeout | null {
  if (process.env.RUN_WORKER === 'false') {
    console.log('Hold expiry worker disabled (RUN_WORKER=false)');
    return null;
  }

  const pollMs = Number(process.env.HOLD_EXPIRY_POLL_MS || 2000);
  const intervalMs = Number.isFinite(pollMs) && pollMs >= 500 ? pollMs : 2000;
  console.log(`Hold expiry worker polling every ${intervalMs}ms`);

  return setInterval(() => {
    void expireDueHolds(prisma).catch((error: unknown) => {
      console.error('Hold expiry poll failed:', error);
    });
  }, intervalMs);
}

async function startServer(): Promise<void> {
  const config = getConfig();

  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Atrium API listening on 0.0.0.0:${config.port}`);
  });

  const expiryTimer = startHoldExpiryLoop();

  const shutdown = async (): Promise<void> => {
    if (expiryTimer) {
      clearInterval(expiryTimer);
    }
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer().catch(async (error: unknown) => {
  console.error('Server startup failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
