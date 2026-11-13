'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { AuthBar } from '@/components/AuthBar';
import { AuthPageShell } from '@/components/AuthPageShell';
import { useAuth } from '@/lib/auth/client';

export function LoginPageClient({
  oidcEnabled,
  initialOidcError = null,
  initialMfaTempToken = null,
}: {
  oidcEnabled: boolean;
  initialOidcError?: string | null;
  initialMfaTempToken?: string | null;
}) {
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth.user) {
      router.replace('/app' as Route);
    }
  }, [auth.user, router]);

  return (
    <AuthPageShell title="Iniciar sesión" description="Accedé al centro de operaciones de tu organización.">
      <AuthBar
        initialMode="login"
        oidcEnabled={oidcEnabled}
        initialOidcError={initialOidcError}
        initialMfaTempToken={initialMfaTempToken}
      />
      <p className="mt-5 text-center text-xs" style={{ color: 'var(--color-muted)' }}>
        ¿No tenés cuenta?{' '}
        <Link
          href={'/signup' as Route}
          style={{ color: 'var(--color-accent)', fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          Crear cuenta
        </Link>
      </p>
    </AuthPageShell>
  );
}
