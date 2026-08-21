'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { AuthBar } from '@/components/AuthBar';
import { AuthPageShell } from '@/components/AuthPageShell';
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
    <AuthPageShell title="Iniciar sesión" description="Accedé al centro de operaciones de tu organización.">
      <AuthBar initialMode="login" />
      <p className="mt-5 text-center text-xs text-neutral-500">
        ¿No tenés cuenta?{' '}
        <Link href={'/signup' as Route} className="font-semibold text-cyan-300 hover:text-cyan-200">
          Crear cuenta
        </Link>
      </p>
    </AuthPageShell>
  );
}
