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

export async function POST(request: NextRequest) {
  try {
    const { message, history } = (await request.json()) as {
      message: string;
      history: HistoryMessage[];
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message required.' }, { status: 400 });
    }

    if (!anthropic) {
      return NextResponse.json({
        reply: 'Chat requires an ANTHROPIC_API_KEY. Add it to .env.local and restart.',
      });
    }

    // Fetch all completed recordings with transcripts
    const recordings = await prisma.recording.findMany({
      where: { status: 'completed' },
      include: { transcript: true, summary: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (recordings.length === 0) {
      return NextResponse.json({
        reply: "You don't have any completed recordings yet. Record a meeting first and I'll be able to answer questions about it!",
        mentionedIds: [],
      });
    }

    const meetingContext = recordings
      .map((r) => {
        const date = new Date(r.createdAt).toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        });
        const transcript = r.transcript?.fullText?.slice(0, 4000) ?? 'No transcript available';
        const summary = r.summary?.overview ? `SUMMARY: ${r.summary.overview}\n` : '';
        return `---\nMEETING_ID: ${r.id}\nTITLE: ${r.title || 'Untitled Recording'}\nDATE: ${date}\n${summary}TRANSCRIPT:\n${transcript}\n---`;
      })
      .join('\n\n');

    const systemPrompt = `You are an AI assistant for FTC Transcribe. You have access to all recorded meetings and can search across all of them to answer questions.

RECORDED MEETINGS:
${meetingContext}

Guidelines:
- When you reference a specific meeting, always include [MEETING:MEETING_ID] using the exact MEETING_ID from above — this creates a clickable link for the user
- Quote directly from transcripts when asked what someone said
- If asked to find something specific (a person, topic, or phrase), search all meetings and identify which one(s) are relevant
- Be concise but thorough
- If something isn't in any meeting, say so clearly`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [
        ...(history ?? []).map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: message.trim() },
      ],
    });

    const reply =
      response.content[0]?.type === 'text'
        ? response.content[0].text
        : 'Sorry, could not generate a response.';

    // Extract meeting IDs mentioned in the response
    const mentionedIds = [...reply.matchAll(/\[MEETING:([^\]]+)\]/g)].map((m) => m[1]);

    return NextResponse.json({ reply, mentionedIds });
  } catch (error) {
    console.error('[global-chat] Error:', error);
    const msg = error instanceof Error ? error.message : 'Chat failed.';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
