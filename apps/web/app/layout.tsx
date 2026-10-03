import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth/client';
import { ConnectorProvider } from '@/lib/connectors/client';

export const metadata: Metadata = {
  title: {
    default: 'FTTH-Copilot — Inteligencia operativa para redes FTTH',
    template: '%s · FTTH-Copilot',
  },
  description:
    'Agente de IA sobre SmartOLT/Mikrowisp. Diagnóstico en lenguaje natural, sin reemplazar tu NMS.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    other: [
      {
        url: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        rel: 'maskable-icon',
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'FTTH-Copilot',
  },
  openGraph: {
    type: 'website',
    siteName: 'FTTH-Copilot',
    title: 'FTTH-Copilot — Inteligencia operativa para redes FTTH',
    description: 'Agente de IA sobre SmartOLT/Mikrowisp. Diagnóstico en lenguaje natural.',
  },
  // Google Fonts via preconnect + stylesheet link
  other: {
    'preconnect-font': 'https://fonts.googleapis.com',
    'preconnect-font-static': 'https://fonts.gstatic.com',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  colorScheme: 'dark',
  themeColor: '#1a1218',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      {/* Google Fonts — preconnect for faster loading */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <body className="min-h-screen bg-bg text-fg antialiased">
        <AuthProvider>
          <ConnectorProvider>{children}</ConnectorProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
