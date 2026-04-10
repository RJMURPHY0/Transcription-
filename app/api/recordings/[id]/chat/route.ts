import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const isMock = !ANTHROPIC_KEY || ANTHROPIC_KEY === 'your_anthropic_api_key_here';
const anthropic = isMock ? null : new Anthropic({ apiKey: ANTHROPIC_KEY });

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { message, history } = (await request.json()) as {
      message: string;
      history: HistoryMessage[];
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
    }

    const recording = await prisma.recording.findUnique({
      where: { id: params.id },
      include: { transcript: true, summary: true },
    });

    if (!recording) {
      return NextResponse.json({ error: 'Recording not found.' }, { status: 404 });
    }

    if (!recording.transcript) {
      return NextResponse.json(
        { reply: 'This recording has no transcript yet. Try again once processing is complete.' },
      );
    }

    if (!anthropic) {
      return NextResponse.json({
        reply: 'Chat requires an ANTHROPIC_API_KEY. Add it to .env.local and restart the server.',
      });
    }

    const actionItems: string[] = recording.summary
      ? JSON.parse(recording.summary.actionItems)
      : [];
    const keyPoints: string[] = recording.summary
      ? JSON.parse(recording.summary.keyPoints)
      : [];
    const decisions: string[] = recording.summary
      ? JSON.parse(recording.summary.decisions)
      : [];

    const systemPrompt = `You are an AI assistant helping a user understand a specific meeting or conversation. Answer questions accurately and concisely using the information below.

MEETING: ${recording.title}
DATE: ${new Date(recording.createdAt).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}

${recording.summary ? `SUMMARY:
${recording.summary.overview}

ACTION ITEMS:
${actionItems.length ? actionItems.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'None identified'}

KEY POINTS:
${keyPoints.length ? keyPoints.map((p) => `• ${p}`).join('\n') : 'None identified'}

DECISIONS:
${decisions.length ? decisions.map((d) => `• ${d}`).join('\n') : 'None identified'}` : ''}

FULL TRANSCRIPT:
${recording.transcript.fullText}

Guidelines:
- Answer based only on what's in the transcript and notes above
- If something isn't mentioned, say so clearly
- Keep answers concise but complete
- Quote the transcript directly when it helps clarify`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        ...(history ?? []).map((h) => ({
          role: h.role,
          content: h.content,
        })),
        { role: 'user', content: message.trim() },
      ],
    });

    const reply =
      response.content[0]?.type === 'text'
        ? response.content[0].text
        : 'Sorry, I could not generate a response.';

    return NextResponse.json({ reply });
  } catch (error) {
    console.error('[chat] Error:', error);
    const message = error instanceof Error ? error.message : 'Chat failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
