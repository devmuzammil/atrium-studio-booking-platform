import { Router } from 'express';
import { receivePaygateWebhook, startBookingPayment } from '../controllers/paymentController';
import { authenticate, AuthDependencies } from '../middleware/auth';
import { postCharge, postRefund, requireInternalPaygateSignature } from '../controllers/paygateController';
import { PaymentProvider, localPaymentProvider } from '../services/paymentService';
import { prisma } from '../config/prisma';
import { reconciliationReport, venueReport } from '../controllers/reportController';
import { cancelBooking } from '../services/cancellationService';
import { requireAuthenticatedUser } from '../middleware/authorization';

export function createPaymentRoutes(authDependencies?: AuthDependencies, paymentProvider?: PaymentProvider): Router {
  const router = Router();
  const provider = paymentProvider || localPaymentProvider(prisma);
  router.post('/paygate/charges', requireInternalPaygateSignature, postCharge);
  router.post('/paygate/refunds', requireInternalPaygateSignature, postRefund);
  router.post('/api/paygate/webhook', (request, response, next) => receivePaygateWebhook(request, response, next, provider));
  router.use('/api', authenticate(authDependencies));
  router.post('/api/bookings/:id/payment', (request, response, next) => startBookingPayment(request, response, next, provider));
  router.post('/api/bookings/:id/cancel', async (request, response, next) => {
    try {
      const user = requireAuthenticatedUser(request).user;
      const id = request.params.id;
      if (!user || typeof id !== 'string') throw Object.assign(new Error('Invalid cancellation request'), { statusCode: 400 });
      const result = await cancelBooking(prisma, provider, id, user.id);
      response.json(result);
    } catch (error) { next(error); }
  });
  router.get('/api/reports/reconciliation', reconciliationReport);
  router.get('/api/reports/revenue', venueReport);
  return router;
}
