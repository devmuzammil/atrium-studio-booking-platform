import { Router } from 'express';
import { receivePaygateWebhook, startBookingPayment } from '../controllers/paymentController';
import { authenticate, AuthDependencies } from '../middleware/auth';
import { postCharge, postRefund } from '../controllers/paygateController';
import { PaymentProvider, localPaymentProvider } from '../services/paymentService';
import { prisma } from '../config/prisma';

export function createPaymentRoutes(authDependencies?: AuthDependencies, paymentProvider?: PaymentProvider): Router {
  const router = Router();
  const provider = paymentProvider || localPaymentProvider(prisma);
  router.post('/paygate/charges', postCharge);
  router.post('/paygate/refunds', postRefund);
  router.post('/api/paygate/webhook', (request, response, next) => receivePaygateWebhook(request, response, next, provider));
  router.use('/api', authenticate(authDependencies));
  router.post('/api/bookings/:id/payment', (request, response, next) => startBookingPayment(request, response, next, provider));
  return router;
}
