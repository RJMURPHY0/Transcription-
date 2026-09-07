'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="p-2 rounded-xl text-ftc-mid hover:text-ftc-gray hover:bg-surface-raised transition-colors touch-manipulation"
      title="Sign out"
    >
      <LogOut className="w-5 h-5" strokeWidth={1.75} />
    </button>
  );
}
