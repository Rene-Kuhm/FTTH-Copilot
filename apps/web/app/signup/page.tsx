'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { AuthBar } from '@/components/AuthBar';
import { AuthPageShell } from '@/components/AuthPageShell';
import { useAuth } from '@/lib/auth/client';

export default function SignupPage() {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.user) {
      router.replace('/app' as Route);
    }
  }, [auth.user, router]);

  return (
    <AuthPageShell title="Crear tu espacio" description="Configurá tu organización y conectá el primer NMS con el asistente guiado.">
      <AuthBar initialMode="signup" />
      <p className="mt-5 text-center text-xs text-neutral-500">
        ¿Ya tenés cuenta?{' '}
        <Link href={'/login' as Route} className="font-semibold text-cyan-300 hover:text-cyan-200">
          Iniciar sesión
        </Link>
      </p>
    </AuthPageShell>
  );
}
