'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function NewFolderButton() {
  const router = useRouter();
  const [open, setOpen]     = useState(false);
  const [name, setName]     = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      const res = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n }),
      });
      if (res.ok) { setName(''); setOpen(false); router.refresh(); }
    } finally { setSaving(false); }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-ftc-mid hover:text-ftc-gray hover:bg-surface-border transition-colors border border-dashed border-surface-border touch-manipulation"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New folder
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') void create();
          if (e.key === 'Escape') { setOpen(false); setName(''); }
        }}
        placeholder="Folder name…"
        className="bg-surface-raised border border-brand rounded-xl px-3 py-1.5 text-xs text-ftc-gray outline-none w-36"
      />
      <button
        onClick={create}
        disabled={saving || !name.trim()}
        className="text-xs px-2.5 py-1.5 rounded-xl bg-brand text-white disabled:opacity-50 touch-manipulation"
      >
        {saving ? '…' : 'Save'}
      </button>
      <button
        onClick={() => { setOpen(false); setName(''); }}
        className="text-xs text-ftc-mid hover:text-ftc-gray touch-manipulation"
      >
        Cancel
      </button>
    </div>
  );
}
