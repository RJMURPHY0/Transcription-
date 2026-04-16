import { writeFile, unlink } from 'fs/promises';
import os from 'os';
import path from 'path';
import { prisma } from '@/lib/db';
import {
  transcribeAudio,
  diarizeSegments,
  analyzeTranscript,
  generateTitle,
  generateTopics,
} from '@/lib/ai';
import type { RawSegment } from '@/lib/ai';

const MAX_CHUNK_TRANSCRIBE_ATTEMPTS = 4;

type FinalizeResult =
  | { ok: true; completed: true; failedChunks: 0; pendingChunks: 0 }
  | { ok: true; completed: false; failedChunks: number; pendingChunks: number; reason: string }
  | { ok: false; reason: string };

async function withTempFile<T>(
  data: Buffer,
  ext: string,
  fn: (filePath: string) => Promise<T>,
): Promise<T> {
  const tempPath = path.join(os.tmpdir(), `chunk-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  await writeFile(tempPath, data);
  try {
    return await fn(tempPath);
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

async function transcribeChunkWithRetry(
  audioData: Buffer,
  ext: string,
): Promise<{ text: string; rawSegments: RawSegment[] }> {
  let lastErr: Error = new Error('Transcription failed');

  for (let attempt = 0; attempt < MAX_CHUNK_TRANSCRIBE_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }

    try {
      return await withTempFile(audioData, ext, (fp) => transcribeAudio(fp));
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error('Transcription error');
      console.warn(`[finalize] chunk attempt ${attempt + 1}/${MAX_CHUNK_TRANSCRIBE_ATTEMPTS} failed:`, lastErr.message);
    }
  }

  throw lastErr;
}

export async function finalizeRecording(recordingId: string): Promise<FinalizeResult> {
  try {
    await prisma.recording.update({ where: { id: recordingId }, data: { status: 'processing' } }).catch(() => {});

    const chunks = await prisma.chunkBlob.findMany({
      where: { recordingId },
      orderBy: { offset: 'asc' },
    });

    let failedChunks = 0;

    if (chunks.length > 0) {
      let fullText = '';
      const allSegments: RawSegment[] = [];

      for (const chunk of chunks) {
        const ext = chunk.mimeType.includes('mp4') ? '.mp4'
          : chunk.mimeType.includes('ogg') ? '.ogg'
          : '.webm';

        try {
          const { text, rawSegments } = await transcribeChunkWithRetry(chunk.audioData as Buffer, ext);
          if (text.trim()) {
            fullText += (fullText ? ' ' : '') + text.trim();
          }

          const shifted = rawSegments.map((s) => ({
            start: s.start + chunk.offset,
            end: s.end + chunk.offset,
            text: s.text,
          }));
          allSegments.push(...shifted);
        } catch (err) {
          failedChunks += 1;
          console.error(`[finalize] chunk ${chunk.id} failed after retries:`, err);
        }
      }

      if (fullText.trim()) {
        await prisma.transcript.upsert({
          where: { recordingId },
          create: {
            recordingId,
            fullText,
            segments: JSON.stringify(allSegments),
          },
          update: {
            fullText,
            segments: JSON.stringify(allSegments),
          },
        });
      }

      if (failedChunks === 0) {
        await prisma.chunkBlob.deleteMany({ where: { recordingId } });
      } else {
        await prisma.recording.update({ where: { id: recordingId }, data: { status: 'failed' } }).catch(() => {});
        return {
          ok: true,
          completed: false,
          failedChunks,
          pendingChunks: 0,
          reason: 'Some chunks failed. Audio was preserved so retry can continue.',
        };
      }
    }

    const transcript = await prisma.transcript.findUnique({ where: { recordingId } });
    if (!transcript || !transcript.fullText.trim()) {
      await prisma.recording.update({ where: { id: recordingId }, data: { status: 'failed' } }).catch(() => {});
      return { ok: false, reason: 'No transcript to analyse.' };
    }

    const rawSegments: RawSegment[] = JSON.parse(transcript.segments);

    const [diarized, analysis, shortTitle, topics] = await Promise.all([
      diarizeSegments(rawSegments),
      analyzeTranscript(transcript.fullText),
      generateTitle(transcript.fullText),
      generateTopics(rawSegments),
    ]);

    const dateStr = new Date().toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
    const title = shortTitle ? `${shortTitle} - ${dateStr}` : null;

    await prisma.transcript.update({
      where: { recordingId },
      data: { segments: JSON.stringify(diarized) },
    });

    await prisma.summary.upsert({
      where: { recordingId },
      create: {
        recordingId,
        overview: analysis.overview,
        keyPoints: JSON.stringify(analysis.keyPoints),
        actionItems: JSON.stringify(analysis.actionItems),
        decisions: JSON.stringify(analysis.decisions),
        topics: JSON.stringify(topics),
      },
      update: {
        overview: analysis.overview,
        keyPoints: JSON.stringify(analysis.keyPoints),
        actionItems: JSON.stringify(analysis.actionItems),
        decisions: JSON.stringify(analysis.decisions),
        topics: JSON.stringify(topics),
      },
    });

    await prisma.recording.update({
      where: { id: recordingId },
      data: { status: 'completed', ...(title ? { title } : {}) },
    });

    return { ok: true, completed: true, failedChunks: 0, pendingChunks: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Finalization failed.';
    await prisma.recording.update({ where: { id: recordingId }, data: { status: 'failed' } }).catch(() => {});
    return { ok: false, reason: message };
  }
}
