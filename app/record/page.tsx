'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FTCLogoMark } from '@/components/FTCLogo';

type State = 'idle' | 'recording' | 'processing' | 'error';

function formatTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function getBestMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? 'audio/webm';
}

export default function RecordPage() {
  const [state, setState] = useState<State>('idle');
  const [seconds, setSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  const router = useRouter();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeRef = useRef('audio/webm');

  useEffect(() => {
    if (state === 'recording') {
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  const upload = useCallback(async (blob: Blob) => {
    const ext = mimeRef.current.includes('mp4') ? 'mp4' : 'webm';
    const fd = new FormData();
    fd.append('audio', blob, `recording.${ext}`);
    try {
      const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Server error ${res.status}`);
      router.push(`/recordings/${json.id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setState('error');
    }
  }, [router]);

  const start = useCallback(async () => {
    setErrorMsg('');
    setSeconds(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = getBestMime();
      mimeRef.current = mime;
      const mr = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await upload(new Blob(chunksRef.current, { type: mime }));
      };
      mr.start(500);
      setState('recording');
    } catch {
      setErrorMsg('Microphone access denied. Allow mic access and try again.');
      setState('error');
    }
  }, [upload]);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && state === 'recording') {
      mediaRecorderRef.current.stop();
      setState('processing');
    }
  }, [state]);

  const handleClick = () => {
    if (state === 'recording') stop();
    else if (state !== 'processing') start();
  };

  const btnClass =
    state === 'recording' ? 'btn-record-active' :
    state === 'processing' ? 'btn-record-processing' :
    'btn-record-idle';

  const pulseColor = 'bg-red-500/15';

  return (
    <div className="min-h-screen flex flex-col bg-surface">
      {/* Header */}
      <header className="border-b border-surface-border bg-surface/80 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm font-medium text-ftc-mid hover:text-ftc-gray transition-colors p-2 -ml-2 rounded-xl touch-manipulation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Link>
          <div className="flex items-center gap-2">
            <FTCLogoMark className="w-6 h-6 logo-glow" />
            <span className="font-semibold text-sm text-ftc-gray">New Recording</span>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 flex flex-col items-center justify-center gap-10 px-6 pb-safe">

        {/* Timer */}
        <div className="text-center">
          <p className={`timer-display text-7xl font-mono font-bold tabular-nums transition-colors duration-300 ${
            state === 'recording' ? 'text-ftc-gray' : 'text-surface-border'
          }`}>
            {formatTime(seconds)}
          </p>
          {state === 'recording' && (
            <div className="flex items-center justify-center gap-1.5 mt-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-semibold text-red-400 tracking-widest">REC</span>
            </div>
          )}
        </div>

        {/* Waveform */}
        <div className="flex items-end justify-center gap-1 h-10">
          {[...Array(13)].map((_, i) =>
            state === 'recording' ? (
              <div
                key={i}
                className="w-1.5 h-full wave-bar-dynamic bg-brand"
                style={{ '--wave-delay': `${i * 0.07}s` } as React.CSSProperties}
              />
            ) : (
              <div key={i} className="w-1.5 h-1 rounded-full bg-surface-border" />
            )
          )}
        </div>

        {/* Record button */}
        <div className="relative flex items-center justify-center">
          {state === 'recording' && (
            <>
              <div className={`absolute rounded-full w-36 h-36 pulse-ring ${pulseColor}`} />
              <div className={`absolute rounded-full w-36 h-36 pulse-ring-delay ${pulseColor}`} />
            </>
          )}
          <button
            type="button"
            onClick={handleClick}
            disabled={state === 'processing'}
            aria-label={state === 'recording' ? 'Stop recording' : 'Start recording'}
            className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-200 touch-manipulation select-none ${btnClass}`}
          >
            {state === 'recording' ? (
              <div className="w-10 h-10 rounded-2xl bg-white" />
            ) : state === 'processing' ? (
              <div className="w-9 h-9 rounded-full border-[3px] border-surface-border border-t-brand animate-spin" />
            ) : (
              <svg className="w-14 h-14 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V22H9v2h6v-2h-2v-1.06A9 9 0 0 0 21 12v-2h-2z" />
              </svg>
            )}
          </button>
        </div>

        {/* Status */}
        <div className="text-center space-y-1.5 max-w-xs">
          <p className="font-medium text-ftc-gray">
            {state === 'idle'      && 'Tap to start recording'}
            {state === 'recording' && 'Recording — tap to stop'}
            {state === 'processing'&& 'Transcribing with AI…'}
            {state === 'error'     && 'Something went wrong'}
          </p>
          {state === 'processing' && (
            <p className="text-sm text-ftc-mid">This may take 20–30 seconds</p>
          )}
          {state === 'error' && errorMsg && (
            <p className="text-sm text-red-400">{errorMsg}</p>
          )}
          {state === 'error' && (
            <button type="button" onClick={() => setState('idle')} className="mt-1 text-sm text-brand underline underline-offset-2 touch-manipulation">
              Try again
            </button>
          )}
        </div>

        {state === 'idle' && (
          <p className="text-xs text-center max-w-xs text-surface-muted">
            Works best in quiet environments. Supports meetings, interviews, and lectures.
          </p>
        )}
      </main>
    </div>
  );
}
