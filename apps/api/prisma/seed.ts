import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Auth is out of scope, so the system has exactly one partner and every
 * request resolves to it. Seeding is idempotent: re-running never creates a
 * second partner, which would break the "one open session" lookup.
 */
async function main(): Promise<void> {
  const name = process.env.PARTNER_NAME ?? 'CompanyABC';

  const partner = await prisma.partner.upsert({
    where: { name },
    update: {},
    create: { name },
  });

  console.log(`Seeded partner "${partner.name}" (${partner.id})`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
