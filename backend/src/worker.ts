import { prisma } from './config/prisma';
import { getConfig } from './config/env';
import { expireDueHolds } from './services/holdExpiryService';

const pollIntervalMs = 1000;

async function runWorker(): Promise<void> {
  getConfig();
  await prisma.$connect();
  console.log('Atrium worker started');

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    stopping = true;
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  while (!stopping) {
    try {
      await expireDueHolds(prisma);
    } catch (error) {
      console.error('Hold expiry poll failed:', error);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

runWorker().catch(async (error: unknown) => {
  console.error('Worker startup failed:', error);
  await prisma.$disconnect();
  process.exit(1);
});
