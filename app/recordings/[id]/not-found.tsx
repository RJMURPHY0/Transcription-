import Link from 'next/link';

export default function RecordingNotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-surface">
      <header className="sticky top-0 z-20 border-b border-surface-border bg-surface/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm font-medium text-ftc-mid hover:text-ftc-gray transition-colors p-2 -ml-2 rounded-xl touch-manipulation"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full px-4 py-6 flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div>
            <h2 className="text-base font-semibold text-ftc-gray">Recording not found</h2>
            <p className="text-sm text-ftc-mid mt-1">This recording may have been deleted.</p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl border border-surface-border text-ftc-mid hover:text-ftc-gray hover:border-surface-muted transition-colors"
          >
            Back to recordings
          </Link>
        </div>
      </main>
    </div>
  );
}
