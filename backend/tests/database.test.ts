import { prisma } from '../src/config/prisma';

const databaseConfigured = Boolean(process.env.DATABASE_URL);

(databaseConfigured ? describe : describe.skip)('PostgreSQL connectivity', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects through Prisma and executes a query', async () => {
    const result = await prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 AS result`;

    expect(result[0].result).toBe(1);
  }, 15000);
});