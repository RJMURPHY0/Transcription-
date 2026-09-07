import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { getMemberUserIds } from '@/lib/contacts-db';
import { parseFilters, filtersToWhere, filtersToOrderBy } from '@/lib/recording-filters';

export const dynamic = 'force-dynamic';

interface Result {
  id: string;
  title: string;
  createdAt: Date;
  meetingType: string;
  source: string;
  excerpt: string;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json([]);

  // The dropdown is scoped by exactly the filters the list is showing, so the
  // two can never disagree about what is in view.
  const filters  = parseFilters(sp);
  const org      = sp.get('org');
  const team     = sp.get('team');
  const assignee = sp.get('assignee');

  const user      = await getAuthUser();
  const userId    = user?.id ?? null;
  const canSeeAll = user?.canSeeAll ?? false;

  // ── User scope (mirrors dashboard) ─────────────────────────────────────────
  // No assignee param = your own meetings, for admins too. 'all' widens.
  const assigneeUserId = canSeeAll && assignee && assignee !== 'all' ? assignee : null;
  const inTeamScope    = canSeeAll && (!!org || !!team);
  const scopedToSelf   = !canSeeAll || (assignee !== 'all' && !assigneeUserId && !inTeamScope);

  let scope: Prisma.RecordingWhereInput = {};
  if (scopedToSelf) {
    scope = userId ? { userId } : {};
  } else if (assigneeUserId) {
    scope = { userId: assigneeUserId };
  } else if (inTeamScope) {
    const ids = await getMemberUserIds(org, team);
    scope = ids.length > 0 ? { userId: { in: ids } } : { userId: '__no_match__' };
  }

  // ── Shared filter fragment ──────────────────────────────────────────────────
  // The panel's filters go in via AND so their `OR`/`summary` clauses can never
  // be clobbered by the per-query conditions below.
  const baseWhere: Prisma.RecordingWhereInput = {
    status: 'completed',
    deletedAt: null,
    ...scope,
    AND: [filtersToWhere(filters) as Prisma.RecordingWhereInput],
  };
  const orderBy = filtersToOrderBy(filters) as Prisma.RecordingOrderByWithRelationInput;

  // ── Normal mode: plain ILIKE across title + transcript + AI notes ─────────────
  const like = { contains: q, mode: 'insensitive' as const };
  const recSelect = { id: true, title: true, createdAt: true, meetingType: true, source: true };

  const [titleMatches, notesMatches, transcriptMatches] = await Promise.all([
    // Title
    prisma.recording.findMany({
      where:   { title: like, ...baseWhere },
      select:  recSelect,
      orderBy,
      take:    10,
    }),
    // Meeting notes (AI summary): overview / key points / action items / decisions / topics
    prisma.recording.findMany({
      where: {
        ...baseWhere,
        summary: {
          OR: [
            { overview:    like },
            { keyPoints:   like },
            { actionItems: like },
            { decisions:   like },
            { topics:      like },
          ],
        },
      },
      select:  { ...recSelect, summary: { select: { overview: true } } },
      orderBy,
      take:    10,
    }),
    // Transcript full text
    prisma.transcript.findMany({
      where:  { fullText: like, recording: baseWhere },
      select: {
        recordingId: true,
        fullText:    true,
        recording:   { select: recSelect },
      },
      take: 10,
    }),
  ]);

  const seen = new Set<string>();
  const results: Result[] = [];

  for (const r of titleMatches) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    results.push({ ...r, excerpt: '' });
  }

  for (const r of notesMatches) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const overview = r.summary?.overview ?? '';
    results.push({
      id: r.id, title: r.title, createdAt: r.createdAt,
      meetingType: r.meetingType, source: r.source,
      excerpt: overview.slice(0, 180),
    });
  }

  for (const t of transcriptMatches) {
    if (seen.has(t.recordingId)) continue;
    seen.add(t.recordingId);
    const lower = t.fullText.toLowerCase();
    const pos   = lower.indexOf(q.toLowerCase());
    const start = Math.max(0, pos - 60);
    const excerpt = (start > 0 ? '…' : '') + t.fullText.slice(start, pos + q.length + 100).trim() + '…';
    results.push({ ...t.recording, excerpt });
  }

  return NextResponse.json(results.slice(0, 12));
}
