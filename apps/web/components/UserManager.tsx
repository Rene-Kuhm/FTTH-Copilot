'use client';

import { useEffect, useState } from 'react';
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
    label: 'Owner',
    className:
      'bg-blue-500/15 text-blue-500 ring-1 ring-inset ring-blue-500/30',
  },
  ADMIN: {
    label: 'Admin',
    className:
      'bg-success/15 text-emerald-500 ring-1 ring-inset ring-success/30',
  },
  OPERATOR: {
    label: 'Operator',
    className:
      'bg-neutral-800 text-neutral-400 ring-1 ring-inset ring-neutral-700',
  },
  MEMBER: {
    label: 'Member (legacy)',
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

  const refresh = async () => {
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
  };

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [auth.user]);

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
      alert(e instanceof Error ? e.message : 'Error changing role');
    }
  }

  async function deleteUser(userId: string) {
    if (!confirm('Are you sure you want to remove this user?')) return;
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
      alert(e instanceof Error ? e.message : 'Error deleting user');
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
            <h2 className="text-sm font-semibold text-neutral-50">User Management</h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {users.length} member{users.length === 1 ? '' : 's'} in your tenant
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
              Cancel
            </>
          ) : (
            <>
              <PlusIcon className="h-4 w-4" />
              Add user
            </>
          )}
        </button>
      </header>

      <div className="border-t border-neutral-800">
        {users.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
            <UserGroupIcon className="h-8 w-8 text-neutral-500" />
            <p className="text-sm font-medium text-neutral-50">No users yet</p>
            <p className="text-xs text-neutral-500">
              Add a teammate to give them access to your tenant.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-950/40 text-left text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-5 py-2.5 font-medium">User</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="px-3 py-2.5 font-medium">Joined</th>
                  <th className="px-5 py-2.5 font-medium text-right">Actions</th>
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
                                  you
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
                            <option value="ADMIN">Admin</option>
                            <option value="OPERATOR">Operator</option>
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
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canEdit && !isOwner ? (
                          <button
                            type="button"
                            onClick={() => void deleteUser(u.id)}
                            className="btn-danger px-2.5 py-1.5"
                          >
                            <TrashIcon className="h-4 w-4" />
                            <span className="hidden sm:inline">Remove</span>
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
          <p className="px-5 py-3 text-xs text-neutral-500">Loading...</p>
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
                Name <span className="text-neutral-500">(optional)</span>
              </span>
              <input
                type="text"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-400">Email</span>
              <input
                type="email"
                placeholder="email@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-neutral-400">
                Password <span className="text-neutral-500">(min 8)</span>
              </span>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="input"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-neutral-400">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="input"
              >
                {auth.user!.role === 'OWNER' && (
                  <option value="OWNER">Owner</option>
                )}
                <option value="ADMIN">Admin</option>
                <option value="OPERATOR">Operator</option>
              </select>
            </label>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
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
              {submitting ? 'Creating...' : 'Create user'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
