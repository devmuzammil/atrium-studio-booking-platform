import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBookings } from '../api/bookings';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { BookingListItem } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Alert, EmptyState, LoadingSpinner } from '../components/ui';
import { formatDateTime, formatMoney } from '../utils/format';

export function BookingsPage() {
  const { primaryRole, venueIds } = useAuth();
  const [bookings, setBookings] = useState<BookingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const venueScoped = primaryRole === 'VENUE_ADMIN' || primaryRole === 'VENUE_STAFF';

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      setError(null);
      try {
        const result = await listBookings(
          venueScoped && venueIds[0] ? { venueId: venueIds[0] } : undefined,
        );
        if (!cancelled) setBookings(result.bookings);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Unable to load bookings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [venueScoped, venueIds]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h2 className="text-3xl font-semibold text-slate-900">
          {primaryRole === 'CUSTOMER' ? 'My Bookings' : 'Bookings'}
        </h2>
        <p className="mt-1 text-slate-600">Review your reservations, payment status, and upcoming studio sessions.</p>
      </header>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {loading ? <LoadingSpinner /> : null}
      {!loading && bookings.length === 0 ? <EmptyState title="No bookings yet" detail="Create a hold from Find a Studio." /> : null}

      <div className="overflow-x-auto rounded-2xl border border-[#d9d2c5] bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-[#f7f4ef] text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Room</th>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Payment</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id} className="border-t border-[#ece7de]">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{booking.roomName}</p>
                  <p className="text-xs text-slate-500">{booking.venueName} · {booking.city}</p>
                </td>
                <td className="px-4 py-3 text-slate-700">
                  <p>{formatDateTime(booking.start)}</p>
                  <p className="text-xs text-slate-500">to {formatDateTime(booking.end)}</p>
                </td>
                <td className="px-4 py-3"><StatusBadge status={booking.status} /></td>
                <td className="px-4 py-3 text-slate-700">{booking.paymentStatus ?? '—'}</td>
                <td className="px-4 py-3 font-medium">{formatMoney(booking.amountMinor, booking.currency)}</td>
                <td className="px-4 py-3 text-right">
                  <Link to={`/bookings/${booking.id}`} className="text-[#c45c26] hover:underline">Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
