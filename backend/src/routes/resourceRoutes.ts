import { Router } from 'express';
import {
  getBooking,
  getRoom,
  getRoomAvailabilityWindow,
  getVenuePolicy,
  listManagedRooms,
  createManagedRoom,
  updateManagedRoom,
  deleteManagedRoom,
  createManagedEquipment,
  updateManagedEquipment,
  deleteManagedEquipment,
  listBookings,
  listVenueEquipment,
  putVenuePolicy,
  startCheckout,
} from '../controllers/resourceController';
import { searchRooms } from '../controllers/roomSearchController';
import { authenticate, AuthDependencies } from '../middleware/auth';
import { createHold } from '../controllers/bookingHoldController';

export function createResourceRoutes(authDependencies?: AuthDependencies): Router {
  const router = Router();
  router.use(authenticate(authDependencies));
  router.get('/venues/search', searchRooms);
  router.get('/venues/:venueId/equipment', listVenueEquipment);
  router.get('/venues/:venueId/cancellation-policy', getVenuePolicy);
  router.put('/venues/:venueId/cancellation-policy', putVenuePolicy);
  router.post('/bookings/holds', createHold);
  router.post('/bookings/:id/checkout', startCheckout);
  router.get('/bookings', listBookings);
  router.get('/bookings/:id', getBooking);
  router.get('/rooms/:id/availability', getRoomAvailabilityWindow);
  router.get('/rooms/:id', getRoom);
  router.get('/venues/:venueId/rooms', listManagedRooms);
  router.post('/venues/:venueId/rooms', createManagedRoom);
  router.patch('/rooms/:id', updateManagedRoom);
  router.delete('/rooms/:id', deleteManagedRoom);
  router.post('/venues/:venueId/equipment', createManagedEquipment);
  router.patch('/equipment/:id', updateManagedEquipment);
  router.delete('/equipment/:id', deleteManagedEquipment);
  return router;
}
