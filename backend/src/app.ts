import express, { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { prisma } from './config/prisma';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createResourceRoutes } from './routes/resourceRoutes';
import { AuthDependencies } from './middleware/auth';
import { createPaymentRoutes } from './routes/paymentRoutes';
import { PaymentProvider } from './services/paymentService';
import { requestContext } from './middleware/requestContext';
import { createAuthRoutes } from './controllers/authController';

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
  app.set('trust proxy', 1);
  const database = dependencies.database || (prisma as unknown as PrismaClient & HealthDatabase);
  const paygateHealth = dependencies.paygateHealth || prisma.paygateCharge;
  const instanceId = process.env.INSTANCE_ID || 'local';
  const corsOrigin = process.env.CORS_ORIGIN?.trim();

  app.use((request, response, next) => {
    const origin = request.header('origin');
    if (!corsOrigin || corsOrigin === '*' || !origin || origin === corsOrigin) {
      response.setHeader('Access-Control-Allow-Origin', corsOrigin && corsOrigin !== '*' && origin ? origin : '*');
    }
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-Request-ID');
    response.setHeader('Access-Control-Expose-Headers', 'x-request-id, x-instance-id');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({
    verify: (request, _response, buffer) => {
      (request as RawBodyRequest).rawBody = Buffer.from(buffer);
    },
  }));
  app.use(requestContext);

  app.use('/api/auth', createAuthRoutes(dependencies.auth));
  app.use(createPaymentRoutes(dependencies.auth, dependencies.paymentProvider));
  app.use('/api', createResourceRoutes(dependencies.auth));

  app.get('/health', async (_request, response) => {
    try {
      await database.$queryRaw`SELECT 1`;
      await paygateHealth.count();
      response.setHeader('x-instance-id', instanceId);
      response.status(200).json({ status: 'ok', dependencies: { postgres: 'ok', paygate: 'ok' } });
    } catch (error) {
      response.setHeader('x-instance-id', instanceId);
      response.status(503).json({ status: 'unhealthy', dependencies: { postgres: 'unavailable', paygate: 'unavailable' } });
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
