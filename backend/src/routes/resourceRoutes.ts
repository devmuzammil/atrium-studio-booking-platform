import { Router } from 'express';
import { getBooking, getRoom } from '../controllers/resourceController';
import { searchRooms } from '../controllers/roomSearchController';
import { authenticate, AuthDependencies } from '../middleware/auth';
import { createHold } from '../controllers/bookingHoldController';

export function createResourceRoutes(authDependencies?: AuthDependencies): Router {
  const router = Router();
  router.use(authenticate(authDependencies));
  router.get('/venues/search', searchRooms);
  router.post('/bookings/holds', createHold);
  router.get('/bookings/:id', getBooking);
  router.get('/rooms/:id', getRoom);
  return router;
}