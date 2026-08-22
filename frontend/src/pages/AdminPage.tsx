import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/ui';

export function AdminPage() {
  const { primaryRole, venueIds, user } = useAuth();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h2 className="text-3xl font-semibold text-slate-900">
          {primaryRole === 'PLATFORM_ADMIN' ? 'Platform overview' : 'Venue admin'}
        </h2>
        <p className="mt-1 text-slate-600">
          Room/equipment/policy mutation APIs are not exposed by the current backend. This screen uses only real capabilities.
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

      <Alert tone="info" title="Available admin actions">
        <ul className="list-disc space-y-1 pl-5">
          <li>View venue or platform bookings via Bookings</li>
          <li>Run reconciliation and revenue reports via Reports</li>
          <li>Search availability like a customer (useful for support checks)</li>
        </ul>
      </Alert>

      <Alert tone="warning" title="Not implemented in backend yet">
        Create/edit rooms, equipment unit counts, pricing, and cancellation policy CRUD endpoints are not present.
        The UI intentionally does not fake those screens.
      </Alert>
    </div>
  );
}
