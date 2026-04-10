import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const recording = await prisma.recording.findUnique({
      where: { id: params.id },
      include: { transcript: true, summary: true },
    });

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    return NextResponse.json(recording);
  } catch (error) {
    console.error('[recording] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch recording' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { title } = await request.json() as { title?: string };
    if (!title || !title.trim()) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    const recording = await prisma.recording.update({
      where: { id: params.id },
      data: { title: title.trim() },
    });
    return NextResponse.json({ title: recording.title });
  } catch (error) {
    console.error('[recording] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to rename recording' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    await prisma.recording.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[recording] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete recording' }, { status: 500 });
  }
}
