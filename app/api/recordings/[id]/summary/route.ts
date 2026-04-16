import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CUID_RE = /^c[a-z0-9]{20,}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid recording ID.' }, { status: 400 });
  }

  try {
    const body = await request.json() as Record<string, unknown>;
    const { overview, keyPoints, actionItems, decisions, topics } = body;

    const data: Record<string, string> = {};
    if (overview !== undefined)    data.overview    = String(overview);
    if (keyPoints !== undefined)   data.keyPoints   = JSON.stringify(keyPoints);
    if (actionItems !== undefined) data.actionItems = JSON.stringify(actionItems);
    if (decisions !== undefined)   data.decisions   = JSON.stringify(decisions);
    if (topics !== undefined)      data.topics      = JSON.stringify(topics);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
    }

    await prisma.summary.update({ where: { recordingId: params.id }, data });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[summary PATCH]', error);
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 });
  }
}
