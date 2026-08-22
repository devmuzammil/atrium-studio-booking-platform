import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';
import { hasGlobalRole, hasVenueRole, requireAuthenticatedUser } from '../middleware/authorization';
import { getReconciliation } from '../services/reconciliationService';
import { getVenueReport } from '../services/reportService';

function requestedVenue(request: Request): string | undefined {
  const value = request.query.venueId;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') throw Object.assign(new Error('venueId must be a string'), { statusCode: 400 });
  return value;
}

function authorizeReport(request: Request, venueId: string | undefined): void {
  const authenticated = requireAuthenticatedUser(request);
  if (hasGlobalRole(authenticated, UserRole.PLATFORM_ADMIN)) return;
  if (!venueId || !hasVenueRole(authenticated, venueId, [UserRole.VENUE_STAFF, UserRole.VENUE_ADMIN])) {
    throw Object.assign(new Error('Report access denied'), { statusCode: 403 });
  }
}

export async function reconciliationReport(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const venueId = requestedVenue(request);
    authorizeReport(request, venueId);
    response.json(await getReconciliation(prisma, venueId));
  } catch (error) { next(error); }
}

export async function venueReport(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const venueId = requestedVenue(request);
    authorizeReport(request, venueId);
    const start = request.query.start ? new Date(String(request.query.start)) : undefined;
    const end = request.query.end ? new Date(String(request.query.end)) : undefined;
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime())) || (start && end && start >= end)) {
      throw Object.assign(new Error('valid start/end range is required'), { statusCode: 400 });
    }
    response.json({ venues: await getVenueReport(prisma, venueId, start, end) });
  } catch (error) { next(error); }
}