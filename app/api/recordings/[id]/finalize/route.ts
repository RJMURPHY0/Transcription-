import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { diarizeSegments, analyzeTranscript } from '@/lib/ai';
import type { RawSegment } from '@/lib/ai';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const transcript = await prisma.transcript.findUnique({
      where: { recordingId: params.id },
    });

    if (!transcript) {
      return NextResponse.json({ error: 'No transcript found.' }, { status: 404 });
    }

    const rawSegments: RawSegment[] = JSON.parse(transcript.segments);

    // Run diarization (assign speaker labels)
    const diarized = await diarizeSegments(rawSegments);

    // Run AI analysis on the full assembled text
    const analysis = await analyzeTranscript(transcript.fullText);

    // Save diarized segments back to transcript
    await prisma.transcript.update({
      where: { recordingId: params.id },
      data: { segments: JSON.stringify(diarized) },
    });

    // Save summary
    await prisma.summary.upsert({
      where: { recordingId: params.id },
      create: {
        recordingId: params.id,
        overview: analysis.overview,
        keyPoints: JSON.stringify(analysis.keyPoints),
        actionItems: JSON.stringify(analysis.actionItems),
        decisions: JSON.stringify(analysis.decisions),
      },
      update: {
        overview: analysis.overview,
        keyPoints: JSON.stringify(analysis.keyPoints),
        actionItems: JSON.stringify(analysis.actionItems),
        decisions: JSON.stringify(analysis.decisions),
      },
    });

    // Mark recording as completed
    await prisma.recording.update({
      where: { id: params.id },
      data: { status: 'completed' },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Finalization failed.';
    console.error('[finalize] Error:', error);
    // Mark as failed so it doesn't hang
    await prisma.recording.update({
      where: { id: params.id },
      data: { status: 'failed' },
    }).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
