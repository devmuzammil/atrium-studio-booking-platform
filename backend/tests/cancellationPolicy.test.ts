import jwt from 'jsonwebtoken';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { AuthDependencies } from '../src/middleware/auth';

const jwtSecret = 'policy-jwt-secret';
const venueId = randomUUID();
const otherVenueId = randomUUID();
const adminId = randomUUID();
const staffId = randomUUID();

function tokenFor(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret);
}

const auth: AuthDependencies = {
  jwtSecret,
  findUser: async (userId) => {
    if (userId === adminId) return { id: adminId, roles: [{ role: UserRole.VENUE_ADMIN, venueId }] };
    if (userId === staffId) return { id: staffId, roles: [{ role: UserRole.VENUE_STAFF, venueId }] };
    return null;
  },
};

const app = createApp({ auth });

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: adminId, email: `${adminId}@policy.test`, passwordHash: 'test' },
      { id: staffId, email: `${staffId}@policy.test`, passwordHash: 'test' },
    ],
  });
  await prisma.venue.createMany({
    data: [
      { id: venueId, name: 'Policy Venue', city: 'Karachi', timezone: 'UTC', operatingSchedule: {} },
      { id: otherVenueId, name: 'Other Venue', city: 'Dubai', timezone: 'UTC', operatingSchedule: {} },
    ],
  });
});

afterAll(async () => {
  await prisma.cancellationPolicy.deleteMany({ where: { venueId: { in: [venueId, otherVenueId] } } });
  await prisma.venue.deleteMany({ where: { id: { in: [venueId, otherVenueId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, staffId] } } });
});

describe('cancellation policy API', () => {
  const tiers = {
    moreThan48: { roomPercent: 100, equipmentPercent: 100 },
    between24And48: { roomPercent: 50, equipmentPercent: 100 },
    lessThan24: { roomPercent: 0, equipmentPercent: 80 },
  };

  it('lets a venue admin replace active tiers without mutating old versions', async () => {
    const created = await request(app)
      .put(`/api/venues/${venueId}/cancellation-policy`)
      .set('Authorization', `Bearer ${tokenFor(adminId)}`)
      .send({ tiers });

    expect(created.status).toBe(200);
    expect(created.body.policy.version).toBe(1);
    expect(created.body.policy.tiers.lessThan24.equipmentPercent).toBe(80);

    const updated = await request(app)
      .put(`/api/venues/${venueId}/cancellation-policy`)
      .set('Authorization', `Bearer ${tokenFor(adminId)}`)
      .send({
        tiers: {
          ...tiers,
          lessThan24: { roomPercent: 0, equipmentPercent: 0 },
        },
      });

    expect(updated.status).toBe(200);
    expect(updated.body.policy.version).toBe(2);
    const previous = await prisma.cancellationPolicy.findFirst({ where: { venueId, version: 1 } });
    expect(previous?.active).toBe(false);
  });

  it('rejects venue staff updates and cross-venue reads', async () => {
    const staff = await request(app)
      .put(`/api/venues/${venueId}/cancellation-policy`)
      .set('Authorization', `Bearer ${tokenFor(staffId)}`)
      .send({ tiers });
    const cross = await request(app)
      .get(`/api/venues/${otherVenueId}/cancellation-policy`)
      .set('Authorization', `Bearer ${tokenFor(adminId)}`);

    expect(staff.status).toBe(403);
    expect(cross.status).toBe(403);
  });
});
