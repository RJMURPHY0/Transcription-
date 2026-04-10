import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const recordings = await prisma.recording.findMany({
      include: { summary: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(recordings);
  } catch (error) {
    console.error('[recordings] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch recordings' }, { status: 500 });
  }
}
