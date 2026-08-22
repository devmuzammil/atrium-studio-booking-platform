export type UserRole = 'CUSTOMER' | 'VENUE_STAFF' | 'VENUE_ADMIN' | 'PLATFORM_ADMIN';

export type BookingStatus =
  | 'DRAFT'
  | 'HELD'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED';

export type PaymentStatus =
  | 'CREATED'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export interface RoleAssignment {
  role: UserRole;
  venueId: string;
}

export interface User {
  id: string;
  email: string;
  roles: RoleAssignment[];
}

export interface AvailableRoom {
  id: string;
  venueId: string;
  venueName: string;
  city: string;
  name: string;
  capacity: number;
  hourlyRateMinor: number;
  currency: string;
  amenities: string[] | unknown;
}

export interface EquipmentType {
  id: string;
  venueId: string;
  name: string;
  hourlyRateMinor: number;
  currency: string;
  totalUnits: number;
  overbookingPercent: number;
}

export interface BookingLineItem {
  id: string;
  equipmentTypeId: string;
  quantity: number;
  unitRateMinor: number;
  currency: string;
  equipmentName: string;
}

export interface PaymentSummary {
  id: string;
  status: PaymentStatus | string;
  amountMinor: number;
  currency: string;
  providerChargeId: string | null;
  createdAt: string;
}

export interface RefundSummary {
  id: string;
  status: PaymentStatus | string;
  amountMinor: number;
  currency: string;
  providerRefundId: string | null;
  createdAt: string;
}

export interface BookingDetail {
  id: string;
  userId: string;
  roomId: string;
  status: BookingStatus | string;
  amountMinor: number;
  currency: string;
  holdExpiresAt: string | null;
  checkoutDeadline: string | null;
  createdAt: string;
  updatedAt: string;
  start: string;
  end: string;
  room: {
    id: string;
    name: string;
    capacity: number;
    hourlyRateMinor: number;
    venueId: string;
    venueName: string;
    city: string;
  };
  lineItems: BookingLineItem[];
  payments: PaymentSummary[];
  refunds: RefundSummary[];
}

export interface BookingListItem {
  id: string;
  userId: string;
  roomId: string;
  status: BookingStatus | string;
  amountMinor: number;
  currency: string;
  holdExpiresAt: string | null;
  start: string;
  end: string;
  roomName: string;
  venueId: string;
  venueName: string;
  city: string;
  paymentStatus: string | null;
}

export interface CreatedHold {
  id: string;
  status: BookingStatus | string;
  holdExpiresAt: string;
  checkoutDeadline: string;
  amountMinor: number;
  currency: string;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
}

export interface ReconciliationReport {
  discrepancies: Array<Record<string, unknown>>;
  capturedCharges: number;
}

export interface VenueReportRow {
  venueId: string;
  venueName: string;
  revenueMinor: number;
  confirmedBookings: number;
  bookedMinutes: number;
}
