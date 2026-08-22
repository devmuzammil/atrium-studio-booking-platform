import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { navForRole } from '../utils/roles';

export function AppLayout() {
  const { user, primaryRole, logout } = useAuth();
  const items = navForRole(primaryRole);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-[#d9d2c5] bg-[#14213d] text-[#f7f4ef] lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="px-5 py-6">
          <p className="text-xs uppercase tracking-[0.2em] text-[#c45c26]">Atrium</p>
          <h1 className="mt-1 text-2xl font-semibold">Studio Booking</h1>
          <p className="mt-3 text-sm text-slate-300">{user?.email}</p>
          <p className="text-xs uppercase tracking-wide text-slate-400">{primaryRole?.replaceAll('_', ' ')}</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-4 lg:flex-col">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm whitespace-nowrap transition ${
                  isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 pb-6">
          <button
            type="button"
            onClick={logout}
            className="w-full rounded-lg border border-white/20 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="px-4 py-6 sm:px-8">
        <Outlet />
      </main>
    </div>
  );
}
