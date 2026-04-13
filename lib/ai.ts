import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

// ── Transcription: Groq (free Whisper) preferred, OpenAI Whisper as fallback ──
const GROQ_KEY = process.env.GROQ_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const isGroqReady = !!GROQ_KEY && GROQ_KEY !== 'your_groq_api_key_here';
const isOpenAIReady = !!OPENAI_KEY && OPENAI_KEY !== 'your_openai_api_key_here';
const isMockTranscription = !isGroqReady && !isOpenAIReady;

const transcriptionClient = isGroqReady
  ? new OpenAI({ apiKey: GROQ_KEY, baseURL: 'https://api.groq.com/openai/v1' })
  : isOpenAIReady
  ? new OpenAI({ apiKey: OPENAI_KEY })
  : null;

const transcriptionModel = isGroqReady ? 'whisper-large-v3-turbo' : 'whisper-1';

// ── Summarisation: Anthropic Claude ──
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const isMockAnthropic = !ANTHROPIC_KEY || ANTHROPIC_KEY === 'your_anthropic_api_key_here';
const anthropic = isMockAnthropic ? null : new Anthropic({ apiKey: ANTHROPIC_KEY });

export interface RawSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

export interface AnalysisResult {
  overview: string;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function transcribeAudio(filePath: string): Promise<{ text: string; rawSegments: RawSegment[] }> {
  if (isMockTranscription || !transcriptionClient) {
    return {
      text: 'Demo transcript — add a GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY with billing to .env.local.',
      rawSegments: [],
    };
  }

  try {
    const transcription = await transcriptionClient.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: transcriptionModel,
      response_format: 'verbose_json',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

    const rawSegments: RawSegment[] = (transcription.segments ?? []).map((s: RawSegment) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));

    return { text: transcription.text as string, rawSegments };
  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      const e = err as { status?: number; code?: string; message?: string };
      if (e.status === 429 || e.code === 'insufficient_quota') {
        throw new Error(
          isGroqReady
            ? 'Groq rate limit hit. Wait a moment and try again.'
            : 'OpenAI quota exceeded. Add billing at platform.openai.com/billing, or add a free GROQ_API_KEY to .env.local.',
        );
      }
      if (e.status === 401) {
        throw new Error('Invalid API key. Check your key in .env.local.');
      }
      if (e.message) throw new Error(e.message);
    }
    throw err;
  }
}

export async function diarizeSegments(rawSegments: RawSegment[]): Promise<TranscriptSegment[]> {
  if (!rawSegments.length) return [];

  // Without Claude, label everything Speaker 1
  if (isMockAnthropic || !anthropic) {
    return rawSegments.map((s) => ({ ...s, speaker: 'Speaker 1' }));
  }

  const segmentList = rawSegments
    .map((s, i) => `[${i}] ${formatTime(s.start)}: ${s.text.trim()}`)
    .join('\n');

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `Identify speaker changes in this meeting transcript. Assign "Speaker 1", "Speaker 2", etc. in order of first appearance.

Return ONLY a JSON array — one object per segment index — mapping each index to a speaker label.

Segments:
${segmentList}

Return format:
[{"index":0,"speaker":"Speaker 1"},{"index":1,"speaker":"Speaker 2"},...]`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') return rawSegments.map((s) => ({ ...s, speaker: 'Speaker 1' }));

  try {
    const jsonMatch = content.text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON array in response');
    const mappings = JSON.parse(jsonMatch[0]) as { index: number; speaker: string }[];

    // Apply speaker labels to original segments — timestamps are always from Whisper, not Claude
    return rawSegments.map((s, i) => {
      const mapping = mappings.find((m) => m.index === i);
      return { ...s, speaker: mapping?.speaker ?? 'Speaker 1' };
    });
  } catch {
    return rawSegments.map((s) => ({ ...s, speaker: 'Speaker 1' }));
  }
}

export async function generateTitle(transcript: string): Promise<string | null> {
  if (isMockAnthropic || !anthropic || !transcript.trim()) return null;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 24,
      messages: [
        {
          role: 'user',
          content: `Write a 3-4 word meeting title. Return ONLY the title — no quotes, no punctuation at the end.

Good examples: "Q3 Budget Review", "New Hire Onboarding", "Product Roadmap Planning", "Weekly Team Standup", "Client Discovery Call"

Transcript excerpt:
${transcript.slice(0, 600)}`,
        },
      ],
    });
    const text = message.content[0]?.type === 'text' ? message.content[0].text.trim() : null;
    // Reject anything that looks too long or malformed
    if (!text || text.length > 60 || text.includes('\n')) return null;
    return text;
  } catch {
    return null;
  }
}

export async function analyzeTranscript(transcript: string): Promise<AnalysisResult> {
  if (isMockAnthropic || !anthropic) {
    return {
      overview: 'Demo summary — add your ANTHROPIC_API_KEY to .env.local to enable AI analysis.',
      keyPoints: ['Add ANTHROPIC_API_KEY to .env.local', 'Restart the dev server'],
      actionItems: [],
      decisions: [],
    };
  }

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are an AI meeting assistant. Analyse this transcript and return ONLY valid JSON.

Format:
{
  "overview": "2-3 sentence summary",
  "keyPoints": ["point 1", "point 2"],
  "actionItems": ["action 1"],
  "decisions": ["decision 1"]
}

Rules: keyPoints 3-5 items; actionItems empty array if none; decisions empty array if none.

TRANSCRIPT:
${transcript}`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected Claude response type');

  try {
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]) as AnalysisResult;
  } catch {
    return {
      overview: content.text.slice(0, 500),
      keyPoints: [],
      actionItems: [],
      decisions: [],
    };
  }
}
