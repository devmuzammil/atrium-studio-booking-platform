import express, { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { prisma } from './config/prisma';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createResourceRoutes } from './routes/resourceRoutes';
import { AuthDependencies } from './middleware/auth';

export interface HealthDatabase {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

interface AppDependencies {
  database?: HealthDatabase;
  auth?: AuthDependencies;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const database = dependencies.database || (prisma as unknown as PrismaClient & HealthDatabase);

  app.use(express.json());

  app.use('/api', createResourceRoutes(dependencies.auth));

  app.get('/health', async (_request, response, next) => {
    try {
      await database.$queryRaw`SELECT 1`;
      response.status(200).json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
