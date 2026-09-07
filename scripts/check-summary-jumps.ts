// Where does each summary line actually land in the transcript?
//
// Action items, key points and decisions are paraphrases, so the jump target is
// found by text matching (lib/transcript-match.ts). This prints, per line, the
// block it resolves to and the phrase that would be highlighted, so a bad match
// is visible without clicking through the UI.
//
//   npx tsx scripts/check-summary-jumps.ts [recordingId]
//   npx tsx scripts/check-summary-jumps.ts --list
//   npx tsx scripts/check-summary-jumps.ts <recordingId> --debug   (top candidates)
//
// With no id it takes the most recent completed recording that has a summary.
import { readFileSync } from 'fs';
import path from 'path';

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

import { PrismaClient } from '@prisma/client';
import { createSegmentMatcher } from '../lib/transcript-match';

interface Segment { speaker: string; start: number; end: number; text: string }

function fmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function mergeSegments(segs: Segment[]) {
  return segs.reduce<Array<{ speaker: string; start: number; text: string }>>((acc, seg) => {
    const last = acc[acc.length - 1];
    if (last && last.speaker === String(seg.speaker)) last.text += ' ' + seg.text.trim();
    else acc.push({ speaker: String(seg.speaker), start: seg.start, text: seg.text.trim() });
    return acc;
  }, []);
}

async function main() {
  const prisma = new PrismaClient();
  const arg = process.argv[2];

  if (arg === '--list') {
    const rows = await prisma.recording.findMany({
      where: { summary: { isNot: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, title: true, createdAt: true },
    });
    for (const r of rows) console.log(r.id, '|', r.createdAt.toISOString().slice(0, 10), '|', r.title);
    await prisma.$disconnect();
    return;
  }

  const debug = process.argv.includes('--debug');
  const id = arg && !arg.startsWith('--') ? arg : undefined;

  const recording = id
    ? await prisma.recording.findUnique({ where: { id }, include: { transcript: true, summary: true } })
    : await prisma.recording.findFirst({
        where: { summary: { isNot: null }, transcript: { isNot: null } },
        orderBy: { createdAt: 'desc' },
        include: { transcript: true, summary: true },
      });

  if (!recording?.transcript || !recording.summary) {
    console.error('No recording with both a transcript and a summary.');
    process.exit(1);
  }

  const parse = <T,>(raw: unknown, fallback: T): T => {
    if (typeof raw !== 'string') return (raw as T) ?? fallback;
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  };

  const segments = parse<Segment[]>(recording.transcript.segments, []);
  const groups = mergeSegments(segments);
  const texts = groups.map((g) => g.text.trim());
  const matcher = createSegmentMatcher(texts);

  const s = recording.summary as unknown as Record<string, unknown>;
  const lines: Array<{ kind: string; text: string }> = [];
  for (const [kind, field] of [['action', 'actionItems'], ['key point', 'keyPoints'], ['decision', 'decisions']] as const) {
    const arr = parse<unknown[]>(s[field], []);
    if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string') lines.push({ kind, text: v });
  }

  console.log(`Recording ${recording.id} — "${recording.title ?? 'untitled'}"`);
  console.log(`${groups.length} blocks, ${lines.length} summary lines\n`);

  let unmatched = 0;
  for (const line of lines) {
    const loc = matcher.locate(line.text);
    console.log(`[${line.kind}] ${line.text}`);
    if (debug) {
      for (const c of matcher.explain(line.text, 3)) {
        console.log(
          `   · block ${String(c.index).padStart(3)}  score ${c.score.toFixed(2).padStart(6)}` +
          `  coverage ${(c.coverage * 100).toFixed(0).padStart(3)}%  hits ${c.hits}` +
          `  ${c.accepted ? 'ok' : 'below floor'}  "${texts[c.index].slice(0, 60)}…"`,
        );
      }
    }
    if (loc.index < 0) {
      unmatched++;
      console.log('   → no confident match\n');
      continue;
    }
    const block = texts[loc.index];
    const phrase = loc.span ? block.slice(loc.span[0], loc.span[1]) : '(whole block)';
    console.log(`   → block ${loc.index} @ ${fmt(groups[loc.index].start)} (${groups[loc.index].speaker}), ${block.split(/\s+/).length} words`);
    console.log(`   → "${phrase.slice(0, 220)}"\n`);
  }
  console.log(`${lines.length - unmatched}/${lines.length} matched, ${unmatched} left unpinned`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
