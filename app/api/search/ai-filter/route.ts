// "Ask AI" — turn a plain-English question into the same filter the panel's
// chips produce, so the answer is a filtered list the user can see, adjust and
// share rather than an opaque ranked blob.
//
// It replaces a semantic search that could never have worked: the previous AI
// mode went through pgvector, and neither the extension nor the
// transcript_embeddings table exists on this database, so every AI query fell
// into a silent catch and returned nothing at all.
//
// The prompt, the provider routing and the validation live in lib/ai-filter.ts
// so scripts/check-filters.ts can exercise the real path without HTTP.
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { requestIp } from '@/lib/audit';
import { filtersToParams } from '@/lib/recording-filters';
import { MAX_QUESTION, askAiFilter } from '@/lib/ai-filter';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  // The only search route that costs money per call, so it gets its own bucket.
  const limited = rateLimit(`ai-filter:${user.id ?? requestIp(request)}`, 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many requests — try again in a moment' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterS) } },
    );
  }

  let question = '';
  try {
    const body = await request.json() as { question?: string };
    question = (body.question ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, MAX_QUESTION);
  } catch { /* handled below */ }

  if (question.length < 2) return NextResponse.json({ error: 'Ask a question first' }, { status: 400 });

  const outcome = await askAiFilter(question);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });

  return NextResponse.json({ filters: outcome.filters, params: filtersToParams(outcome.filters) });
}
