import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { finalizeRecording } from '@/lib/finalize-recording';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_RECORDINGS_PER_RUN = 5;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

async function runWorker() {
  const candidates = await prisma.recording.findMany({
    where: {
      status: { in: ['uploading', 'processing', 'failed'] },
      chunks: { some: {} },
    },
    orderBy: { createdAt: 'asc' },
    take: MAX_RECORDINGS_PER_RUN,
    select: { id: true },
  });

  let completed = 0;
  let partial = 0;
  let failed = 0;

  for (const rec of candidates) {
    const result = await finalizeRecording(rec.id);
    if (!result.ok) {
      failed += 1;
      continue;
    }
    if (result.completed) {
      completed += 1;
    } else {
      partial += 1;
    }
  }

  return {
    scanned: candidates.length,
    completed,
    partial,
    failed,
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = await runWorker();
  return NextResponse.json({ ok: true, ...stats });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
