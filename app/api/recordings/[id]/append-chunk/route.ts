import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';
import { prisma } from '@/lib/db';
import { transcribeAudio } from '@/lib/ai';
import type { RawSegment } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CUID_RE = /^c[a-z0-9]{20,}$/;
const ALLOWED_MIME = new Set(['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav']);
const MAX_CHUNK_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid recording ID.' }, { status: 400 });
  }

  let tempPath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get('audio') as File | null;
    const offsetStr = formData.get('offset') as string | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No audio provided.' }, { status: 400 });
    }

    if (file.size > MAX_CHUNK_BYTES) {
      return NextResponse.json({ error: 'Chunk too large (max 10 MB).' }, { status: 413 });
    }

    // Validate MIME type — accept both strict and wildcard matches (e.g. audio/webm;codecs=opus)
    const baseMime = file.type.split(';')[0].trim();
    if (!ALLOWED_MIME.has(baseMime)) {
      return NextResponse.json({ error: 'Invalid file type.' }, { status: 415 });
    }

    const timeOffset = Math.max(0, parseFloat(offsetStr ?? '0'));
    if (!isFinite(timeOffset)) {
      return NextResponse.json({ error: 'Invalid offset.' }, { status: 400 });
    }

    // Verify recording exists
    const recording = await prisma.recording.findUnique({ where: { id: params.id } });
    if (!recording) {
      return NextResponse.json({ error: 'Recording not found.' }, { status: 404 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = baseMime.includes('mp4') ? '.mp4' : baseMime.includes('ogg') ? '.ogg' : '.webm';
    tempPath = path.join(os.tmpdir(), `chunk-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    await writeFile(tempPath, buffer);

    const { text, rawSegments } = await transcribeAudio(tempPath);

    const offsetSegments: RawSegment[] = rawSegments.map((s) => ({
      start: s.start + timeOffset,
      end: s.end + timeOffset,
      text: s.text,
    }));

    const existing = await prisma.transcript.findUnique({
      where: { recordingId: params.id },
    });

    if (!existing) {
      await prisma.transcript.create({
        data: {
          recordingId: params.id,
          fullText: text,
          segments: JSON.stringify(offsetSegments),
        },
      });
    } else {
      const prevSegments: RawSegment[] = JSON.parse(existing.segments);
      await prisma.transcript.update({
        where: { recordingId: params.id },
        data: {
          fullText: existing.fullText + ' ' + text,
          segments: JSON.stringify([...prevSegments, ...offsetSegments]),
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[append-chunk] Error:', error);
    return NextResponse.json({ error: 'Chunk processing failed.' }, { status: 500 });
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => {});
  }
}
