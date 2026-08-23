import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { getVenuePolicy, updateVenuePolicy } from '../api/bookings';
import { ApiError } from '../api/client';
import { Alert } from '../components/ui';

const defaultTiers = {
  moreThan48: { roomPercent: 100, equipmentPercent: 100 },
  between24And48: { roomPercent: 50, equipmentPercent: 100 },
  lessThan24: { roomPercent: 0, equipmentPercent: 100 },
};

export function AdminPage() {
  const { primaryRole, venueIds, user } = useAuth();
  const venueId = venueIds[0] ?? '';
  const canEditPolicy = primaryRole === 'VENUE_ADMIN' || primaryRole === 'PLATFORM_ADMIN';
  const [tiersJson, setTiersJson] = useState(JSON.stringify(defaultTiers, null, 2));
  const [version, setVersion] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!venueId || !canEditPolicy) return;
    void getVenuePolicy(venueId)
      .then((result) => {
        setVersion(result.policy.version);
        setTiersJson(JSON.stringify(result.policy.tiers ?? defaultTiers, null, 2));
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Unable to load policy');
      });
  }, [venueId, canEditPolicy]);

  async function onSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!venueId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const tiers = JSON.parse(tiersJson) as unknown;
      const result = await updateVenuePolicy(venueId, tiers);
      setVersion(result.policy.version);
      setMessage(`Saved policy version ${result.policy.version}. Already confirmed bookings keep their snapshot.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Policy could not be saved. Check JSON.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="text-3xl font-semibold text-slate-900">
          {primaryRole === 'PLATFORM_ADMIN' ? 'Platform overview' : 'Venue admin'}
        </h2>
        <p className="mt-1 text-slate-600">
          Room and equipment create/edit APIs are not in this backend. Cancellation policy is data and can be changed live.
        </p>
      </header>

      <section className="rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Signed-in identity</h3>
        <p className="mt-2 text-sm text-slate-700">{user?.email}</p>
        <p className="text-sm text-slate-700">Role: {primaryRole}</p>
        <div className="mt-3">
          <p className="text-sm font-medium text-slate-700">Venue scope</p>
          <ul className="mt-1 text-sm text-slate-600">
            {venueIds.map((id) => <li key={id}>{id}</li>)}
          </ul>
        </div>
      </section>

      {canEditPolicy && venueId ? (
        <form onSubmit={onSave} className="space-y-3 rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Cancellation policy</h3>
          <p className="text-sm text-slate-600">
            Version {version ?? '—'} for venue {venueId}. Changes apply to new holds only.
          </p>
          <label className="block text-sm font-medium text-slate-700">
            Tiers JSON
            <textarea
              className="mt-1 h-56 w-full rounded-lg border border-[#d9d2c5] px-3 py-2 font-mono text-xs"
              value={tiersJson}
              onChange={(event) => setTiersJson(event.target.value)}
            />
          </label>
          {message ? <Alert tone="success">{message}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#14213d] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </form>
      ) : (
        <Alert tone="info">Policy editing is limited to venue admins and platform admins.</Alert>
      )}
    </div>
  );
}
