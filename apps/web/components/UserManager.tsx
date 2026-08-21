'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission, type Permission } from '@/lib/auth/permissions';
import {
  CheckCircleIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserCircleIcon,
  UserGroupIcon,
  XMarkIcon,
} from './icons';

interface TenantUser {
  id: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';
  createdAt: string;
}

const ROLE_META: Record<
  TenantUser['role'],
  {
    label: string;
    className: string;
  }
> = {
  OWNER: {
    label: 'Propietario',
    className:
      'bg-blue-500/15 text-blue-500 ring-1 ring-inset ring-blue-500/30',
  },
  ADMIN: {
    label: 'Administrador',
    className:
      'bg-success/15 text-emerald-500 ring-1 ring-inset ring-success/30',
  },
  OPERATOR: {
    label: 'Operador',
    className:
      'bg-neutral-800 text-neutral-400 ring-1 ring-inset ring-neutral-700',
  },
  MEMBER: {
    label: 'Miembro (anterior)',
    className:
      'bg-neutral-800 text-neutral-500 ring-1 ring-inset ring-neutral-700',
  },
};

export function UserManager() {
  const auth = useAuth();
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'OWNER' | 'ADMIN' | 'OPERATOR'>('OPERATOR');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canManage =
    auth.user && hasPermission(auth.user.role, 'manage_users' as Permission);

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    try {
      const r = await fetch('/api/users', { credentials: 'include' });
      const data = await r.json();
      setUsers(data.users ?? []);
    } catch {
      // noop
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  if (!auth.user || !canManage) return null;

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          password,
          name: name || undefined,
          role,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Error');
      }
      setShowForm(false);
      setEmail('');
      setPassword('');
      setName('');
      setRole('OPERATOR');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  async function changeRole(userId: string, newRole: string) {
    try {
      const r = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Error');
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el rol.');
    }
  }

  async function deleteUser(userId: string) {
    if (!confirm('¿Seguro que querés eliminar este usuario?')) return;
    try {
      const r = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Error');
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo eliminar el usuario.');
    }
  }

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500 ring-1 ring-inset ring-blue-500/30">
            <UserGroupIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-neutral-50">Gestión de usuarios</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {users.length} usuario{users.length === 1 ? '' : 's'} en tu organización
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="btn-outline"
        >
          {showForm ? (
            <>
              <XMarkIcon className="h-4 w-4" />
              Cancelar
            </>
          ) : (
            <>
              <PlusIcon className="h-4 w-4" />
              Agregar usuario
            </>
          )}
        </button>
      </header>

      <div className="border-t border-neutral-800">
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <UserGroupIcon className="h-8 w-8 text-neutral-500" />
            <p className="text-sm font-medium text-neutral-50">Todavía no hay usuarios</p>
            <p className="text-xs text-neutral-500">
              Agregá a tu equipo para darle acceso a la organización.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-950/40 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-5 py-2.5 font-medium">Usuario</th>
                  <th className="px-3 py-2.5 font-medium">Rol</th>
                  <th className="px-3 py-2.5 font-medium">Alta</th>
                  <th className="px-5 py-2.5 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/70">
                {users.map((u) => {
                  const isSelf = u.id === auth.user!.id;
                  const isOwner = u.role === 'OWNER';
                  const canEdit = auth.user!.role === 'OWNER' && !isSelf;
                  const meta = ROLE_META[u.role];
                  return (
                    <tr
                      key={u.id}
                      className="transition-colors hover:bg-neutral-950/40"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-neutral-800 text-neutral-400">
                            <UserCircleIcon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-neutral-50">
                                {u.name ?? '—'}
                              </span>
                              {isSelf && (
                                <span className="badge bg-neutral-800 text-neutral-500 ring-1 ring-inset ring-neutral-800">
                                  vos
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-neutral-500">
                              {u.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        {canEdit && !isOwner ? (
                          <select
                            value={u.role}
                            onChange={(e) =>
                              void changeRole(u.id, e.target.value)
                            }
                            className="input w-auto py-1 text-xs"
                          >
                            <option value="ADMIN">Administrador</option>
                            <option value="OPERATOR">Operador</option>
                          </select>
                        ) : (
                          <span className={meta.className + ' badge'}>
                            {u.role === 'OWNER' && (
                              <ShieldCheckIcon className="h-3.5 w-3.5" />
                            )}
                            {meta.label}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-neutral-400">
                            {new Date(u.createdAt).toLocaleDateString('es-AR')}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canEdit && !isOwner ? (
                          <button
                            type="button"
                            onClick={() => void deleteUser(u.id)}
                            className="btn-danger px-2.5 py-1.5"
                          >
                            <TrashIcon className="h-4 w-4" />
                            <span className="hidden sm:inline">Eliminar</span>
                          </button>
                        ) : (
                          <span className="text-xs text-neutral-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {loading && (
          <p role="status" className="px-5 py-3 text-xs text-neutral-400">Cargando…</p>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={(e) => void createUser(e)}
          className="space-y-4 border-t border-neutral-800 bg-neutral-950/40 px-5 py-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-neutral-400">
                Nombre <span className="text-neutral-500">(opcional)</span>
              </span>
              <input
                type="text"
                name="name"
                autoComplete="name"
                placeholder="Nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-400">Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="email@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-400">
                Contraseña <span className="text-neutral-500">(mínimo 8)</span>
              </span>
              <input
                type="password"
                name="new-password"
                autoComplete="new-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="input"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-neutral-400">Rol</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="input"
              >
                {auth.user!.role === 'OWNER' && (
                  <option value="OWNER">Propietario</option>
                )}
                <option value="ADMIN">Administrador</option>
                <option value="OPERATOR">Operador</option>
              </select>
            </label>
          </div>

          {error && (
            <div role="alert" aria-live="assertive" className="rounded-lg border border-danger/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary"
            >
              <CheckCircleIcon className="h-4 w-4" />
              {submitting ? 'Creando…' : 'Crear usuario'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
