import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { hashPassword } from '../src/services/passwordService';

const prisma = new PrismaClient();
const profiles = {
  demo: { venues: 8, rooms: 60, equipment: 200, bookings: 25000, users: 400 },
  full: { venues: 40, rooms: 800, equipment: 2500, bookings: 250000, users: 5000 },
} as const;

type ProfileName = keyof typeof profiles;

const DEMO_PASSWORD = 'Password123!';

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function distribute(total: number, count: number, index: number): number {
  return Math.floor(total / count) + (index < total % count ? 1 : 0);
}

async function seedDemoAccounts(venueAId: string, venueBId: string): Promise<void> {
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const accounts = [
    { id: randomUUID(), email: 'customer@atrium.local', roles: [{ role: UserRole.CUSTOMER, venueId: venueAId }] },
    { id: randomUUID(), email: 'staff@atrium.local', roles: [{ role: UserRole.VENUE_STAFF, venueId: venueAId }] },
    { id: randomUUID(), email: 'admin-a@atrium.local', roles: [{ role: UserRole.VENUE_ADMIN, venueId: venueAId }] },
    { id: randomUUID(), email: 'admin-b@atrium.local', roles: [{ role: UserRole.VENUE_ADMIN, venueId: venueBId }] },
    { id: randomUUID(), email: 'platform@atrium.local', roles: [{ role: UserRole.PLATFORM_ADMIN, venueId: venueAId }] },
  ];

  for (const account of accounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      create: { id: account.id, email: account.email, passwordHash },
      update: { passwordHash },
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: account.email } });
    await prisma.userVenueRole.deleteMany({ where: { userId: user.id } });
    await prisma.userVenueRole.createMany({
      data: account.roles.map((role) => ({ userId: user.id, venueId: role.venueId, role: role.role })),
    });
  }

  await prisma.cancellationPolicy.createMany({
    data: [
      {
        venueId: venueAId,
        version: 1,
        active: true,
        tiers: {
          moreThan48: { roomPercent: 100, equipmentPercent: 100 },
          between24And48: { roomPercent: 50, equipmentPercent: 100 },
          lessThan24: { roomPercent: 0, equipmentPercent: 100 },
        },
      },
      {
        venueId: venueBId,
        version: 1,
        active: true,
        tiers: {
          moreThan48: { roomPercent: 100, equipmentPercent: 100 },
          between24And48: { roomPercent: 50, equipmentPercent: 100 },
          lessThan24: { roomPercent: 0, equipmentPercent: 100 },
        },
      },
    ],
    skipDuplicates: true,
  });

  console.log('Demo logins (password Password123!): customer@, staff@, admin-a@, admin-b@, platform@ atrium.local');
}

async function main(): Promise<void> {
  const requestedProfile = process.argv.find((argument) => argument.startsWith('--profile='))?.split('=')[1] as ProfileName | undefined;
  if (!requestedProfile || !(requestedProfile in profiles)) throw new Error('Use --profile=demo or --profile=full');
  const profile = profiles[requestedProfile];

  const venueIds = Array.from({ length: profile.venues }, () => randomUUID());
  await prisma.venue.createMany({
    data: venueIds.map((id, index) => ({
      id, name: `Atrium Venue ${index + 1}`, city: ['Karachi', 'Dubai', 'London'][index % 3], timezone: ['Asia/Karachi', 'Asia/Dubai', 'Europe/London'][index % 3], operatingSchedule: { Monday: [{ open: '08:00', close: '22:00' }], Tuesday: [{ open: '08:00', close: '22:00' }], Wednesday: [{ open: '08:00', close: '22:00' }], Thursday: [{ open: '08:00', close: '22:00' }], Friday: [{ open: '08:00', close: '22:00' }], Saturday: [{ open: '09:00', close: '22:00' }], Sunday: [{ open: '09:00', close: '18:00' }] },
    })),
  });

  const roomIds: string[] = [];
  for (let venueIndex = 0; venueIndex < venueIds.length; venueIndex += 1) {
    const roomsAtVenue = distribute(profile.rooms, profile.venues, venueIndex);
    const rooms = Array.from({ length: roomsAtVenue }, (_, roomIndex) => {
      const id = randomUUID();
      roomIds.push(id);
      return { id, venueId: venueIds[venueIndex], name: `Room ${venueIndex + 1}-${roomIndex + 1}`, capacity: 2 + (roomIndex % 10), hourlyRateMinor: 5000 + (roomIndex % 8) * 1250, currency: 'PKR', amenities: roomIndex % 2 === 0 ? ['daylight', 'quiet'] : ['soundproof'], minDurationMinutes: 60, maxDurationMinutes: 480, overbookingPercent: 0 };
    });
    await prisma.room.createMany({ data: rooms });
  }

  for (let venueIndex = 0; venueIndex < venueIds.length; venueIndex += 1) {
    const equipmentAtVenue = distribute(profile.equipment, profile.venues, venueIndex);
    const equipmentTypeCount = Math.max(2, Math.ceil(equipmentAtVenue / 10));
    await prisma.equipmentType.createMany({ data: Array.from({ length: equipmentTypeCount }, (_, equipmentIndex) => ({
      id: randomUUID(),
      venueId: venueIds[venueIndex],
      name: `Equipment ${venueIndex + 1}-${equipmentIndex + 1}`,
      hourlyRateMinor: 1000 + equipmentIndex * 100,
      currency: 'PKR',
      totalUnits: equipmentIndex === 0 ? 3 : distribute(equipmentAtVenue - 3, equipmentTypeCount - 1, equipmentIndex - 1),
      overbookingPercent: 0,
    })) });
  }

  const demoAccountCount = 5;
  const generatedUserCount = profile.users - demoAccountCount;
  if (generatedUserCount < 0) throw new Error('Profile user count must include the five demo accounts');
  const userIds = Array.from({ length: generatedUserCount }, () => randomUUID());
  for (const users of chunk(userIds.map((id, index) => ({ id, email: `seed-user-${index + 1}@atrium.local`, passwordHash: 'seed-password-not-for-login' })), 1000)) {
    await prisma.user.createMany({ data: users });
  }

  for (const bookings of chunk(Array.from({ length: profile.bookings }, (_, index) => {
    const id = randomUUID();
    const roomId = roomIds[index % roomIds.length];
    const userId = userIds[index % userIds.length];
    const monthIndex = index % 24;
    const start = new Date(Date.UTC(2024 + Math.floor(monthIndex / 12), monthIndex % 12, 1 + (index % 27), 8 + (index % 8), (index % 2) * 30));
    const end = new Date(start.getTime() + (60 + (index % 8) * 60) * 60000);
    return Prisma.sql`(${id}::uuid, ${userId}::uuid, ${roomId}::uuid, tstzrange(${start}, ${end}, '[)'), tstzrange(${start}, ${end}, '[)'), 'COMPLETED'::"BookingStatus", ${5000 + (index % 20) * 500}, 'PKR', '{}'::jsonb, '{}'::jsonb, now(), now())`;
  }), 500)) {
    await prisma.$executeRaw(Prisma.sql`INSERT INTO bookings (id, user_id, room_id, slot, protected_slot, status, amount_minor, currency, pricing_snapshot, policy_snapshot, created_at, updated_at) VALUES ${Prisma.join(bookings)}`);
  }

  await seedDemoAccounts(venueIds[0], venueIds[1] ?? venueIds[0]);

  console.log(`Seeded ${requestedProfile}: ${profile.venues} venues, ${profile.rooms} rooms, ${profile.equipment} equipment units, ${profile.bookings} bookings, ${profile.users} users`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
