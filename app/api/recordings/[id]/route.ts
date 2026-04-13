import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CUID_RE = /^c[a-z0-9]{20,}$/;
const MAX_TITLE_LEN = 120;

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid recording ID.' }, { status: 400 });
  }
  try {
    const recording = await prisma.recording.findUnique({
      where: { id: params.id },
      include: { transcript: true, summary: true },
    });
    if (!recording) {
      return NextResponse.json({ error: 'Recording not found.' }, { status: 404 });
    }
    return NextResponse.json(recording);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch recording.' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid recording ID.' }, { status: 400 });
  }
  try {
    const body = await request.json() as { title?: unknown };
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE_LEN) : '';
    if (!title) {
      return NextResponse.json({ error: 'Title cannot be empty.' }, { status: 400 });
    }
    const recording = await prisma.recording.update({
      where: { id: params.id },
      data: { title },
    });
    return NextResponse.json({ title: recording.title });
  } catch {
    return NextResponse.json({ error: 'Failed to rename recording.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid recording ID.' }, { status: 400 });
  }
  try {
    await prisma.recording.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete recording.' }, { status: 500 });
  }
}
