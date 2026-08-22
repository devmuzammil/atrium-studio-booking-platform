import type { UserRole } from '../types';

export interface NavItem {
  to: string;
  label: string;
}

export function navForRole(role: UserRole | null): NavItem[] {
  switch (role) {
    case 'CUSTOMER':
      return [
        { to: '/search', label: 'Find a Studio' },
        { to: '/bookings', label: 'My Bookings' },
      ];
    case 'VENUE_STAFF':
      return [
        { to: '/bookings', label: 'Venue Bookings' },
        { to: '/reports', label: 'Reports' },
      ];
    case 'VENUE_ADMIN':
      return [
        { to: '/admin', label: 'Venue Admin' },
        { to: '/bookings', label: 'Venue Bookings' },
        { to: '/reports', label: 'Reports' },
        { to: '/search', label: 'Search' },
      ];
    case 'PLATFORM_ADMIN':
      return [
        { to: '/admin', label: 'Platform' },
        { to: '/bookings', label: 'All Bookings' },
        { to: '/reports', label: 'Reports' },
        { to: '/search', label: 'Search' },
        { to: '/health', label: 'Health' },
      ];
    default:
      return [];
  }
}

export function homePathForRole(role: UserRole | null): string {
  switch (role) {
    case 'VENUE_STAFF':
      return '/bookings';
    case 'VENUE_ADMIN':
    case 'PLATFORM_ADMIN':
      return '/admin';
    default:
      return '/search';
  }
}
