import jwt from 'jsonwebtoken';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { AuthDependencies, AuthenticatedRequest, authenticate } from '../src/middleware/auth';
import { authorizeVenueAdmin, ForbiddenError } from '../src/middleware/authorization';

const jwtSecret = 'test-jwt-secret';
const venueAId = '00000000-0000-0000-0000-00000000000a';
const venueBId = '00000000-0000-0000-0000-00000000000b';
const customerId = '00000000-0000-0000-0000-000000000001';
const otherCustomerId = '00000000-0000-0000-0000-000000000002';
const venueAdminAId = '00000000-0000-0000-0000-000000000003';
const platformAdminId = '00000000-0000-0000-0000-000000000004';
const venueStaffAId = '00000000-0000-0000-0000-000000000005';
const bookingBId = '00000000-0000-0000-0000-000000000010';
const roomBId = '00000000-0000-0000-0000-000000000011';

function tokenFor(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret);
}

function testAuth(): AuthDependencies {
  const users = new Map([
    [customerId, { id: customerId, roles: [{ role: UserRole.CUSTOMER, venueId: venueAId }] }],
    [otherCustomerId, { id: otherCustomerId, roles: [{ role: UserRole.CUSTOMER, venueId: venueAId }] }],
    [venueAdminAId, { id: venueAdminAId, roles: [{ role: UserRole.VENUE_ADMIN, venueId: venueAId }] }],
    [platformAdminId, { id: platformAdminId, roles: [{ role: UserRole.PLATFORM_ADMIN, venueId: venueAId }] }],
    [venueStaffAId, { id: venueStaffAId, roles: [{ role: UserRole.VENUE_STAFF, venueId: venueAId }] }],
  ]);

  return {
    jwtSecret,
    findUser: async (userId) => users.get(userId) || null,
  };
}

describe('JWT authentication and tenant authorization', () => {
  const app = createApp({ auth: testAuth() });

  beforeEach(() => {
    jest.spyOn(prisma.booking, 'findUnique').mockResolvedValue({
      id: bookingBId,
      userId: otherCustomerId,
      roomId: roomBId,
      status: 'CONFIRMED',
    } as never);
    jest.spyOn(prisma.room, 'findUnique').mockResolvedValue({
      id: roomBId,
      venueId: venueBId,
      name: 'Venue B Room',
      capacity: 4,
    } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a missing JWT', async () => {
    const response = await request(app).get(`/api/rooms/${roomBId}`);

    expect(response.status).toBe(401);
  });

  it('rejects an invalid JWT', async () => {
    const response = await request(app)
      .get(`/api/rooms/${roomBId}`)
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
  });

  it('allows a customer to access their own booking', async () => {
    (prisma.booking.findUnique as jest.Mock).mockResolvedValueOnce({
      id: bookingBId,
      userId: customerId,
      roomId: roomBId,
      status: 'CONFIRMED',
    });
    (prisma.room.findUnique as jest.Mock).mockResolvedValueOnce({
      id: roomBId,
      venueId: venueAId,
      name: 'Venue A Room',
      capacity: 4,
    });
    jest.spyOn(prisma, '$queryRaw').mockResolvedValue([] as never);
    jest.spyOn(prisma.payment, 'findMany').mockResolvedValue([] as never);
    jest.spyOn(prisma.refund, 'findMany').mockResolvedValue([] as never);

    const response = await request(app)
      .get(`/api/bookings/${bookingBId}`)
      .set('Authorization', `Bearer ${tokenFor(customerId)}`);

    expect(response.status).toBe(200);
  });

  it('denies a customer another customer booking', async () => {
    const response = await request(app)
      .get(`/api/bookings/${bookingBId}`)
      .set('Authorization', `Bearer ${tokenFor(customerId)}`);

    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty('userId');
  });

  it('denies Venue A admin a valid Venue B booking UUID', async () => {
    const response = await request(app)
      .get(`/api/bookings/${bookingBId}`)
      .set('Authorization', `Bearer ${tokenFor(venueAdminAId)}`);

    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty('id', bookingBId);
  });

  it('allows Venue A admin to access a Venue A room', async () => {
    (prisma.room.findUnique as jest.Mock).mockResolvedValueOnce({
      id: roomBId,
      venueId: venueAId,
      name: 'Venue A Room',
      capacity: 4,
    });

    const response = await request(app)
      .get(`/api/rooms/${roomBId}`)
      .set('Authorization', `Bearer ${tokenFor(venueAdminAId)}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(roomBId);
  });

  it('denies Venue A admin a valid Venue B room UUID', async () => {
    const response = await request(app)
      .get(`/api/rooms/${roomBId}`)
      .set('Authorization', `Bearer ${tokenFor(venueAdminAId)}`);

    expect(response.status).toBe(403);
    expect(response.body).not.toHaveProperty('id', roomBId);
  });

  it('allows PLATFORM_ADMIN to access Venue B', async () => {
    const response = await request(app)
      .get(`/api/rooms/${roomBId}`)
      .set('Authorization', `Bearer ${tokenFor(platformAdminId)}`);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(roomBId);
  });

  it('does not allow venue staff to perform admin-only operations', () => {
    const requestWithStaff = { user: testAuthUser(venueStaffAId) } as AuthenticatedRequest;

    expect(() => authorizeVenueAdmin(requestWithStaff, venueAId)).toThrow(ForbiddenError);
  });
});

function testAuthUser(userId: string): NonNullable<AuthenticatedRequest['user']> {
  return {
    id: userId,
    roles: [{ role: UserRole.VENUE_STAFF, venueId: venueAId }],
  };
}

describe('authentication middleware dependency boundary', () => {
  it('loads authorization roles from the authenticated user lookup', async () => {
    const next = jest.fn();
    const requestWithToken = {
      header: () => `Bearer ${tokenFor(venueAdminAId)}`,
    } as never;
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as never;
    const dependencies = testAuth();

    await authenticate(dependencies)(requestWithToken, response, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});