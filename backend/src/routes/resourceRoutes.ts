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
  getVenueConfiguration,
  updateVenueConfiguration,
  listVenueStaff,
  addVenueStaff,
  removeVenueStaff,
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
  router.get('/venues/:venueId/configuration', getVenueConfiguration);
  router.patch('/venues/:venueId/configuration', updateVenueConfiguration);
  router.get('/venues/:venueId/staff', listVenueStaff);
  router.post('/venues/:venueId/staff', addVenueStaff);
  router.delete('/venues/:venueId/staff/:id', removeVenueStaff);
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
