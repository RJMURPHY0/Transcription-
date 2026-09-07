'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Folder, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

interface Folder { id: string; name: string }

export default function AssignFolderButton({
  recordingId,
  currentFolderId,
  folders,
}: {
  recordingId: string;
  currentFolderId: string | null;
  folders: Folder[];
}) {
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const assign = async (folderId: string | null) => {
    setSaving(true);
    try {
      await fetch(`/api/recordings/${recordingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={saving}
          title={currentFolderId ? 'Move to folder' : 'Add to folder'}
          className={`p-1.5 rounded-lg transition-colors touch-manipulation ${
            currentFolderId
              ? 'text-brand hover:bg-brand/10'
              : 'text-surface-muted hover:text-ftc-mid hover:bg-surface-raised'
          } disabled:opacity-40`}
        >
          {saving ? (
            <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
          ) : (
            <Folder className="w-4 h-4" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {currentFolderId && (
          <>
            <DropdownMenuItem onSelect={() => assign(null)} className="text-xs text-ftc-mid">
              Remove from folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {folders.length === 0 && (
          <p className="px-2 py-1.5 text-xs text-ftc-mid">No folders yet — create one above</p>
        )}
        {folders.map((f) => (
          <DropdownMenuItem
            key={f.id}
            onSelect={() => assign(f.id)}
            className={`text-xs gap-2 ${f.id === currentFolderId ? 'text-brand' : ''}`}
          >
            <Folder className="w-3 h-3 flex-shrink-0" />
            {f.name}
            {f.id === currentFolderId && (
              <Check className="w-3 h-3 ml-auto text-brand" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
