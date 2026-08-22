import type { ReactNode } from 'react';

export function LoadingSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-slate-600" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#c45c26]" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#d9d2c5] bg-white/60 px-6 py-10 text-center">
      <p className="text-lg font-semibold text-slate-800">{title}</p>
      {detail ? <p className="mt-2 text-sm text-slate-600">{detail}</p> : null}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    danger: 'border-rose-200 bg-rose-50 text-rose-900',
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`} role="alert">
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-1' : ''}>{children}</div>
    </div>
  );
}
