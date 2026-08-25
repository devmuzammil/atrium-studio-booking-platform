import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './components/AppLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoadingSpinner } from './components/ui';
import { AdminPage } from './pages/AdminPage';
import { BookPage } from './pages/BookPage';
import { BookingDetailPage } from './pages/BookingDetailPage';
import { BookingsPage } from './pages/BookingsPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { HealthPage } from './pages/HealthPage';
import { LoginPage } from './pages/LoginPage';
import { ReportsPage } from './pages/ReportsPage';
import { SearchPage } from './pages/SearchPage';
import { homePathForRole } from './utils/roles';

function HomeRedirect() {
  const { primaryRole, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }
  return <Navigate to={homePathForRole(primaryRole)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/search" element={<ProtectedRoute roles={['CUSTOMER', 'VENUE_ADMIN', 'PLATFORM_ADMIN']} />}>
            <Route index element={<SearchPage />} />
          </Route>
          <Route path="/book/:roomId" element={<BookPage />} />
          <Route path="/checkout/:bookingId" element={<CheckoutPage />} />
          <Route path="/bookings" element={<BookingsPage />} />
          <Route path="/bookings/:bookingId" element={<BookingDetailPage />} />
          <Route path="/reports" element={<ProtectedRoute roles={['VENUE_ADMIN', 'PLATFORM_ADMIN']} />}>
            <Route index element={<ReportsPage />} />
          </Route>
          <Route path="/admin" element={<ProtectedRoute roles={['VENUE_ADMIN', 'PLATFORM_ADMIN']} />}>
            <Route index element={<AdminPage />} />
          </Route>
          <Route path="/health" element={<HealthPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
