import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { addVenueStaff, getVenueConfiguration, getVenuePolicy, listVenueStaff, removeVenueStaff, updateVenueConfiguration, updateVenuePolicy } from '../api/bookings';
import { ApiError } from '../api/client';
import { Alert } from '../components/ui';

const defaultTiers = {
  moreThan48: { roomPercent: 100, equipmentPercent: 100 },
  between24And48: { roomPercent: 50, equipmentPercent: 100 },
  lessThan24: { roomPercent: 0, equipmentPercent: 100 },
};

type PolicyTiers = typeof defaultTiers;

const tierLabels: Array<{ key: keyof PolicyTiers; label: string }> = [
  { key: 'moreThan48', label: 'More than 48 hours before start' },
  { key: 'between24And48', label: '24 to 48 hours before start' },
  { key: 'lessThan24', label: 'Less than 24 hours before start' },
];

export function AdminPage() {
  const { primaryRole, venueIds, user } = useAuth();
  const venueId = venueIds[0] ?? '';
  const canEditPolicy = primaryRole === 'VENUE_ADMIN' || primaryRole === 'PLATFORM_ADMIN';
  const [tiers, setTiers] = useState<PolicyTiers>(defaultTiers);
  const [version, setVersion] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [venue, setVenue] = useState({ name: '', city: '', timezone: 'UTC', operatingSchedule: '{}' });
  const [staff, setStaff] = useState<Array<{ userId: string; email: string }>>([]);
  const [staffEmail, setStaffEmail] = useState('');
  const [savingVenue, setSavingVenue] = useState(false);

  useEffect(() => {
    if (!venueId || !canEditPolicy) return;
    void Promise.all([getVenueConfiguration(venueId), listVenueStaff(venueId)])
      .then(([configuration, staffResult]) => {
        setVenue({ ...configuration.venue, operatingSchedule: JSON.stringify(configuration.venue.operatingSchedule, null, 2) });
        setStaff(staffResult.staff);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load venue settings'));
    void getVenuePolicy(venueId)
      .then((result) => {
        setVersion(result.policy.version);
        const loadedTiers = result.policy.tiers;
        if (loadedTiers && typeof loadedTiers === 'object' && !Array.isArray(loadedTiers)) {
          setTiers({ ...defaultTiers, ...loadedTiers as Partial<PolicyTiers> });
        }
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
      const result = await updateVenuePolicy(venueId, tiers);
      setVersion(result.policy.version);
      setMessage(`Saved policy version ${result.policy.version}. Already confirmed bookings keep their snapshot.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Policy could not be saved. Check JSON.');
    } finally {
      setSaving(false);
    }
  }

  async function saveVenue(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSavingVenue(true);
    setError(null);
    try {
      const result = await updateVenueConfiguration(venueId, { ...venue, operatingSchedule: JSON.parse(venue.operatingSchedule) });
      setVenue({ ...result.venue, operatingSchedule: JSON.stringify(result.venue.operatingSchedule, null, 2) });
      setMessage('Venue settings saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Venue settings could not be saved. Check the schedule JSON.');
    } finally { setSavingVenue(false); }
  }

  async function addStaff(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!staffEmail.trim()) return;
    try {
      const result = await addVenueStaff(venueId, staffEmail);
      setStaff((current) => [...current.filter((member) => member.userId !== result.staff.userId), result.staff]);
      setStaffEmail('');
      setMessage('Staff member assigned to this venue.');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Staff member could not be assigned'); }
  }

  async function removeStaff(userId: string): Promise<void> {
    try {
      await removeVenueStaff(venueId, userId);
      setStaff((current) => current.filter((member) => member.userId !== userId));
      setMessage('Staff member removed from this venue.');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Staff member could not be removed'); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="text-3xl font-semibold text-slate-900">
          {primaryRole === 'PLATFORM_ADMIN' ? 'Platform overview' : 'Venue admin'}
        </h2>
        <p className="mt-1 text-slate-600">Manage cancellation policy for future bookings.</p>
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
        <form onSubmit={saveVenue} className="space-y-3 rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Venue configuration</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['name', 'city', 'timezone'] as const).map((field) => (
              <label key={field} className="text-sm font-medium capitalize text-slate-700">
                {field}
                <input className="mt-1 w-full rounded-lg border border-[#d9d2c5] px-3 py-2" value={venue[field]} onChange={(event) => setVenue({ ...venue, [field]: event.target.value })} required />
              </label>
            ))}
          </div>
          <label className="text-sm font-medium text-slate-700">
            Operating schedule (JSON)
            <textarea className="mt-1 min-h-24 w-full rounded-lg border border-[#d9d2c5] px-3 py-2 font-mono text-sm" value={venue.operatingSchedule} onChange={(event) => setVenue({ ...venue, operatingSchedule: event.target.value })} required />
          </label>
          <button type="submit" disabled={savingVenue} className="rounded-lg bg-[#14213d] px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60">{savingVenue ? 'Saving…' : 'Save venue settings'}</button>
        </form>
      ) : null}

      {canEditPolicy && venueId ? (
        <section className="space-y-3 rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Venue staff</h3>
          <form onSubmit={addStaff} className="flex flex-wrap gap-2">
            <input className="min-w-0 flex-1 rounded-lg border border-[#d9d2c5] px-3 py-2" type="email" value={staffEmail} onChange={(event) => setStaffEmail(event.target.value)} placeholder="staff member email" required />
            <button type="submit" className="rounded-lg bg-[#14213d] px-4 py-2.5 text-sm font-medium text-white">Assign staff</button>
          </form>
          {staff.length > 0 ? <ul className="divide-y divide-[#ece7de]">{staff.map((member) => <li key={member.userId} className="flex items-center justify-between py-2 text-sm"><span>{member.email}</span><button type="button" onClick={() => void removeStaff(member.userId)} className="text-rose-700 hover:underline">Remove</button></li>)}</ul> : <p className="text-sm text-slate-600">No staff assigned to this venue.</p>}
        </section>
      ) : null}

      {canEditPolicy && venueId ? (
        <form onSubmit={onSave} className="space-y-3 rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Cancellation policy</h3>
          <p className="text-sm text-slate-600">
            Version {version ?? '—'} for venue {venueId}. Changes apply to new holds only.
          </p>
          <div className="overflow-hidden rounded-lg border border-[#d9d2c5]">
            <div className="grid grid-cols-[1fr_8rem_8rem] gap-3 bg-[#f7f4ef] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <span>Cancellation window</span>
              <span>Room refund</span>
              <span>Equipment refund</span>
            </div>
            {tierLabels.map(({ key, label }) => (
              <div key={key} className="grid grid-cols-[1fr_8rem_8rem] items-center gap-3 border-t border-[#ece7de] px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{label}</span>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tiers[key].roomPercent}
                    onChange={(event) => setTiers({ ...tiers, [key]: { ...tiers[key], roomPercent: Number(event.target.value) } })}
                    className="w-full rounded-lg border border-[#d9d2c5] px-3 py-2 text-right"
                  />
                  <span>%</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={tiers[key].equipmentPercent}
                    onChange={(event) => setTiers({ ...tiers, [key]: { ...tiers[key], equipmentPercent: Number(event.target.value) } })}
                    className="w-full rounded-lg border border-[#d9d2c5] px-3 py-2 text-right"
                  />
                  <span>%</span>
                </label>
              </div>
            ))}
          </div>
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
