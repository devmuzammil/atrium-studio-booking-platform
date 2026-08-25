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

export async function getHealth(): Promise<{
  status: string;
  dependencies: Record<string, string>;
}> {
  return apiRequest('/health');
}
