import 'dotenv/config';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { AuthDependencies } from '../src/middleware/auth';

const jwtSecret = 'inventory-management-test-secret';
const venueA = randomUUID();
const venueB = randomUUID();
const adminA = randomUUID();
const staffA = randomUUID();
const customerA = randomUUID();
const platformAdmin = randomUUID();
const roomB = randomUUID();
const equipmentB = randomUUID();

const auth: AuthDependencies = {
  jwtSecret,
  findUser: async (id) => {
    const roles = {
      [adminA]: [{ role: UserRole.VENUE_ADMIN, venueId: venueA }],
      [staffA]: [{ role: UserRole.VENUE_STAFF, venueId: venueA }],
      [customerA]: [{ role: UserRole.CUSTOMER, venueId: venueA }],
      [platformAdmin]: [{ role: UserRole.PLATFORM_ADMIN, venueId: '' }],
    }[id];
    return roles ? { id, roles } : null;
  },
};
const app = createApp({ auth });

function token(userId: string): string {
  return jwt.sign({ sub: userId }, jwtSecret);
}

function authorized(userId: string) {
  return { Authorization: `Bearer ${token(userId)}` };
}

beforeAll(async () => {
  await prisma.user.createMany({ data: [
    { id: adminA, email: `${adminA}@inventory.test`, passwordHash: 'test' },
    { id: staffA, email: `${staffA}@inventory.test`, passwordHash: 'test' },
    { id: customerA, email: `${customerA}@inventory.test`, passwordHash: 'test' },
    { id: platformAdmin, email: `${platformAdmin}@inventory.test`, passwordHash: 'test' },
  ] });
  await prisma.venue.createMany({ data: [
    { id: venueA, name: 'Venue A', city: 'Karachi', timezone: 'UTC', operatingSchedule: {} },
    { id: venueB, name: 'Venue B', city: 'Dubai', timezone: 'UTC', operatingSchedule: {} },
  ] });
  await prisma.room.create({ data: { id: roomB, venueId: venueB, name: 'Room B', capacity: 2, hourlyRateMinor: 1000, amenities: [] } });
  await prisma.equipmentType.create({ data: { id: equipmentB, venueId: venueB, name: 'Camera B', hourlyRateMinor: 500, totalUnits: 2 } });
});

afterAll(async () => {
  await prisma.equipmentType.deleteMany({ where: { id: equipmentB } });
  await prisma.room.deleteMany({ where: { id: roomB } });
  await prisma.venue.deleteMany({ where: { id: { in: [venueA, venueB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminA, staffA, customerA, platformAdmin] } } });
});

describe('venue inventory management API', () => {
  it('allows a venue admin to create and update a room in their venue', async () => {
    const created = await request(app).post(`/api/venues/${venueA}/rooms`).set(authorized(adminA)).send({
      name: 'Room A', capacity: 4, hourlyRateMinor: 2500, amenities: ['quiet'],
    });
    expect(created.status).toBe(201);

    const updated = await request(app).patch(`/api/rooms/${created.body.room.id}`).set(authorized(adminA)).send({ hourlyRateMinor: 3000 });
    expect(updated.status).toBe(200);
    expect(updated.body.room.hourlyRateMinor).toBe(3000);
    await prisma.room.delete({ where: { id: created.body.room.id } });
  });

  it('blocks cross-venue room and equipment mutation by direct ID', async () => {
    const room = await request(app).patch(`/api/rooms/${roomB}`).set(authorized(adminA)).send({ name: 'Tampered' });
    const equipment = await request(app).patch(`/api/equipment/${equipmentB}`).set(authorized(adminA)).send({ totalUnits: 1 });
    expect(room.status).toBe(403);
    expect(equipment.status).toBe(403);
  });

  it('allows a venue admin to create and update equipment', async () => {
    const created = await request(app).post(`/api/venues/${venueA}/equipment`).set(authorized(adminA)).send({
      name: 'Camera A', hourlyRateMinor: 700, totalUnits: 3,
    });
    expect(created.status).toBe(201);
    const updated = await request(app).patch(`/api/equipment/${created.body.equipment.id}`).set(authorized(adminA)).send({ totalUnits: 4 });
    expect(updated.status).toBe(200);
    expect(updated.body.equipment.totalUnits).toBe(4);
    await prisma.equipmentType.delete({ where: { id: created.body.equipment.id } });
  });

  it.each([['staff', staffA], ['customer', customerA]])('%s cannot manage inventory', async (_label, userId) => {
    const response = await request(app).post(`/api/venues/${venueA}/rooms`).set(authorized(userId)).send({
      name: 'Denied', capacity: 2, hourlyRateMinor: 1000,
    });
    expect(response.status).toBe(403);
  });

  it('allows a platform admin to manage another venue', async () => {
    const response = await request(app).patch(`/api/rooms/${roomB}`).set(authorized(platformAdmin)).send({ hourlyRateMinor: 1200 });
    expect(response.status).toBe(200);
    expect(response.body.room.hourlyRateMinor).toBe(1200);
  });
});
