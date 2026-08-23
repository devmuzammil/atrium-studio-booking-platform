import { Prisma, PrismaClient } from '@prisma/client';

export interface PolicyTiers {
  moreThan48: { roomPercent: number; equipmentPercent: number };
  between24And48: { roomPercent: number; equipmentPercent: number };
  lessThan24: { roomPercent: number; equipmentPercent: number };
}

export function defaultPolicyTiers(): PolicyTiers {
  return {
    moreThan48: { roomPercent: 100, equipmentPercent: 100 },
    between24And48: { roomPercent: 50, equipmentPercent: 100 },
    lessThan24: { roomPercent: 0, equipmentPercent: 100 },
  };
}

function assertTier(value: unknown, name: string): { roomPercent: number; equipmentPercent: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw Object.assign(new Error(`${name} must be an object`), { statusCode: 400 });
  }
  const tier = value as Record<string, unknown>;
  if (typeof tier.roomPercent !== 'number' || typeof tier.equipmentPercent !== 'number') {
    throw Object.assign(new Error(`${name} requires roomPercent and equipmentPercent`), { statusCode: 400 });
  }
  if (tier.roomPercent < 0 || tier.roomPercent > 100 || tier.equipmentPercent < 0 || tier.equipmentPercent > 100) {
    throw Object.assign(new Error(`${name} percents must be between 0 and 100`), { statusCode: 400 });
  }
  return { roomPercent: tier.roomPercent, equipmentPercent: tier.equipmentPercent };
}

export function parsePolicyTiers(value: unknown): PolicyTiers {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw Object.assign(new Error('tiers must be an object'), { statusCode: 400 });
  }
  const record = value as Record<string, unknown>;
  return {
    moreThan48: assertTier(record.moreThan48, 'moreThan48'),
    between24And48: assertTier(record.between24And48, 'between24And48'),
    lessThan24: assertTier(record.lessThan24, 'lessThan24'),
  };
}

export async function getActivePolicy(database: PrismaClient, venueId: string) {
  const policy = await database.cancellationPolicy.findFirst({
    where: { venueId, active: true },
    orderBy: { version: 'desc' },
  });
  return policy ?? {
    venueId,
    version: 0,
    active: true,
    tiers: defaultPolicyTiers() as unknown as Prisma.JsonValue,
  };
}

export async function replaceActivePolicy(database: PrismaClient, venueId: string, tiers: PolicyTiers) {
  return database.$transaction(async (transaction) => {
    await transaction.cancellationPolicy.updateMany({
      where: { venueId, active: true },
      data: { active: false },
    });
    const latest = await transaction.cancellationPolicy.findFirst({
      where: { venueId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return transaction.cancellationPolicy.create({
      data: {
        venueId,
        version: (latest?.version ?? 0) + 1,
        active: true,
        tiers: tiers as unknown as Prisma.InputJsonValue,
      },
    });
  });
}
