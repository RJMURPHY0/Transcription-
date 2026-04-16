import { randomUUID } from 'crypto';
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

const LOCK_MS = 8 * 60 * 1000;
const MAX_CHUNK_TRANSCRIBE_ATTEMPTS_PER_RUN = 4;

type FinalizeResult =
  | { ok: true; completed: true; failedChunks: 0; pendingChunks: 0 }
  | { ok: true; completed: false; failedChunks: number; pendingChunks: number; reason: string }
  | { ok: false; reason: string };

function isLockStale(lockUntil: Date | null): boolean {
  return !lockUntil || lockUntil.getTime() < Date.now();
}

async function acquireLock(recordingId: string): Promise<string | null> {
  const token = randomUUID();
  const lockUntil = new Date(Date.now() + LOCK_MS);

  const claim = await prisma.recording.updateMany({
    where: {
      id: recordingId,
      OR: [{ lockUntil: null }, { lockUntil: { lt: new Date() } }],
    },
    data: {
      lockToken: token,
      lockUntil,
      status: 'processing',
    },
  });

  if (claim.count > 0) return token;

  const current = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: { lockUntil: true, lockToken: true },
  });

  if (!current) return null;

  if (isLockStale(current.lockUntil)) {
    const steal = await prisma.recording.updateMany({
      where: { id: recordingId },
      data: {
        lockToken: token,
        lockUntil,
        status: 'processing',
      },
    });
    if (steal.count > 0) return token;
  }

  return null;
}

async function refreshLock(recordingId: string, token: string): Promise<void> {
  await prisma.recording.updateMany({
    where: { id: recordingId, lockToken: token },
    data: { lockUntil: new Date(Date.now() + LOCK_MS) },
  });
}

async function releaseLock(recordingId: string, token: string): Promise<void> {
  await prisma.recording.updateMany({
    where: { id: recordingId, lockToken: token },
    data: { lockToken: null, lockUntil: null },
  });
}

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

  for (let attempt = 0; attempt < MAX_CHUNK_TRANSCRIBE_ATTEMPTS_PER_RUN; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }

    try {
      return await withTempFile(audioData, ext, (fp) => transcribeAudio(fp));
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error('Transcription error');
    }
  }

  throw lastErr;
}

async function processPendingChunks(recordingId: string, token: string): Promise<void> {
  const chunks = await prisma.chunkBlob.findMany({
    where: {
      recordingId,
      status: { in: ['pending', 'failed', 'processing'] },
    },
    orderBy: { offset: 'asc' },
  });

  for (const chunk of chunks) {
    await refreshLock(recordingId, token);

    const claimed = await prisma.chunkBlob.updateMany({
      where: {
        id: chunk.id,
        status: { in: ['pending', 'failed', 'processing'] },
      },
      data: {
        status: 'processing',
        attempts: { increment: 1 },
        lastError: '',
      },
    });

    if (claimed.count === 0) continue;

    const ext = chunk.mimeType.includes('mp4') ? '.mp4'
      : chunk.mimeType.includes('ogg') ? '.ogg'
      : '.webm';

    try {
      const { text, rawSegments } = await transcribeChunkWithRetry(chunk.audioData as Buffer, ext);

      await prisma.chunkBlob.update({
        where: { id: chunk.id },
        data: {
          status: 'succeeded',
          transcript: text.trim(),
          segments: JSON.stringify(rawSegments),
          lastError: '',
          processedAt: new Date(),
          audioData: Buffer.alloc(0),
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transcription failed';
      await prisma.chunkBlob.update({
        where: { id: chunk.id },
        data: {
          status: 'failed',
          lastError: msg.slice(0, 500),
          processedAt: null,
        },
      });
    }
  }
}

async function rebuildTranscript(recordingId: string): Promise<void> {
  const doneChunks = await prisma.chunkBlob.findMany({
    where: { recordingId, status: 'succeeded' },
    orderBy: [{ offset: 'asc' }, { createdAt: 'asc' }],
    select: {
      offset: true,
      transcript: true,
      segments: true,
    },
  });

  if (doneChunks.length === 0) return;

  let fullText = '';
  const allSegments: RawSegment[] = [];

  for (const chunk of doneChunks) {
    if (chunk.transcript.trim()) {
      fullText += (fullText ? ' ' : '') + chunk.transcript.trim();
    }

    let parsed: RawSegment[] = [];
    try {
      parsed = JSON.parse(chunk.segments) as RawSegment[];
    } catch {
      parsed = [];
    }

    const shifted = parsed.map((s) => ({
      start: s.start + chunk.offset,
      end: s.end + chunk.offset,
      text: s.text,
    }));

    allSegments.push(...shifted);
  }

  if (!fullText.trim()) return;

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

export async function finalizeRecording(recordingId: string): Promise<FinalizeResult> {
  const lockToken = await acquireLock(recordingId);
  if (!lockToken) {
    return { ok: true, completed: false, failedChunks: 0, pendingChunks: 0, reason: 'already-processing' };
  }

  try {
    await processPendingChunks(recordingId, lockToken);
    await rebuildTranscript(recordingId);

    const [pendingChunks, failedChunks, transcript] = await Promise.all([
      prisma.chunkBlob.count({ where: { recordingId, status: { in: ['pending', 'processing'] } } }),
      prisma.chunkBlob.count({ where: { recordingId, status: 'failed' } }),
      prisma.transcript.findUnique({ where: { recordingId } }),
    ]);

    if (!transcript || !transcript.fullText.trim()) {
      await prisma.recording.update({ where: { id: recordingId }, data: { status: 'failed' } }).catch(() => {});
      return { ok: false, reason: 'No transcript to analyse.' };
    }

    if (pendingChunks > 0 || failedChunks > 0) {
      await prisma.recording.update({ where: { id: recordingId }, data: { status: 'failed' } }).catch(() => {});
      return {
        ok: true,
        completed: false,
        pendingChunks,
        failedChunks,
        reason: 'Some chunks failed and are preserved for retry.',
      };
    }

    await refreshLock(recordingId, lockToken);

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
  } finally {
    await releaseLock(recordingId, lockToken);
  }
}
