'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = [
  'What were the key decisions made?',
  'Who has action items and what are they?',
  'Summarise the main points in bullet form',
  'What topics were left unresolved?',
];

export default function ChatPanel({ recordingId }: { recordingId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const send = async (text = input) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: 'user', content: trimmed };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`/api/recordings/${recordingId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history: messages }),
      });
      const data = await res.json() as { reply?: string; error?: string };
      const reply = data.reply ?? data.error ?? 'Something went wrong.';
      setMessages([...nextHistory, { role: 'assistant', content: reply }]);
    } catch {
      setMessages([...nextHistory, { role: 'assistant', content: 'Network error — please try again.' }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card flex flex-col" style={{ height: '520px' }}>

      {/* Header */}
      <div className="px-5 py-3.5 border-b border-surface-border flex items-center gap-2.5 flex-shrink-0">
        <div className="w-2 h-2 rounded-full bg-brand" />
        <h3 className="text-xs font-semibold uppercase tracking-widest text-ftc-mid">
          Ask about this meeting
        </h3>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="ml-auto text-xs text-ftc-mid hover:text-ftc-gray transition-colors touch-manipulation"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">

        {/* Empty state with suggestions */}
        {messages.length === 0 && (
          <div className="flex flex-col gap-4 h-full">
            <div className="flex flex-col items-center justify-center gap-3 py-6">
              <div className="w-12 h-12 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-brand" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-ftc-gray">Ask anything about this meeting</p>
                <p className="text-xs text-ftc-mid mt-0.5">Claude will answer using the transcript and notes</p>
              </div>
            </div>

            {/* Suggestion chips */}
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-left text-xs px-3.5 py-2.5 rounded-xl border border-surface-border bg-surface-raised text-ftc-mid hover:border-brand/40 hover:text-ftc-gray transition-all touch-manipulation"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat bubbles */}
        {messages.map((msg, i) => (
          <div key={i} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-brand/15 border border-brand/20 flex items-center justify-center flex-shrink-0 mb-0.5">
                <span className="text-[9px] font-bold text-brand">AI</span>
              </div>
            )}
            <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'btn-brand text-white rounded-br-sm'
                : 'bg-surface-raised text-ftc-gray rounded-bl-sm border border-surface-border'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Thinking indicator */}
        {loading && (
          <div className="flex items-end gap-2 justify-start">
            <div className="w-6 h-6 rounded-full bg-brand/15 border border-brand/20 flex items-center justify-center flex-shrink-0 mb-0.5">
              <span className="text-[9px] font-bold text-brand">AI</span>
            </div>
            <div className="bg-surface-raised border border-surface-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-ftc-mid animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-ftc-mid animate-bounce" style={{ animationDelay: '120ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-ftc-mid animate-bounce" style={{ animationDelay: '240ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="px-4 py-3 border-t border-surface-border flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about this meeting…"
            rows={1}
            disabled={loading}
            className="flex-1 bg-surface-raised border border-surface-border rounded-xl px-3 py-2.5 text-sm text-ftc-gray placeholder:text-ftc-mid outline-none focus:border-brand resize-none transition-colors disabled:opacity-50 leading-relaxed"
          />
          <button
            type="button"
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="btn-brand p-2.5 rounded-xl text-white disabled:opacity-40 flex-shrink-0 transition-opacity"
            aria-label="Send message"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-ftc-mid mt-1.5 text-center">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
