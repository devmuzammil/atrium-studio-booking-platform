import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cancelBooking, getBooking } from '../api/bookings';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { BookingDetail } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Alert, LoadingSpinner } from '../components/ui';
import { formatDateTime, formatMoney, friendlyApiMessage } from '../utils/format';

export function BookingDetailPage() {
  const { bookingId } = useParams();
  const { user } = useAuth();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!bookingId) return;
    const detail = await getBooking(bookingId);
    setBooking(detail);
  }, [bookingId]);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (!bookingId) return;
      setLoading(true);
      setError(null);
      try {
        const detail = await getBooking(bookingId);
        if (!cancelled) setBooking(detail);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Unable to load booking');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  async function onCancel(): Promise<void> {
    if (!bookingId || !booking) return;
    const confirmed = window.confirm(
      `Cancel booking?\n\nThe refund amount is calculated by the backend policy. Continue?`,
    );
    if (!confirmed) return;
    setCancelling(true);
    setError(null);
    setMessage(null);
    try {
      const result = await cancelBooking(bookingId);
      setMessage(`Cancelled. Refund amount: ${formatMoney(result.refundAmountMinor, booking.currency)}. Status: ${result.status}`);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(friendlyApiMessage(err.status, err.message));
      } else {
        setError('Cancellation failed');
      }
    } finally {
      setCancelling(false);
    }
  }

  if (loading) return <LoadingSpinner label="Loading booking…" />;
  if (!booking) return <Alert tone="danger">{error || 'Booking not found'}</Alert>;

  const canCancel = booking.status === 'CONFIRMED' && user?.id === booking.userId;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold text-slate-900">Booking detail</h2>
          <p className="mt-1 text-sm text-slate-500">{booking.id}</p>
        </div>
        <StatusBadge status={booking.status} />
      </header>

      <section className="space-y-3 rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
        <p className="text-lg font-semibold">{booking.room.name}</p>
        <p className="text-sm text-slate-600">{booking.room.venueName} · {booking.room.city}</p>
        <p className="text-sm">{formatDateTime(booking.start)} → {formatDateTime(booking.end)}</p>
        <p className="text-sm">Total: <strong>{formatMoney(booking.amountMinor, booking.currency)}</strong></p>
        <div>
          <p className="text-sm font-medium text-slate-700">Equipment</p>
          <ul className="mt-1 text-sm text-slate-600">
            {booking.lineItems.map((item) => (
              <li key={item.id}>{item.quantity}× {item.equipmentName} @ {formatMoney(item.unitRateMinor, item.currency)}/hr</li>
            ))}
            {booking.lineItems.length === 0 ? <li>None</li> : null}
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">Payments</p>
          <ul className="mt-1 text-sm text-slate-600">
            {booking.payments.map((payment) => (
              <li key={payment.id}>{payment.status} · {formatMoney(payment.amountMinor, payment.currency)} · {formatDateTime(payment.createdAt)}</li>
            ))}
            {booking.payments.length === 0 ? <li>No payment yet</li> : null}
          </ul>
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">Refunds</p>
          <ul className="mt-1 text-sm text-slate-600">
            {booking.refunds.map((refund) => (
              <li key={refund.id}>{refund.status} · {formatMoney(refund.amountMinor, refund.currency)} · {formatDateTime(refund.createdAt)}</li>
            ))}
            {booking.refunds.length === 0 ? <li>No refunds</li> : null}
          </ul>
        </div>
        {booking.holdExpiresAt ? <p className="text-xs text-slate-500">Hold expires: {formatDateTime(booking.holdExpiresAt)}</p> : null}
      </section>

      {message ? <Alert tone="success">{message}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap gap-3">
        {booking.status === 'HELD' || booking.status === 'PENDING_PAYMENT' ? (
          <Link to={`/checkout/${booking.id}`} className="rounded-lg bg-[#14213d] px-4 py-2.5 text-sm font-medium text-white">
            Continue to payment
          </Link>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={cancelling}
            onClick={() => void onCancel()}
            className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-800 disabled:opacity-60"
          >
            {cancelling ? 'Cancelling…' : 'Cancel booking'}
          </button>
        ) : null}
        <Link to="/bookings" className="rounded-lg border border-[#d9d2c5] bg-white px-4 py-2.5 text-sm">Back to list</Link>
      </div>
    </div>
  );
}
