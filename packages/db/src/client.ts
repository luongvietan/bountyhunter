import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  __krittRadarPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

/** One client per Node process. Next.js dev hot reload reuses the global instance. */
export const prisma = globalForPrisma.__krittRadarPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__krittRadarPrisma = prisma;
}

export * from '@prisma/client';
