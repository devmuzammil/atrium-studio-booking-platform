import express, { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { prisma } from './config/prisma';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createResourceRoutes } from './routes/resourceRoutes';
import { AuthDependencies } from './middleware/auth';
import { createPaymentRoutes } from './routes/paymentRoutes';
import { PaymentProvider } from './services/paymentService';
import { requestContext } from './middleware/requestContext';

export interface HealthDatabase {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

export interface RawBodyRequest extends express.Request {
  rawBody?: Buffer;
}

interface AppDependencies {
  database?: HealthDatabase;
  auth?: AuthDependencies;
  paymentProvider?: PaymentProvider;
  paygateHealth?: { count: () => Promise<number> };
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const database = dependencies.database || (prisma as unknown as PrismaClient & HealthDatabase);
  const paygateHealth = dependencies.paygateHealth || prisma.paygateCharge;

  app.use(express.json({
    verify: (request, _response, buffer) => {
      (request as RawBodyRequest).rawBody = Buffer.from(buffer);
    },
  }));
  app.use(requestContext);

  app.use(createPaymentRoutes(dependencies.auth, dependencies.paymentProvider));
  app.use('/api', createResourceRoutes(dependencies.auth));

  app.get('/health', async (_request, response, next) => {
    try {
      await database.$queryRaw`SELECT 1`;
      await paygateHealth.count();
      response.status(200).json({ status: 'ok', dependencies: { postgres: 'ok', paygate: 'ok' } });
    } catch (error) {
      response.status(503).json({ status: 'unhealthy', dependencies: { postgres: 'unavailable', paygate: 'unavailable' } });
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
