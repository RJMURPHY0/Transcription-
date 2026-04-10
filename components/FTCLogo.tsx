// FTC logo mark — stylised orange leaf/petal shape matching the FTC brand identity

export function FTCLogoMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 44 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ftc-leaf-grad" x1="4" y1="40" x2="40" y2="4" gradientUnits="userSpaceOnUse">
          <stop offset="0%"   stopColor="#d97f00" />
          <stop offset="55%"  stopColor="#f39200" />
          <stop offset="100%" stopColor="#f9b84a" />
        </linearGradient>
      </defs>
      {/* Outer leaf/petal — main shape */}
      <path
        d="M8 36 C3 26 5 13 17 6 C28 0 42 8 42 21 C42 33 28 44 8 36Z"
        fill="url(#ftc-leaf-grad)"
      />
      {/* Inner highlight for depth */}
      <path
        d="M13 32 C10 24 12 15 20 11 C27 7 35 11 35 20 C35 28 26 38 13 32Z"
        fill="rgba(255,255,255,0.11)"
      />
    </svg>
  );
}

export function FTCLogoFull() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative w-8 h-8 logo-glow rounded-full">
        <FTCLogoMark className="w-8 h-8" />
      </div>
      <div className="leading-none flex flex-col">
        <span className="text-sm font-black tracking-wider text-ftc-gray" style={{ letterSpacing: '0.08em' }}>FTC</span>
        <span className="text-[10px] font-medium tracking-widest uppercase text-ftc-mid" style={{ letterSpacing: '0.2em' }}>Transcribe</span>
      </div>
    </div>
  );
}
