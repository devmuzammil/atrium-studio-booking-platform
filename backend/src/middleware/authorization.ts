import { NextFunction, Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { AuthenticatedRequest } from './auth';

export class ForbiddenError extends Error {
  readonly statusCode = 403;

  constructor(message = 'You are not authorized to access this resource') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export function hasGlobalRole(request: AuthenticatedRequest, role: UserRole): boolean {
  return request.user?.roles.some((assignment) => assignment.role === role) ?? false;
}

export function hasVenueRole(
  request: AuthenticatedRequest,
  venueId: string,
  roles: readonly UserRole[],
): boolean {
  return request.user?.roles.some(
    (assignment) => assignment.venueId === venueId && roles.includes(assignment.role),
  ) ?? false;
}

export function requireRoles(...roles: UserRole[]) {
  return (request: AuthenticatedRequest, _response: Response, next: NextFunction): void => {
    if (roles.some((role) => hasGlobalRole(request, role))) {
      next();
      return;
    }

    next(new ForbiddenError());
  };
}

export function authorizeBookingAccess(
  request: AuthenticatedRequest,
  booking: { userId: string; venueId: string },
): void {
  if (hasGlobalRole(request, UserRole.PLATFORM_ADMIN)) {
    return;
  }

  if (hasVenueRole(request, booking.venueId, [UserRole.VENUE_STAFF, UserRole.VENUE_ADMIN])) {
    return;
  }

  if (hasGlobalRole(request, UserRole.CUSTOMER) && request.user?.id === booking.userId) {
    return;
  }

  throw new ForbiddenError();
}

export function authorizeVenueAccess(
  request: AuthenticatedRequest,
  venueId: string,
  allowedRoles: readonly UserRole[] = [UserRole.VENUE_STAFF, UserRole.VENUE_ADMIN],
): void {
  if (hasGlobalRole(request, UserRole.PLATFORM_ADMIN) || hasVenueRole(request, venueId, allowedRoles)) {
    return;
  }

  throw new ForbiddenError();
}

export function authorizeVenueAdmin(request: AuthenticatedRequest, venueId: string): void {
  if (hasGlobalRole(request, UserRole.PLATFORM_ADMIN) || hasVenueRole(request, venueId, [UserRole.VENUE_ADMIN])) {
    return;
  }

  throw new ForbiddenError();
}

export function requireAuthenticatedUser(request: Request): AuthenticatedRequest {
  const authenticatedRequest = request as AuthenticatedRequest;
  if (!authenticatedRequest.user) {
    throw new ForbiddenError('Authenticated user is required');
  }

  return authenticatedRequest;
}

export function authorizeHoldCreation(request: AuthenticatedRequest, venueId: string): void {
  if (hasGlobalRole(request, UserRole.PLATFORM_ADMIN)
    || hasVenueRole(request, venueId, [UserRole.CUSTOMER, UserRole.VENUE_STAFF, UserRole.VENUE_ADMIN])) {
    return;
  }

  throw new ForbiddenError();
}