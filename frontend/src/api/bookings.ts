import { apiRequest } from './client';
import type {
  AvailableRoom,
  BookingDetail,
  BookingListItem,
  CreatedHold,
  EquipmentType,
  ReconciliationReport,
  VenueReportRow,
} from '../types';

export interface SearchParams {
  start: string;
  end: string;
  city?: string;
  minCapacity?: number;
  amenities?: string;
  maxPrice?: number;
}

export async function searchRooms(params: SearchParams): Promise<{ rooms: AvailableRoom[] }> {
  const query = new URLSearchParams({ start: params.start, end: params.end });
  if (params.city) query.set('city', params.city);
  if (params.minCapacity !== undefined) query.set('minCapacity', String(params.minCapacity));
  if (params.amenities) query.set('amenities', params.amenities);
  if (params.maxPrice !== undefined) query.set('maxPrice', String(params.maxPrice));
  return apiRequest(`/api/venues/search?${query.toString()}`);
}

export async function listEquipment(venueId: string): Promise<{ equipment: EquipmentType[] }> {
  return apiRequest(`/api/venues/${venueId}/equipment`);
}

export async function createHold(input: {
  roomId: string;
  start: string;
  end: string;
  equipment: Array<{ equipmentTypeId: string; quantity: number }>;
}): Promise<{ booking: CreatedHold }> {
  return apiRequest('/api/bookings/holds', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listBookings(params?: {
  venueId?: string;
  status?: string;
}): Promise<{ bookings: BookingListItem[] }> {
  const query = new URLSearchParams();
  if (params?.venueId) query.set('venueId', params.venueId);
  if (params?.status) query.set('status', params.status);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/api/bookings${suffix}`);
}

export async function getBooking(id: string): Promise<BookingDetail> {
  return apiRequest(`/api/bookings/${id}`);
}

export async function getRoomAvailability(roomId: string, start: string, end: string): Promise<{
  roomId: string;
  start: string;
  end: string;
  available: boolean;
  busy: Array<{ start: string; end: string; status: string }>;
}> {
  const query = new URLSearchParams({ start, end });
  return apiRequest(`/api/rooms/${roomId}/availability?${query.toString()}`);
}

export async function beginCheckout(bookingId: string): Promise<{
  booking: { id: string; status: string; holdExpiresAt: string; checkoutDeadline: string };
}> {
  return apiRequest(`/api/bookings/${bookingId}/checkout`, { method: 'POST' });
}

export async function startPayment(bookingId: string, idempotencyKey: string): Promise<{ payment: unknown }> {
  return apiRequest(`/api/bookings/${bookingId}/payment`, {
    method: 'POST',
    idempotencyKey,
  });
}

export async function cancelBooking(bookingId: string): Promise<{
  bookingId: string;
  status: string;
  refundAmountMinor: number;
}> {
  return apiRequest(`/api/bookings/${bookingId}/cancel`, {
    method: 'POST',
  });
}

export async function getReconciliation(venueId?: string): Promise<ReconciliationReport> {
  const query = venueId ? `?venueId=${encodeURIComponent(venueId)}` : '';
  return apiRequest(`/api/reports/reconciliation${query}`);
}

export async function getRevenueReport(params?: {
  venueId?: string;
  start?: string;
  end?: string;
}): Promise<{ venues: VenueReportRow[] }> {
  const query = new URLSearchParams();
  if (params?.venueId) query.set('venueId', params.venueId);
  if (params?.start) query.set('start', params.start);
  if (params?.end) query.set('end', params.end);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest(`/api/reports/revenue${suffix}`);
}

export async function getVenuePolicy(venueId: string): Promise<{ policy: { venueId: string; version: number; tiers: unknown } }> {
  return apiRequest(`/api/venues/${venueId}/cancellation-policy`);
}

export async function updateVenuePolicy(
  venueId: string,
  tiers: unknown,
): Promise<{ policy: { venueId: string; version: number; tiers: unknown } }> {
  return apiRequest(`/api/venues/${venueId}/cancellation-policy`, {
    method: 'PUT',
    body: JSON.stringify({ tiers }),
  });
}

export async function getVenueConfiguration(venueId: string): Promise<{ venue: { id: string; name: string; city: string; timezone: string; operatingSchedule: unknown } }> {
  return apiRequest(`/api/venues/${venueId}/configuration`);
}

export async function updateVenueConfiguration(venueId: string, input: { name: string; city: string; timezone: string; operatingSchedule: unknown }): Promise<{ venue: { id: string; name: string; city: string; timezone: string; operatingSchedule: unknown } }> {
  return apiRequest(`/api/venues/${venueId}/configuration`, { method: 'PATCH', body: JSON.stringify(input) });
}

export async function listVenueStaff(venueId: string): Promise<{ staff: Array<{ userId: string; email: string }> }> {
  return apiRequest(`/api/venues/${venueId}/staff`);
}

export async function addVenueStaff(venueId: string, email: string): Promise<{ staff: { userId: string; email: string } }> {
  return apiRequest(`/api/venues/${venueId}/staff`, { method: 'POST', body: JSON.stringify({ email }) });
}

export async function removeVenueStaff(venueId: string, userId: string): Promise<void> {
  return apiRequest(`/api/venues/${venueId}/staff/${userId}`, { method: 'DELETE' });
}

export interface ManagedVenue {
  id: string;
  name: string;
  city: string;
  timezone: string;
  operatingSchedule: unknown;
}

export async function listPlatformVenues(): Promise<{ venues: ManagedVenue[] }> { return apiRequest('/api/platform/venues'); }
export async function createPlatformVenue(input: Omit<ManagedVenue, 'id'>): Promise<{ venue: ManagedVenue }> { return apiRequest('/api/platform/venues', { method: 'POST', body: JSON.stringify(input) }); }
export async function updatePlatformVenue(id: string, input: Partial<Omit<ManagedVenue, 'id'>>): Promise<{ venue: ManagedVenue }> { return apiRequest(`/api/platform/venues/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export async function deletePlatformVenue(id: string): Promise<void> { return apiRequest(`/api/platform/venues/${id}`, { method: 'DELETE' }); }

export interface ManagedUser {
  id: string;
  email: string;
  roles: Array<{ role: string; venueId: string }>;
}

export async function listPlatformUsers(): Promise<{ users: ManagedUser[] }> { return apiRequest('/api/platform/users'); }
export async function createPlatformUser(input: { email: string; password: string; role: string; venueId: string }): Promise<{ user: ManagedUser }> { return apiRequest('/api/platform/users', { method: 'POST', body: JSON.stringify(input) }); }
export async function replacePlatformUserRoles(id: string, roles: Array<{ role: string; venueId: string }>): Promise<{ user: ManagedUser }> { return apiRequest(`/api/platform/users/${id}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) }); }

export interface ManagedRoom {
  id: string;
  venueId: string;
  name: string;
  capacity: number;
  hourlyRateMinor: number;
  currency: string;
  amenities: unknown;
  minDurationMinutes: number;
  maxDurationMinutes: number;
  overbookingPercent: number;
}

export interface ManagedEquipment {
  id: string;
  venueId: string;
  name: string;
  hourlyRateMinor: number;
  currency: string;
  totalUnits: number;
  overbookingPercent: number;
}

export async function listManagedRooms(venueId: string): Promise<{ rooms: ManagedRoom[] }> { return apiRequest(`/api/venues/${venueId}/rooms`); }
export async function createManagedRoom(venueId: string, input: Record<string, unknown>): Promise<{ room: ManagedRoom }> { return apiRequest(`/api/venues/${venueId}/rooms`, { method: 'POST', body: JSON.stringify(input) }); }
export async function updateManagedRoom(id: string, input: Record<string, unknown>): Promise<{ room: ManagedRoom }> { return apiRequest(`/api/rooms/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export async function deleteManagedRoom(id: string): Promise<void> { return apiRequest(`/api/rooms/${id}`, { method: 'DELETE' }); }
export async function listManagedEquipment(venueId: string): Promise<{ equipment: ManagedEquipment[] }> { return apiRequest(`/api/venues/${venueId}/equipment`); }
export async function createManagedEquipment(venueId: string, input: Record<string, unknown>): Promise<{ equipment: ManagedEquipment }> { return apiRequest(`/api/venues/${venueId}/equipment`, { method: 'POST', body: JSON.stringify(input) }); }
export async function updateManagedEquipment(id: string, input: Record<string, unknown>): Promise<{ equipment: ManagedEquipment }> { return apiRequest(`/api/equipment/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
export async function deleteManagedEquipment(id: string): Promise<void> { return apiRequest(`/api/equipment/${id}`, { method: 'DELETE' }); }

export async function getHealth(): Promise<{
  status: string;
  dependencies: Record<string, string>;
}> {
  return apiRequest('/health');
}
