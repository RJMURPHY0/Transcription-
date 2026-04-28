import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch { /* */ }

  return NextResponse.json({
    db,
    openai:     !!(process.env.OPENAI_API_KEY    && !process.env.OPENAI_API_KEY.startsWith('your_')),
    anthropic:  !!(process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith('your_')),
    groq:       !!(process.env.GROQ_API_KEY      && !process.env.GROQ_API_KEY.startsWith('your_')),
    airtable:   !!(process.env.AIRTABLE_API_KEY  && process.env.AIRTABLE_BASE_ID),
  });
}
