import type { Metadata, Viewport } from 'next';
import './globals.css';
import GlobalChatWidget from '@/components/GlobalChatWidget';

export const metadata: Metadata = {
  title: 'Transcribe – AI Meeting Notes',
  description: 'Record any conversation and get an instant transcript, summary, and action items powered by AI.',
  manifest: '/manifest.json',
  icons: { apple: '/icon-192.png' },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Transcribe',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#030712',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {children}
        <GlobalChatWidget />
      </body>
    </html>
  );
}
