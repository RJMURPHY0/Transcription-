import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { diarizeSegments, identifySpeakerNames } from '@/lib/ai';
import type { TranscriptSegment, RawSegment } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const CUID_RE = /^c[a-z0-9]{20,}$/;

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!CUID_RE.test(params.id)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const transcript = await prisma.transcript.findUnique({
    where: { recordingId: params.id },
  });

  if (!transcript) {
    return NextResponse.json({ error: 'No transcript found for this recording.' }, { status: 404 });
  }

  let existing: TranscriptSegment[] = [];
  try {
    existing = JSON.parse(transcript.segments) as TranscriptSegment[];
  } catch {
    return NextResponse.json({ error: 'Could not parse transcript segments.' }, { status: 500 });
  }

  if (!existing.length) {
    return NextResponse.json({ error: 'Transcript has no segments to diarise.' }, { status: 400 });
  }

  // Strip speaker labels — we only need the raw audio-derived timing and text
  const rawSegments: RawSegment[] = existing.map(s => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  try {
    const diarized = await diarizeSegments(rawSegments);
    const speakerNames = await identifySpeakerNames(diarized);
    const finalSegments = Object.keys(speakerNames).length > 0
      ? diarized.map(seg => ({ ...seg, speaker: speakerNames[seg.speaker] ?? seg.speaker }))
      : diarized;

    await prisma.transcript.update({
      where: { recordingId: params.id },
      data: { segments: JSON.stringify(finalSegments) },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[rediarize]', err);
    return NextResponse.json({ error: 'Diarization failed.' }, { status: 500 });
  }
}
