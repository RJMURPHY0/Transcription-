'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FolderActions({
  id, name, isActive,
}: {
  id: string; name: string; isActive: boolean;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [newName,  setNewName]  = useState(name);
  const [saving,   setSaving]   = useState(false);

  const rename = async () => {
    const n = newName.trim();
    if (!n || n === name) { setRenaming(false); return; }
    setSaving(true);
    try {
      await fetch(`/api/folders/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n }),
      });
      setRenaming(false);
      router.refresh();
    } finally { setSaving(false); }
  };

  const del = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this folder? Recordings will be moved to All.')) return;
    await fetch(`/api/folders/${id}`, { method: 'DELETE' });
    if (isActive) router.push('/');
    else router.refresh();
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5" onClick={e => { e.preventDefault(); e.stopPropagation(); }}>
        <input
          autoFocus
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void rename(); if (e.key === 'Escape') setRenaming(false); }}
          className="bg-surface-raised border border-brand rounded-lg px-2 py-1 text-xs text-ftc-gray outline-none w-32"
        />
        <button onClick={rename} disabled={saving} className="text-xs text-brand">
          {saving ? '…' : 'Save'}
        </button>
        <button onClick={() => setRenaming(false)} className="text-xs text-ftc-mid hover:text-ftc-gray">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={e => { e.preventDefault(); e.stopPropagation(); setRenaming(true); }}
        className="p-1.5 text-ftc-mid hover:text-brand rounded-lg transition-colors"
        title="Rename folder"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>
      <button
        onClick={del}
        className="p-1.5 text-ftc-mid hover:text-red-400 rounded-lg transition-colors"
        title="Delete folder"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}
