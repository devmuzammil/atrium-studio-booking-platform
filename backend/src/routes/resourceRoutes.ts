import { Router } from 'express';
import { getBooking, getRoom } from '../controllers/resourceController';
import { authenticate, AuthDependencies } from '../middleware/auth';

export function createResourceRoutes(authDependencies?: AuthDependencies): Router {
  const router = Router();
  router.use(authenticate(authDependencies));
  router.get('/bookings/:id', getBooking);
  router.get('/rooms/:id', getRoom);
  return router;
}