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
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#071018',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-bg text-fg antialiased">
        <AuthProvider>
          <ConnectorProvider>{children}</ConnectorProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
