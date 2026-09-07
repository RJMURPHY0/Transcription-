// Locate the transcript segment a summary line came from.
//
// Key points, action items and decisions are AI-paraphrased strings with no
// stored timestamp, so we can't jump to them by time the way topics do. Instead
// we match the line's distinctive words against every transcript block and pick
// the closest one.
//
// Scoring is BM25, not cosine. Cosine normalises each block by its own vector
// norm, which hands a one-word block ("updated.") a near-perfect score for
// sharing a single ordinary word with a twenty-word action item, while the
// block that actually discussed the thing scores worse for being long. BM25
// sums evidence over the query's terms instead, so matching six of a line's
// words always beats matching one, and length only damps the score mildly.
//
// Two further guards:
//  · an evidence floor — one word in common is not a citation, so a block has
//    to share two content words with the line (or one rare enough to be a name
//    only said in a couple of places). Nothing clears it, we report no match
//    and the UI says so, rather than jumping somewhere arbitrary;
//  · a neighbour bonus — a block sitting inside a stretch of conversation that
//    also matches beats an isolated keyword echo elsewhere in the meeting.

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','so','because','as','of','at','by',
  'for','with','about','against','between','into','through','during','before',
  'after','above','below','to','from','up','down','in','out','on','off','over',
  'under','again','further','once','here','there','all','any','both','each','few',
  'more','most','other','some','such','no','nor','not','only','own','same','than',
  'too','very','can','will','just','should','now','is','are','was','were','be',
  'been','being','have','has','had','having','do','does','did','doing','would',
  'could','this','that','these','those','it','its','they','them','their','we',
  'our','you','your','he','she','his','her','him','i','me','my','who','whom',
  'which','what','when','where','why','how','also','get','got','one','make','made',
]);

const VOWELS = /[aeiouy]/;

/** Collapse a word's inflections so a paraphrase ("update the status") matches
 *  the speech it came from ("we updated it", "it's updating"). Porter's first
 *  step (plurals, -ed, -ing) plus a trailing-e strip, which is what puts
 *  update / updates / updated / updating all on `updat`. Derivational endings
 *  (-ation, -ment) are deliberately left alone: they shift the sense often
 *  enough that folding them costs more precision than it buys recall. */
function stem(word: string): string {
  let w = word;

  // Plurals.
  if (w.endsWith('ies') && w.length > 4)          w = w.slice(0, -3) + 'y';
  else if (w.endsWith('sses'))                    w = w.slice(0, -2);
  else if (w.endsWith('ss'))                      { /* keep */ }
  else if (w.endsWith('s') && w.length > 3)       w = w.slice(0, -1);

  // Past and progressive, only when something pronounceable is left behind.
  for (const suf of ['ing', 'ed'] as const) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const base = w.slice(0, -suf.length);
      if (VOWELS.test(base)) { w = base; break; }
    }
  }

  // shipping → shipp → ship
  const last = w[w.length - 1];
  if (w.length > 3 && last === w[w.length - 2] && !'lsz'.includes(last) && !VOWELS.test(last)) {
    w = w.slice(0, -1);
  }

  // quote → quot, so it meets quoted / quoting / quotes on the same stem.
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);

  return w.length >= 3 ? w : word;
}

export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return raw.filter((t) => t.length > 1 && !STOPWORDS.has(t)).map(stem);
}

/** Same content-word filter as tokenize(), but keeps each word's character
 *  offsets in the original string so a match can be highlighted in place. */
