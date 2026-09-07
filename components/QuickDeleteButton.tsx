'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

export default function QuickDeleteButton({ id, onDeleted }: { id: string; onDeleted?: () => void }) {
  const [step, setStep]       = useState<'idle' | 'confirm' | 'deleting'>('idle');
  const router                = useRouter();

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStep('deleting');
    // Optimistic: hide the card immediately — the server soft-delete is a
    // single UPDATE, and router.refresh() reconciles in the background.
    onDeleted?.();
    try {
      const res = await fetch(`/api/recordings/${id}`, { method: 'DELETE' });
      if (!res.ok) alert('Delete failed — the recording will reappear.');
      router.refresh();
    } catch {
      alert('Network error — the recording will reappear.');
      router.refresh();
    }
  };

  const handleConfirmClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStep('confirm');
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setStep('idle');
  };

  if (step === 'confirm' || step === 'deleting') {
    return (
      <div
        className="flex flex-col items-center gap-1 flex-shrink-0"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <span className="text-[10px] text-ftc-mid">Sure?</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCancel}
            className="text-xs px-2 py-0.5 rounded-lg text-ftc-mid bg-surface-raised hover:bg-surface-border transition-colors touch-manipulation"
          >
            No
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={step === 'deleting'}
            className="text-xs px-2 py-0.5 rounded-lg text-white bg-red-600 hover:bg-red-500 disabled:opacity-60 transition-colors touch-manipulation"
          >
            {step === 'deleting' ? '…' : 'Yes'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={handleConfirmClick}
      aria-label="Delete recording"
      title="Delete"
      className="flex-shrink-0 p-1.5 rounded-lg text-surface-muted hover:text-red-400 hover:bg-red-500/10 transition-colors touch-manipulation"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
