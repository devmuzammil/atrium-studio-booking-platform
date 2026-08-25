import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Alert } from '../components/ui';
import { homePathForRole } from '../utils/roles';

export function LoginPage() {
  const { login, user, loading, primaryRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('customer@atrium.local');
  const [password, setPassword] = useState('Password123!');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from || homePathForRole(primaryRole)} replace />;
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to sign in';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl items-center px-4 py-10">
      <div className="grid w-full gap-8 lg:grid-cols-2">
        <section className="rounded-3xl bg-[#14213d] p-8 text-[#f7f4ef] shadow-xl">
          <p className="text-xs uppercase tracking-[0.25em] text-[#c45c26]">Atrium</p>
          <h1 className="mt-3 text-4xl font-semibold leading-tight">Studio booking for creative venues</h1>
          <p className="mt-4 max-w-md text-slate-300">
            Search rooms, place a hold, pay through Paygate, and manage bookings with venue-scoped access.
          </p>
          <div className="mt-8 space-y-2 text-sm text-slate-300">
            <p>Demo password for all seeded roles: <strong className="text-white">Password123!</strong></p>
            <p>customer@ · staff@ · admin-a@ · admin-b@ · platform@ atrium.local</p>
          </div>
        </section>

        <form onSubmit={onSubmit} className="rounded-3xl border border-[#d9d2c5] bg-white/80 p-8 shadow-sm backdrop-blur">
          <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>

          {error ? (
            <div className="mt-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          ) : null}

          <label className="mt-6 block text-sm font-medium text-slate-700">
            Email
            <input
              className="mt-1 w-full rounded-lg border border-[#d9d2c5] bg-white px-3 py-2 outline-none ring-[#c45c26] focus:ring-2"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="mt-4 block text-sm font-medium text-slate-700">
            Password
            <input
              className="mt-1 w-full rounded-lg border border-[#d9d2c5] bg-white px-3 py-2 outline-none ring-[#c45c26] focus:ring-2"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-lg bg-[#c45c26] px-4 py-2.5 font-medium text-white hover:bg-[#a84c1f] disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
