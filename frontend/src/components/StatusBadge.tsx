import type { BookingStatus } from '../types';

const STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  HELD: 'bg-amber-100 text-amber-800',
  PENDING_PAYMENT: 'bg-sky-100 text-sky-800',
  CONFIRMED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-teal-100 text-teal-800',
  EXPIRED: 'bg-stone-200 text-stone-700',
  FAILED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-orange-100 text-orange-800',
  REFUNDED: 'bg-violet-100 text-violet-800',
};

export function StatusBadge({ status }: { status: BookingStatus | string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${STYLES[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}
