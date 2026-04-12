import { NextRequest, NextResponse } from 'next/server';
import { writeFile, unlink } from 'fs/promises';
import path from 'path';
import os from 'os';
import { prisma } from '@/lib/db';
import { transcribeAudio } from '@/lib/ai';
import type { RawSegment } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  let tempPath: string | null = null;

  try {
    const formData = await request.formData();
    const file = formData.get('audio') as File | null;
    const offsetStr = formData.get('offset') as string | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'No audio provided.' }, { status: 400 });
    }

    const timeOffset = parseFloat(offsetStr ?? '0');

    // Write chunk to temp file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const ext = file.type.includes('mp4') ? '.mp4' : '.webm';
    tempPath = path.join(os.tmpdir(), `chunk-${Date.now()}${ext}`);
    await writeFile(tempPath, buffer);

    // Transcribe the chunk
    const { text, rawSegments } = await transcribeAudio(tempPath);

    // Offset all segment timestamps by the cumulative recording time
    const offsetSegments: RawSegment[] = rawSegments.map((s) => ({
      start: s.start + timeOffset,
      end: s.end + timeOffset,
      text: s.text,
    }));

    // Upsert transcript: create on first chunk, append on subsequent chunks
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
    const message = error instanceof Error ? error.message : 'Chunk processing failed.';
    console.error('[append-chunk] Error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => {});
  }
}
