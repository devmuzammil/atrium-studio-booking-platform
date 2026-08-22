import { app } from './app';
import { getConfig } from './config/env';
import { prisma } from './config/prisma';

async function startServer(): Promise<void> {
  const config = getConfig();

  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;

  const server = app.listen(config.port, () => {
    console.log(`Atrium API listening on port ${config.port}`);
  });

  const shutdown = async (): Promise<void> => {
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
