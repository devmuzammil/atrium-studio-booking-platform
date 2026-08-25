import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { beginCheckout, getBooking, startPayment } from '../api/bookings';
import { ApiError } from '../api/client';
import type { BookingDetail } from '../types';
import { StatusBadge } from '../components/StatusBadge';
import { Alert, LoadingSpinner } from '../components/ui';
import { formatDateTime, formatMoney, friendlyApiMessage } from '../utils/format';
import { useAuth } from '../auth/AuthContext';

function useCountdown(target: string | null | undefined): number {
  const [remainingMs, setRemainingMs] = useState(0);
  useEffect(() => {
    if (!target) {
      setRemainingMs(0);
      return;
    }
    const tick = () => setRemainingMs(Math.max(0, new Date(target).getTime() - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [target]);
  return remainingMs;
}

export function CheckoutPage() {
  const { bookingId } = useParams();
  const { user } = useAuth();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const remainingMs = useCountdown(booking?.holdExpiresAt);

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
        await beginCheckout(bookingId).catch(() => undefined);
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

  useEffect(() => {
    if (!booking) return;
    if (!['PENDING_PAYMENT', 'HELD'].includes(String(booking.status))) return;
    const id = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [booking, refresh]);

  const holdExpired = useMemo(() => {
    if (booking?.status === 'EXPIRED') return true;
    if (!booking?.holdExpiresAt) return false;
    return remainingMs === 0;
  }, [booking, remainingMs]);

  const canPay = booking?.status === 'HELD' && booking.userId === user?.id && !holdExpired && !paying;

  async function onPay(): Promise<void> {
    if (!bookingId || !canPay) return;
    setPaying(true);
    setError(null);
    try {
      await startPayment(bookingId, idempotencyKey);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(friendlyApiMessage(err.status, err.message));
      } else {
        setError('Payment could not be started');
      }
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return <LoadingSpinner label="Loading checkout…" />;
  }

  if (!booking) {
    return <Alert tone="danger">{error || 'Booking not found'}</Alert>;
  }

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl font-semibold text-slate-900">Checkout</h2>
          <p className="mt-1 text-sm text-slate-600">Booking {booking.id}</p>
        </div>
        <StatusBadge status={booking.status} />
      </header>

      <section className="rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
        <p className="text-lg font-semibold text-slate-900">{booking.room.name}</p>
        <p className="text-sm text-slate-600">{booking.room.venueName} · {booking.room.city}</p>
        <p className="mt-3 text-sm text-slate-700">{formatDateTime(booking.start)} → {formatDateTime(booking.end)}</p>
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          {booking.lineItems.map((item) => (
            <li key={item.id}>{item.quantity}× {item.equipmentName}</li>
          ))}
          {booking.lineItems.length === 0 ? <li>No equipment</li> : null}
        </ul>
        <p className="mt-4 text-xl font-semibold text-[#c45c26]">{formatMoney(booking.amountMinor, booking.currency)}</p>
      </section>

      {booking.status === 'HELD' || booking.status === 'PENDING_PAYMENT' ? (
        <Alert tone={holdExpired ? 'warning' : 'info'} title={holdExpired ? 'Hold expired' : 'Your room is reserved'}>
          {holdExpired ? (
            <p>
              This hold is no longer payable. <Link className="underline" to="/search">Search again</Link>.
            </p>
          ) : (
            <p>
              You have {minutes}:{String(seconds).padStart(2, '0')} to complete payment
              {booking.holdExpiresAt ? ` (until ${formatDateTime(booking.holdExpiresAt)})` : ''}.
            </p>
          )}
        </Alert>
      ) : null}

      {booking.status === 'PENDING_PAYMENT' ? (
        <Alert tone="info" title="Payment processing">
          Your payment is being confirmed. This page will update automatically.
        </Alert>
      ) : null}

      {booking.status === 'CONFIRMED' ? (
        <Alert tone="success" title="Booking confirmed">
          Payment succeeded and inventory is committed. <Link className="underline" to={`/bookings/${booking.id}`}>View booking</Link>
        </Alert>
      ) : null}

      {['FAILED', 'EXPIRED', 'REFUNDED'].includes(String(booking.status)) ? (
        <Alert tone="warning" title={`Booking ${booking.status}`}>
          <Link className="underline" to="/search">Return to search</Link>
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!canPay}
          onClick={() => void onPay()}
          className="rounded-lg bg-[#c45c26] px-4 py-2.5 font-medium text-white hover:bg-[#a84c1f] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {paying ? 'Submitting payment…' : 'Pay with Paygate'}
        </button>
        <Link to={`/bookings/${booking.id}`} className="rounded-lg border border-[#d9d2c5] bg-white px-4 py-2.5 text-sm font-medium text-slate-800">
          Booking detail
        </Link>
      </div>
    </div>
  );
}
