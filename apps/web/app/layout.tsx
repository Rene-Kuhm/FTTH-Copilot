import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FTTH-Copilot — Diagnóstico de red en lenguaje natural',
  description:
    'Agente de IA sobre SmartOLT/Mikrowisp. Diagnóstico en lenguaje natural, sin reemplazar tu NMS.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-neutral-950 text-neutral-50 antialiased">{children}</body>
    </html>
  );
}
