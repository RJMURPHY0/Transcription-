'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DeleteButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/recordings/${id}`, { method: 'DELETE' });
      if (res.ok) { router.push('/'); router.refresh(); }
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-sm text-ftc-mid flex-1">Delete this recording?</p>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="px-4 py-2 rounded-xl text-sm text-ftc-mid bg-surface-raised hover:bg-surface-border transition-colors touch-manipulation"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="px-4 py-2 rounded-xl text-sm text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors touch-manipulation"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="w-full py-3 rounded-2xl text-sm text-red-400 border border-red-500/20 hover:bg-red-500/5 active:scale-[0.99] transition-all touch-manipulation"
    >
      Delete Recording
    </button>
  );
}
