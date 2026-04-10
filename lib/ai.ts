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

export interface AnalysisResult {
  overview: string;
  keyPoints: string[];
  actionItems: string[];
  decisions: string[];
}

export async function transcribeAudio(filePath: string): Promise<string> {
  if (isMockTranscription || !transcriptionClient) {
    return 'Demo transcript — add a GROQ_API_KEY (free at console.groq.com) or OPENAI_API_KEY with billing to .env.local.';
  }

  try {
    const transcription = await transcriptionClient.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: transcriptionModel,
    });
    return transcription.text;
  } catch (err: unknown) {
    // Surface helpful messages for common errors
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