export function tokenizeWithOffsets(text: string): Array<{ tok: string; start: number; end: number }> {
  const out: Array<{ tok: string; start: number; end: number }> = [];
  const re = /[a-z0-9]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[0].toLowerCase();
    if (tok.length > 1 && !STOPWORDS.has(tok)) out.push({ tok: stem(tok), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Where in a block a summary line came from: the block index and the character
 *  span [start, end) of the tightest run of the line's distinctive words, or
 *  null when nothing distinctive lands inside it. `index` is -1 when no block
 *  carries enough of the line to be worth jumping to. */
export interface MatchLocation {
  index: number;
  span: [number, number] | null;
}

/** One block's standing against a query. Used by the tuning script
 *  (scripts/check-summary-jumps.ts) to see why a line landed where it did. */
export interface MatchCandidate {
  index: number;
  /** BM25 score including the neighbour bonus. */
  score: number;
  /** Share of the query's distinctive weight this block carries, 0-1. */
  coverage: number;
  /** Distinct query terms found in the block. */
  hits: number;
  /** Whether it cleared the coverage floor and would be jumped to. */
  accepted: boolean;
}

export interface SegmentMatcher {
  /** Best-matching block index for a query string, or -1 if nothing overlaps. */
  match(query: string): number;
  /** Best block index AND the exact span within it to highlight. */
  locate(query: string): MatchLocation;
  /** Ranked candidates with their scores — diagnostics, not used by the UI. */
  explain(query: string, limit?: number): MatchCandidate[];
}

// BM25 constants. K1 saturates repeated terms; B is halved from the usual 0.75
// because transcript blocks vary in length for reasons (a one-word interjection
// versus a monologue) that say nothing about relevance.
const K1 = 1.2;
const B  = 0.5;

// Shared content words a block needs before we will jump to it — except when
// the single shared word is rare enough across the meeting to be a name or a
// product ("Kenworth", "Qlik"), which is evidence on its own. Below the floor
// the honest answer is "this line isn't pinned to one moment".
const MIN_TERMS = 2;
const RARE_DF   = 3;

// How much of the best adjacent block's score counts toward this one. Enough to
// break ties in favour of a matching stretch of conversation, not enough to
// drag the jump onto a block that matched nothing itself.
const NEIGHBOUR = 0.35;

/**
 * Build a matcher over a fixed set of block texts. Precomputes per-block term
 * frequencies and IDF so each subsequent match() is cheap — call once (memoised
 * on the segment list) and reuse across clicks.
 */
export function createSegmentMatcher(texts: string[]): SegmentMatcher {
  const n = texts.length;
  const tokenLists = texts.map(tokenize);
  const lengths = tokenLists.map((t) => t.length);
  const avgLen = (n > 0 ? lengths.reduce((a, b) => a + b, 0) / n : 0) || 1;

  const tfs = tokenLists.map((toks) => {
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });

  const df = new Map<string, number>();
  for (const m of tfs) for (const tok of m.keys()) df.set(tok, (df.get(tok) ?? 0) + 1);

  // BM25 IDF, floored so a term present in most blocks still counts a little
  // rather than going negative and penalising a block for containing it.
  const idf = (tok: string) => {
    const d = df.get(tok) ?? 0;
    return Math.max(0.05, Math.log(1 + (n - d + 0.5) / (d + 0.5)));
  };

  function rank(query: string): { candidates: MatchCandidate[]; qSet: Set<string> } {
    const qTokens = Array.from(new Set(tokenize(query)));
    const qSet = new Set(qTokens);
    if (qTokens.length === 0) return { candidates: [], qSet };

    const weights = new Map<string, number>();
    let qWeight = 0;
    for (const tok of qTokens) { const w = idf(tok); weights.set(tok, w); qWeight += w; }
    if (qWeight === 0) return { candidates: [], qSet };

    const scores  = new Array<number>(n).fill(0);
    const covered = new Array<number>(n).fill(0);  // matched IDF weight
    const hits    = new Array<number>(n).fill(0);  // matched distinct terms
    const rare    = new Array<boolean>(n).fill(false); // matched something meeting-rare

    for (let i = 0; i < n; i++) {
      const tf = tfs[i];
      if (tf.size === 0) continue;
      const norm = 1 - B + B * (lengths[i] / avgLen);
      for (const [tok, w] of weights) {
        const f = tf.get(tok);
        if (!f) continue;
        scores[i]  += w * (f * (K1 + 1)) / (f + K1 * norm);
        covered[i] += w;
        hits[i]    += 1;
        if ((df.get(tok) ?? 0) <= RARE_DF) rare[i] = true;
      }
    }

    const needTerms = Math.min(MIN_TERMS, qTokens.length);
    const candidates: MatchCandidate[] = [];
    for (let i = 0; i < n; i++) {
      if (scores[i] === 0) continue;
      const around = Math.max(scores[i - 1] ?? 0, scores[i + 1] ?? 0);
      candidates.push({
        index: i,
        score: scores[i] + NEIGHBOUR * around,
        coverage: covered[i] / qWeight,
        hits: hits[i],
        // The gate is judged on the block itself: whatever its neighbours say,
        // we only land the reader on a block carrying the line's own words.
        accepted: hits[i] >= needTerms || (hits[i] > 0 && rare[i]),
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    return { candidates, qSet };
  }

  function bestBlock(query: string): { index: number; qSet: Set<string> } {
    const { candidates, qSet } = rank(query);
    const best = candidates.find((c) => c.accepted);
    return { index: best ? best.index : -1, qSet };
  }

  // Words apart that a highlight will still bridge. Two matched words with a run
  // of unrelated speech between them belong to different moments, so we don't
  // stretch one highlight across the gap.
  const MAX_WORD_GAP = 6;

  /** Grow a span out to the sentence(s) it sits in, so the highlight reads as
   *  the whole thing that was said rather than a lone word. Sentence bounds are
   *  . ! ? or a line break; if none is found the block edge is the bound. */
  function expandToSentence(text: string, start: number, end: number): [number, number] {
    let s = start;
    while (s > 0) {
      const ch = text[s - 1];
      if (ch === '.' || ch === '!' || ch === '?' || ch === '\n') break;
      s--;
    }
    while (s < start && /\s/.test(text[s])) s++; // drop leading space after the stop
    let e = end;
    while (e < text.length) {
      const ch = text[e];
      if (ch === '\n') break;
      e++;
      if (ch === '.' || ch === '!' || ch === '?') break;
    }
    return [s, e];
  }

  /** Within one block, the tightest run of the query's distinctive words. Scores
   *  each cluster by the total IDF weight of the matched words it contains, so
   *  the highlight lands on the densest, most distinctive phrase rather than the
   *  first stray keyword. */
  function spanWithin(index: number, qSet: Set<string>): [number, number] | null {
    const words = tokenizeWithOffsets(texts[index]);
    const hits: Array<{ i: number; start: number; end: number; w: number }> = [];
    for (let i = 0; i < words.length; i++) {
      if (qSet.has(words[i].tok)) hits.push({ i, start: words[i].start, end: words[i].end, w: idf(words[i].tok) });
    }
    if (hits.length === 0) return null;

    let bestStart = hits[0].start, bestEnd = hits[0].end, bestWeight = -1;
    let clusterStart = hits[0].start, clusterEnd = hits[0].end, clusterWeight = hits[0].w;
    for (let k = 1; k <= hits.length; k++) {
      const gap = k < hits.length ? hits[k].i - hits[k - 1].i : Infinity;
      if (gap <= MAX_WORD_GAP) {
        clusterEnd = hits[k].end;
        clusterWeight += hits[k].w;
      } else {
        if (clusterWeight > bestWeight) { bestWeight = clusterWeight; bestStart = clusterStart; bestEnd = clusterEnd; }
        if (k < hits.length) { clusterStart = hits[k].start; clusterEnd = hits[k].end; clusterWeight = hits[k].w; }
      }
    }
    return expandToSentence(texts[index], bestStart, bestEnd);
  }

  return {
    match(query: string): number {
      return bestBlock(query).index;
    },
    locate(query: string): MatchLocation {
      const { index, qSet } = bestBlock(query);
      if (index < 0) return { index, span: null };
      return { index, span: spanWithin(index, qSet) };
    },
    explain(query: string, limit = 5): MatchCandidate[] {
      return rank(query).candidates.slice(0, limit);
    },
  };
}
