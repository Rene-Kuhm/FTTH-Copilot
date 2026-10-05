import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/server';
import { MfaSetupPanel } from '@/components/MfaSetupPanel';
import { AppShell } from '@/components/AppShell';

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/');
  }

  return (
    <AppShell
      active="settings"
      eyebrow="Cuenta"
      title="Configuración"
      description="Seguridad y preferencias de tu cuenta."
    >
      <div className="space-y-6 max-w-2xl">
        {/* ── Seguridad ──────────────────────────────────────── */}
        <section>
          <h2
            className="text-base font-semibold mb-4 pb-2"
            style={{
              color: 'var(--color-text)',
              fontFamily: 'var(--font-display)',
              borderBottom: '1px solid var(--border-divider)',
            }}
          >
            Seguridad
          </h2>
          <div className="card p-5 space-y-1">
            <div className="flex items-center gap-2 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" style={{ color: 'var(--color-accent)' }}>
                <path
                  fillRule="evenodd"
                  d="M10 1.944a9.964 9.964 0 012.5 1.757v1.302l2.943 1.7-1.591 2.756L10 5.868l-2.753 1.697-1.591-2.756 2.944-1.7V3.701A9.964 9.964 0 0110 1.944zM11 14.732V12a1 1 0 00-.553.894l2 1A1 1 0 0014 14h1a1 1 0 00.894-.553l1-2A1 1 0 0017 12v2.732a7.97 7.97 0 01-3.422 1.072 7.97 7.97 0 01-3.556 0A7.97 7.97 0 0111 14.732z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>
                Autenticación multifactor (MFA)
              </span>
            </div>
            <MfaSetupPanel mfaEnabled={user.mfaEnabled} userId={user.id} />
          </div>
        </section>

        {/* ── Info de cuenta ───────────────────────────────── */}
        <section>
          <h2
            className="text-base font-semibold mb-4 pb-2"
            style={{
              color: 'var(--color-text)',
              fontFamily: 'var(--font-display)',
              borderBottom: '1px solid var(--border-divider)',
            }}
          >
            Cuenta
          </h2>
          <div className="card p-5 space-y-3">
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-muted)' }}>Email</span>
              <span style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>{user.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-muted)' }}>Rol</span>
              <span className="badge badge-accent">{user.role}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span style={{ color: 'var(--color-muted)' }}>Tenant</span>
              <span style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>{user.tenant.name}</span>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
