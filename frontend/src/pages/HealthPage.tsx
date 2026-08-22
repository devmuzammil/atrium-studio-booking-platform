import { useEffect, useState } from 'react';
import { getHealth } from '../api/bookings';
import { ApiError } from '../api/client';
import { Alert, LoadingSpinner } from '../components/ui';

export function HealthPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<{ status: string; dependencies: Record<string, string> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setLoading(true);
      try {
        const result = await getHealth();
        if (!cancelled) setPayload(result);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Health check failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-3xl font-semibold text-slate-900">API health</h2>
      {loading ? <LoadingSpinner /> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {payload ? (
        <div className="rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
          <p className="text-lg font-semibold">Status: {payload.status}</p>
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {Object.entries(payload.dependencies).map(([key, value]) => (
              <li key={key}>{key}: {value}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
