// "Ask AI" — the prompt and the parser that turn a plain-English question into
// the same filter the panel's chips produce.
//
// It lives here rather than in the route so scripts/check-filters.ts can
// exercise the model's output directly: the prompt is the risky part, the HTTP
// wrapper is not. A route module can only export handlers anyway.
//
// The model never sees meeting content and never chooses which recordings you
// get. It only fills in filter values; the database still does the selecting,
// under the caller's own scope.
import Anthropic from '@anthropic-ai/sdk';
import { openRouterComplete } from '@/lib/openrouter';
import {
  MEETING_TYPES, MEETING_PROVIDERS, EMPTY_FILTERS,
  filtersToParams, isoOrUndefined, type RecordingFilters,
} from '@/lib/recording-filters';

export const AI_FILTER_MODEL = 'claude-haiku-4-5-20251001';
export const MAX_QUESTION = 300;

export function aiFilterSystemPrompt(today: string): string {
  return `You convert a question about a person's meeting recordings into a JSON filter.

Today is ${today} (ISO). Reply with ONE JSON object and nothing else — no prose, no code fence.

Fields (all optional, omit what the question does not ask for):
  "terms": string[]        — up to 6 distinctive keywords to look for in the meeting title, AI notes and transcript. Single words or short phrases. Do NOT include generic words like "meeting", "call", "discussion", "recording", "transcript".
  "date": one of "today" | "week" | "month" | "quarter" | "year" — a rolling window ending now ("week" = last 7 days, "month" = last 30, "quarter" = last 90, "year" = last 365).
  "from": ISO date         — only for a bound the rolling windows cannot express ("since August", "after 3 March").
  "to": ISO date           — upper bound ("before June", "up to 12 May").
  "source": "web" | "teams" — "web" means recorded in person, "teams" means any online / shared-screen call.
  "provider": ${MEETING_PROVIDERS.map((p) => `"${p}"`).join(' | ')} — only when a specific platform is named.
  "type": ${MEETING_TYPES.map((t) => `"${t}"`).join(' | ')} — only when the question names the kind of meeting.
  "hasActions": true       — when they ask for meetings that produced action items, follow-ups or to-dos.
  "minMinutes": number     — "longer than 30 minutes", "long meetings" (use 45).
  "maxMinutes": number     — "short meetings" (use 10), "under 20 minutes".
  "sort": "newest" | "oldest" | "longest" | "shortest" — only when the question implies an order.
  "label": string          — REQUIRED. A short human-readable name for this filter, 2-6 words, sentence case. It is shown to the user as a chip.

Rules:
- Prefer "date" over "from"/"to" when a rolling window fits.
- A person's name, a company, a product or a topic goes in "terms".
- If the question is vague, return just "terms" and a "label"; never invent a date or a type that was not asked for.
- Never return an empty object: at minimum give "terms" and "label".

Examples:
Q: meetings about pricing last month
{"terms":["pricing","price"],"date":"month","label":"Pricing, last month"}
Q: what did I discuss with Lee about Qlik
{"terms":["Lee","Qlik"],"label":"Lee and Qlik"}
Q: long teams calls this year that had follow ups
{"source":"teams","minMinutes":45,"date":"year","hasActions":true,"label":"Long online calls with actions"}
Q: anything since august about the CRM
{"terms":["CRM"],"from":"${today.slice(0, 4)}-08-01","label":"CRM since August"}
Q: shortest meetings
{"sort":"shortest","label":"Shortest first"}`;
}

/** Pull the JSON object out of a model reply that may be fenced or prefaced. */
export function extractJson(text: string): unknown | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

/** Validate the model's object into a real filter. Anything unrecognised is
 *  dropped, so a hallucinated field can never reach the query. Null means the
 *  filter would narrow nothing, which would show the whole list under a chip
 *  claiming otherwise. */
export function coerceAiFilter(raw: unknown): RecordingFilters | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const inList = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => {
    const s = str(v);
    return s && (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
  };

  const terms = Array.isArray(o.terms)
    ? o.terms
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter((t) => t.length > 1)
        .slice(0, 6)
    : [];

  const filters: RecordingFilters = {
    ...EMPTY_FILTERS,
    terms,
    source:     inList(o.source, ['web', 'teams'] as const),
    provider:   inList(o.provider, MEETING_PROVIDERS),
    type:       inList(o.type, MEETING_TYPES),
    date:       inList(o.date, ['today', 'week', 'month', 'quarter', 'year'] as const),
    from:       isoOrUndefined(str(o.from) ?? null),
    to:         isoOrUndefined(str(o.to) ?? null, true),
    hasActions: o.hasActions === true,
    minMinutes: num(o.minMinutes),
    maxMinutes: num(o.maxMinutes),
    sort:       inList(o.sort, ['newest', 'oldest', 'longest', 'shortest'] as const) ?? 'newest',
    label:      str(o.label)?.slice(0, 60),
  };

  if (Object.keys(filtersToParams({ ...filters, label: undefined })).length === 0) return null;
  return filters;
}

// ── Running it ───────────────────────────────────────────────────────────────
// Cheap, single-shot, schema-constrained: exactly the shape of task the project
// routes to OpenRouter first, keeping Anthropic quota for meeting analysis.
// Either side alone is enough, so a rotated key on one provider doesn't take
// the feature down — which is not hypothetical: the Anthropic key in .env.local
// was returning 401 when this was written.
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const isMockAnthropic = !ANTHROPIC_KEY || ANTHROPIC_KEY === 'your_anthropic_api_key_here';
const anthropic = isMockAnthropic ? null : new Anthropic({ apiKey: ANTHROPIC_KEY });

export type AiFilterOutcome =
  | { ok: true; filters: RecordingFilters }
  | { ok: false; status: number; error: string };

async function viaAnthropic(system: string, question: string): Promise<string | null> {
  if (!anthropic) return null;
  try {
    const message = await anthropic.messages.create({
      model: AI_FILTER_MODEL,
      max_tokens: 400,
      system,
      messages: [{ role: 'user', content: question }],
    });
    const first = message.content[0];
    return first?.type === 'text' ? first.text : null;
  } catch {
    return null;
  }
}

/** Ask for a filter. Returns a validated filter or a reason the caller can show
 *  the user — never throws, never returns a filter that narrows nothing. */
export async function askAiFilter(question: string, now: Date = new Date()): Promise<AiFilterOutcome> {
  const system = aiFilterSystemPrompt(now.toISOString().slice(0, 10));

  // OpenRouter takes a single prompt, so the instructions and the question are
  // concatenated; Anthropic gets them as system + user.
  let text: string | null = await openRouterComplete(`${system}\n\nQ: ${question}`, 400);
  if (!text?.trim()) text = await viaAnthropic(system, question);
  if (!text?.trim()) return { ok: false, status: 502, error: 'AI search is unavailable right now' };

  const filters = coerceAiFilter(extractJson(text));
  if (!filters) return { ok: false, status: 422, error: "Couldn't interpret that — try rephrasing" };
  return { ok: true, filters };
}
