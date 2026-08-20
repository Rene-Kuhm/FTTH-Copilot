'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { AuthBar } from '@/components/AuthBar';
import { useAuth } from '@/lib/auth/client';

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.user) {
      router.replace('/app' as Route);
    }
  }, [auth.user, router]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-12">
      <header className="mb-8 text-center">
        <Link href="/" className="inline-block text-sm text-neutral-400 hover:text-neutral-50">
          ← FTTH-Copilot
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
        <p className="mt-1 text-sm text-neutral-400">Accedé a tu panel de diagnóstico.</p>
      </header>
      <AuthBar initialMode="login" />
      <p className="text-center text-xs text-neutral-400">
        ¿No tenés cuenta?{' '}
        <Link href={'/signup' as Route} className="text-blue-500 hover:underline">
          Crear cuenta
        </Link>
      </p>
    </main>
  );
}
