// Does each dashboard filter actually narrow the list?
//
// Every filter travels in the URL and is turned into a Prisma `where` by
// lib/recording-filters.ts. This runs each one against the real database and
// prints the row count, so a filter that silently matches everything (or
// nothing) is obvious without clicking through the UI.
//
//   npx tsx scripts/check-filters.ts
//   npx tsx scripts/check-filters.ts --ai                      (the Ask AI battery)
//   npx tsx scripts/check-filters.ts --ai "long calls with Lee"  (one question)
import { readFileSync } from 'fs';
import path from 'path';

const envFile = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}

import { PrismaClient, type Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import {
  parseFilters, filtersToWhere, filtersToOrderBy, describeFilters, filtersToParams,
} from '../lib/recording-filters';
import { askAiFilter } from '../lib/ai-filter';

const CASES: Array<[name: string, query: string]> = [
  ['no filters',            ''],
  ['source = in person',    'source=web'],
  ['source = online',       'source=teams'],
  ['type = sales',          'type=sales'],
  ['type = general',        'type=general'],
  ['date = today',          'date=today'],
  ['date = this week',      'date=week'],
  ['date = this month',     'date=month'],
  ['date = last 3 months',  'date=quarter'],
  ['date = this year',      'date=year'],
  ['explicit range',        'from=2026-08-01&to=2026-08-31'],
  ['has action items',      'has=actions'],
  ['over 30 minutes',       'minMin=30'],
  ['under 10 minutes',      'maxMin=10'],
  ['terms = qlik',          'terms=qlik'],
  ['terms = qlik,pricing',  'terms=qlik,pricing'],
  ['sort = longest',        'sort=longest'],
  ['combined',              'source=web&date=quarter&terms=crm&has=actions&sort=longest'],
];

async function main() {
  const prisma = new PrismaClient();
  const args = process.argv.slice(2);
  const wantsAi = args.includes('--ai');
  const asked = args.filter((a) => !a.startsWith('--'));
  const questions = asked.length > 0 ? asked : [
    'meetings about pricing',
    'anything with Lee about Qlik',
    'what did we decide about the CRM last month',
    'long meetings this year',
    'short calls under 10 minutes',
    'online meetings',
    'meetings that gave me action items',
    'anything since august about quotes',
    'oldest recordings first',
    'sales calls this week',
    'meetings where we talked about GDPR',
    'my longest meeting ever',
  ];

  const total = await prisma.recording.count({ where: { deletedAt: null } });
  console.log(`${total} recordings in scope (all users, not soft-deleted)\n`);

  for (const [name, query] of CASES) {
    const filters = parseFilters(new URLSearchParams(query));
    const where = { deletedAt: null, AND: [filtersToWhere(filters) as Prisma.RecordingWhereInput] };
    const count = await prisma.recording.count({ where });
    const first = await prisma.recording.findFirst({
      where,
      orderBy: filtersToOrderBy(filters) as Prisma.RecordingOrderByWithRelationInput,
      select: { title: true, createdAt: true, duration: true },
    });
    const chips = describeFilters(filters).map((c) => c.label).join(' · ') || '—';
    const top = first
      ? `${first.title.slice(0, 44)} (${first.createdAt.toISOString().slice(0, 10)}, ${Math.round(first.duration / 60)}m)`
      : '—';
    console.log(`${name.padEnd(22)} ${String(count).padStart(4)} / ${total}   chips: ${chips}`);
    console.log(`${''.padEnd(22)} top: ${top}`);
  }

  if (wantsAi) {
    console.log('\nAsk AI: question -> filter -> rows matched\n');
    for (const q of questions) {
      const outcome = await askAiFilter(q);
      if (!outcome.ok) {
        console.log(`"${q}"`);
        console.log(`   -> ${outcome.status} ${outcome.error}\n`);
        continue;
      }
      const filters = outcome.filters;
      const where = { deletedAt: null, AND: [filtersToWhere(filters) as Prisma.RecordingWhereInput] };
      const count = await prisma.recording.count({ where });
      const top = await prisma.recording.findFirst({
        where,
        orderBy: filtersToOrderBy(filters) as Prisma.RecordingOrderByWithRelationInput,
        select: { title: true, createdAt: true, duration: true },
      });
      console.log(`"${q}"`);
      console.log(`   chip: ${filters.label ?? '(none)'}`);
      console.log(`   url:  ${new URLSearchParams(filtersToParams(filters)).toString()}`);
      const topLine = top
        ? `, top: ${top.title.slice(0, 46)} (${top.createdAt.toISOString().slice(0, 10)}, ${Math.round(top.duration / 60)}m)`
        : '';
      console.log(`   -> ${count} of ${total}${topLine}\n`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
