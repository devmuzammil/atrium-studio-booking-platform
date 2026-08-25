import { useState, type FormEvent } from 'react';
import { getReconciliation, getRevenueReport } from '../api/bookings';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { ReconciliationReport, VenueReportRow } from '../types';
import { Alert, EmptyState, LoadingSpinner } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';
import { formatMoney } from '../utils/format';

function formatIssue(issue: string | null): string {
  return issue ? issue.replaceAll('_', ' ') : 'Unknown issue';
}

export function ReportsPage() {
  const { primaryRole, venueIds } = useAuth();
  const defaultVenueId = primaryRole === 'PLATFORM_ADMIN' ? '' : (venueIds[0] ?? '');
  const [venueId, setVenueId] = useState(defaultVenueId);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(null);
  const [venues, setVenues] = useState<VenueReportRow[]>([]);

  async function onLoad(event: FormEvent): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const [recon, revenue] = await Promise.all([
        getReconciliation(venueId || undefined),
        getRevenueReport({
          venueId: venueId || undefined,
          start: start ? new Date(start).toISOString() : undefined,
          end: end ? new Date(end).toISOString() : undefined,
        }),
      ]);
      setReconciliation(recon);
      setVenues(revenue.venues);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load reports');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h2 className="text-3xl font-semibold text-slate-900">Reports</h2>
        <p className="mt-1 text-slate-600">Reconciliation and venue revenue from live backend endpoints.</p>
      </header>

      <form onSubmit={onLoad} className="grid gap-4 rounded-2xl border border-[#d9d2c5] bg-white/80 p-5 md:grid-cols-4">
        <label className="text-sm font-medium text-slate-700 md:col-span-2">
          Venue ID {primaryRole === 'PLATFORM_ADMIN' ? '(optional)' : ''}
          <input
            className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2"
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            placeholder={primaryRole === 'PLATFORM_ADMIN' ? 'Leave blank for all venues' : 'Required venue UUID'}
            required={primaryRole !== 'PLATFORM_ADMIN'}
          />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Start
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          End
          <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <button type="submit" disabled={loading} className="rounded-lg bg-[#14213d] px-4 py-2.5 text-white md:col-span-4 disabled:opacity-60">
          {loading ? 'Loading…' : 'Load reports'}
        </button>
      </form>

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {loading ? <LoadingSpinner /> : null}

      {reconciliation ? (
        <section className="rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
          <h3 className="text-xl font-semibold">Reconciliation</h3>
          <p className="mt-1 text-sm text-slate-600">Captured charges: {reconciliation.capturedCharges}</p>
          {reconciliation.discrepancies.length === 0 ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900">
              No payment reconciliation issues found for the selected criteria.
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <Alert tone="warning" title={`${reconciliation.discrepancies.length} discrepancies`}>
                Review the rows below. Do not invent or hide issues.
              </Alert>
              <div className="overflow-x-auto rounded-xl border border-[#ece7de]">
                <table className="min-w-[900px] w-full text-left text-sm">
                  <thead className="bg-[#f7f4ef] text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Issue</th>
                      <th className="px-4 py-3">Charge</th>
                      <th className="px-4 py-3">Booking</th>
                      <th className="px-4 py-3">Payment</th>
                      <th className="px-4 py-3">Refunds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.discrepancies.map((row) => (
                      <tr key={row.chargeId} className="border-t border-[#ece7de] align-top">
                        <td className="px-4 py-3 font-medium capitalize text-amber-900">{formatIssue(row.issue)}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{formatMoney(row.chargeAmount, row.chargeCurrency)}</p>
                          <p className="mt-1 max-w-[180px] break-all text-xs text-slate-500">{row.chargeId}</p>
                        </td>
                        <td className="px-4 py-3">
                          {row.bookingStatus ? <StatusBadge status={row.bookingStatus} /> : <span className="text-slate-500">Not linked</span>}
                          <p className="mt-1 max-w-[180px] break-all text-xs text-slate-500">{row.bookingId ?? 'No booking ID'}</p>
                        </td>
                        <td className="px-4 py-3">
                          {row.paymentAmount === null ? 'Not recorded' : formatMoney(row.paymentAmount, row.paymentCurrency ?? row.chargeCurrency)}
                        </td>
                        <td className="px-4 py-3">
                          <p>{row.refundAmount === null ? 'Not recorded' : formatMoney(row.refundAmount, row.paymentCurrency ?? row.chargeCurrency)}</p>
                          <p className="mt-1 text-xs text-slate-500">{row.successfulRefundCount} successful</p>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {venues.length > 0 ? (
        <section className="overflow-x-auto rounded-2xl border border-[#d9d2c5] bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#f7f4ef] text-slate-600">
              <tr>
                <th className="px-4 py-3">Venue</th>
                <th className="px-4 py-3">Revenue</th>
                <th className="px-4 py-3">Confirmed bookings</th>
                <th className="px-4 py-3">Booked minutes</th>
                <th className="px-4 py-3">Utilisation</th>
              </tr>
            </thead>
            <tbody>
              {venues.map((row) => (
                <tr key={row.venueId} className="border-t border-[#ece7de]">
                  <td className="px-4 py-3">
                    <p className="font-medium">{row.venueName}</p>
                    <p className="text-xs text-slate-500">{row.venueId}</p>
                  </td>
                  <td className="px-4 py-3">{formatMoney(row.revenueMinor)}</td>
                  <td className="px-4 py-3">{row.confirmedBookings}</td>
                  <td className="px-4 py-3">{row.bookedMinutes}</td>
                  <td className="px-4 py-3">{row.utilizationPercent === null ? '—' : `${row.utilizationPercent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : !loading && reconciliation ? (
        <EmptyState title="No revenue rows" detail="Try a wider date range or another venue." />
      ) : null}
    </div>
  );
}
