import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { addVenueStaff, createPlatformUser, createPlatformVenue, deletePlatformVenue, getVenueConfiguration, getVenuePolicy, listPlatformUsers, listPlatformVenues, listVenueStaff, removeVenueStaff, replacePlatformUserRoles, updatePlatformVenue, updateVenueConfiguration, updateVenuePolicy } from '../api/bookings';
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
  const [platformVenues, setPlatformVenues] = useState<Array<{ id: string; name: string; city: string; timezone: string; operatingSchedule: unknown }>>([]);
  const [platformUsers, setPlatformUsers] = useState<Array<{ id: string; email: string; roles: Array<{ role: string; venueId: string }> }>>([]);
  const [newPlatformVenue, setNewPlatformVenue] = useState({ name: '', city: '', timezone: 'UTC', operatingSchedule: '{}' });
  const [newPlatformUser, setNewPlatformUser] = useState({ email: '', password: '', role: 'CUSTOMER', venueId: '' });
  const [roleEdit, setRoleEdit] = useState({ userId: '', role: 'VENUE_STAFF', venueId: '' });

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

  useEffect(() => {
    if (primaryRole !== 'PLATFORM_ADMIN') return;
    void Promise.all([listPlatformVenues(), listPlatformUsers()])
      .then(([venuesResult, usersResult]) => {
        setPlatformVenues(venuesResult.venues);
        setPlatformUsers(usersResult.users);
        if (!newPlatformUser.venueId && venuesResult.venues[0]) setNewPlatformUser((current) => ({ ...current, venueId: venuesResult.venues[0].id }));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Unable to load platform administration'));
  }, [primaryRole]);

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

  async function createVenue(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const result = await createPlatformVenue({ ...newPlatformVenue, operatingSchedule: JSON.parse(newPlatformVenue.operatingSchedule) });
      setPlatformVenues((current) => [...current, result.venue]);
      setNewPlatformVenue({ name: '', city: '', timezone: 'UTC', operatingSchedule: '{}' });
      setMessage('Venue created.');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Venue could not be created. Check the schedule JSON.'); }
  }

  async function savePlatformVenue(venue: (typeof platformVenues)[number]): Promise<void> {
    try {
      const result = await updatePlatformVenue(venue.id, { name: venue.name, city: venue.city, timezone: venue.timezone, operatingSchedule: venue.operatingSchedule });
      setPlatformVenues((current) => current.map((item) => item.id === venue.id ? result.venue : item));
      setMessage('Venue updated.');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Venue could not be updated'); }
  }

  async function deleteVenue(id: string): Promise<void> {
    if (!window.confirm('Delete this venue and its configuration?')) return;
    try { await deletePlatformVenue(id); setPlatformVenues((current) => current.filter((venue) => venue.id !== id)); setMessage('Venue deleted.'); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Venue could not be deleted'); }
  }

  async function createUser(event: FormEvent): Promise<void> {
    event.preventDefault();
    try {
      const result = await createPlatformUser(newPlatformUser);
      setPlatformUsers((current) => [...current, result.user]);
      setNewPlatformUser((current) => ({ ...current, email: '', password: '' }));
      setMessage('User created.');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'User could not be created'); }
  }

  async function saveUserRole(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!roleEdit.userId || !roleEdit.venueId) return;
    try {
      const result = await replacePlatformUserRoles(roleEdit.userId, [{ role: roleEdit.role, venueId: roleEdit.venueId }]);
      setPlatformUsers((current) => current.map((user) => user.id === result.user.id ? result.user : user));
      setMessage('User role updated.');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'User role could not be updated'); }
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

      {primaryRole === 'PLATFORM_ADMIN' ? (
        <>
          <section className="space-y-3 rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold">All venues</h3>
            <form onSubmit={createVenue} className="grid gap-2 sm:grid-cols-4">
              {(['name', 'city', 'timezone'] as const).map((field) => <input key={field} className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" placeholder={field} value={newPlatformVenue[field]} onChange={(event) => setNewPlatformVenue({ ...newPlatformVenue, [field]: event.target.value })} required />)}
              <input className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" placeholder="schedule JSON" value={newPlatformVenue.operatingSchedule} onChange={(event) => setNewPlatformVenue({ ...newPlatformVenue, operatingSchedule: event.target.value })} required />
              <button type="submit" className="rounded-lg bg-[#14213d] px-4 py-2.5 text-sm font-medium text-white sm:col-span-4">Create venue</button>
            </form>
            <div className="space-y-3">{platformVenues.map((item) => <div key={item.id} className="grid gap-2 border-t border-[#ece7de] pt-3 sm:grid-cols-4"><input className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" value={item.name} onChange={(event) => setPlatformVenues((current) => current.map((venue) => venue.id === item.id ? { ...venue, name: event.target.value } : venue))} /><input className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" value={item.city} onChange={(event) => setPlatformVenues((current) => current.map((venue) => venue.id === item.id ? { ...venue, city: event.target.value } : venue))} /><input className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" value={item.timezone} onChange={(event) => setPlatformVenues((current) => current.map((venue) => venue.id === item.id ? { ...venue, timezone: event.target.value } : venue))} /><div className="flex gap-2"><button type="button" onClick={() => void savePlatformVenue(item)} className="text-sm text-[#c45c26] hover:underline">Save</button><button type="button" onClick={() => void deleteVenue(item.id)} className="text-sm text-rose-700 hover:underline">Delete</button></div></div>)}</div>
          </section>
          <section className="space-y-3 rounded-2xl border border-[#d9d2c5] bg-white p-5 shadow-sm">
            <h3 className="text-lg font-semibold">User administration</h3>
            <form onSubmit={createUser} className="grid gap-2 sm:grid-cols-4"><input className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" type="email" placeholder="email" value={newPlatformUser.email} onChange={(event) => setNewPlatformUser({ ...newPlatformUser, email: event.target.value })} required /><input className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" type="password" placeholder="temporary password" value={newPlatformUser.password} onChange={(event) => setNewPlatformUser({ ...newPlatformUser, password: event.target.value })} required /><select className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" value={newPlatformUser.role} onChange={(event) => setNewPlatformUser({ ...newPlatformUser, role: event.target.value })}>{['CUSTOMER', 'VENUE_STAFF', 'VENUE_ADMIN', 'PLATFORM_ADMIN'].map((role) => <option key={role}>{role}</option>)}</select><input className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" placeholder="venue UUID" value={newPlatformUser.venueId} onChange={(event) => setNewPlatformUser({ ...newPlatformUser, venueId: event.target.value })} required /><button type="submit" className="rounded-lg bg-[#14213d] px-4 py-2.5 text-sm font-medium text-white sm:col-span-4">Create user</button></form>
            <form onSubmit={saveUserRole} className="grid gap-2 border-t border-[#ece7de] pt-3 sm:grid-cols-3"><select className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" value={roleEdit.userId} onChange={(event) => setRoleEdit({ ...roleEdit, userId: event.target.value })}><option value="">Select user</option>{platformUsers.map((item) => <option key={item.id} value={item.id}>{item.email}</option>)}</select><select className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" value={roleEdit.role} onChange={(event) => setRoleEdit({ ...roleEdit, role: event.target.value })}>{['CUSTOMER', 'VENUE_STAFF', 'VENUE_ADMIN', 'PLATFORM_ADMIN'].map((role) => <option key={role}>{role}</option>)}</select><input className="rounded-lg border border-[#d9d2c5] px-3 py-2 text-sm" placeholder="venue UUID" value={roleEdit.venueId} onChange={(event) => setRoleEdit({ ...roleEdit, venueId: event.target.value })} required /><button type="submit" className="rounded-lg bg-[#14213d] px-4 py-2.5 text-sm font-medium text-white sm:col-span-3">Set user role</button></form>
            <ul className="divide-y divide-[#ece7de]">{platformUsers.map((item) => <li key={item.id} className="py-2 text-sm"><span className="font-medium">{item.email}</span><span className="ml-2 text-slate-500">{item.roles.map((role) => `${role.role} (${role.venueId})`).join(', ') || 'No roles'}</span></li>)}</ul>
          </section>
        </>
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
