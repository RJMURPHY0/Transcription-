import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

const dbUrl = process.env.DATABASE_URL ?? '';
if (process.env.NODE_ENV === 'production' && dbUrl && !dbUrl.includes('supabase.co')) {
  console.warn('[db] DATABASE_URL does not look like Supabase; recordings/transcripts may not be in Supabase.');
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
