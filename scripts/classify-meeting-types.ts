// Give the existing recordings a meeting type.
//
// The type used to be a chip you picked before pressing record, defaulting to
// "General" — so every recording ever made is General, and the meeting-type
// filter matches nothing useful. New recordings are classified from the
// transcript at finalize; this does the same for the ones already in the
// database.
//
//   npx tsx scripts/classify-meeting-types.ts            # dry run, changes nothing
//   npx tsx scripts/classify-meeting-types.ts --run      # write the results
//   npx tsx scripts/classify-meeting-types.ts --run --all # also re-do explicit picks
//
// Only touches recordings whose type is still the untouched default, unless
// --all is given. Safe to re-run: a recording already classified is skipped.
import { readFileSync } from 'fs';
import path from 'path';

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

import { PrismaClient } from '@prisma/client';
import { classifyMeetingType } from '../lib/ai';

async function main() {
  const prisma = new PrismaClient();
  const args = process.argv.slice(2);
  const write = args.includes('--run');
  const all   = args.includes('--all');

  const recordings = await prisma.recording.findMany({
    where: {
      deletedAt: null,
      status: 'completed',
      transcript: { isNot: null },
      ...(all ? {} : { meetingType: { in: ['general', 'auto'] } }),
    },
    select: { id: true, title: true, meetingType: true, transcript: { select: { fullText: true } } },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`${recordings.length} recordings to classify${write ? '' : ' (dry run — pass --run to write)'}\n`);

  const tally: Record<string, number> = {};
  let changed = 0;

  for (const rec of recordings) {
    const text = rec.transcript?.fullText ?? '';
    if (text.trim().length < 200) {
      console.log(`skip  ${rec.id}  ${rec.title.slice(0, 44).padEnd(44)}  transcript too short`);
      continue;
    }

    const type = await classifyMeetingType(text);
    tally[type] = (tally[type] ?? 0) + 1;
    const moved = type !== rec.meetingType;
    if (moved) changed++;

    console.log(`${moved ? 'set ' : 'keep'}  ${rec.id}  ${rec.title.slice(0, 44).padEnd(44)}  ${rec.meetingType} -> ${type}`);

    if (write && moved) {
      await prisma.recording.update({ where: { id: rec.id }, data: { meetingType: type } });
    }
  }

  console.log(`\n${changed} of ${recordings.length} would change${write ? ' (written)' : ''}`);
  console.log('spread:', Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(', ') || '—');

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
