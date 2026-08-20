'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { hasPermission, type Permission } from '@/lib/auth/permissions';

interface TenantUser {
  id: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER';
  createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  MEMBER: 'Member (legacy)',
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

  const canManage = auth.user && hasPermission(auth.user.role, 'manage_users' as Permission);

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
        body: JSON.stringify({ email, password, name: name || undefined, role }),
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
    <section className="mb-6 rounded-md border border-neutral-800 bg-bg-subtle p-4">
      <header className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">User Management</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs text-fg-muted hover:text-fg"
        >
          {showForm ? 'Cancel' : '+ Add user'}
        </button>
      </header>

      {users.length === 0 ? (
        <p className="text-xs text-fg-muted">No users found.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-fg-muted">
              <th className="pb-2 pr-4 font-medium">Name</th>
              <th className="pb-2 pr-4 font-medium">Email</th>
              <th className="pb-2 pr-4 font-medium">Role</th>
              <th className="pb-2 pr-4 font-medium">Created</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === auth.user!.id;
              const isOwner = u.role === 'OWNER';
              const canEdit = auth.user!.role === 'OWNER' && !isSelf;
              return (
                <tr key={u.id} className="border-b border-neutral-800/50">
                  <td className="py-2 pr-4">{u.name ?? '—'}</td>
                  <td className="py-2 pr-4">{u.email}</td>
                  <td className="py-2 pr-4">
                    {canEdit && !isOwner ? (
                      <select
                        value={u.role}
                        onChange={(e) => void changeRole(u.id, e.target.value)}
                        className="rounded border border-neutral-700 bg-bg px-1 py-0.5 text-xs focus:border-accent focus:outline-none"
                      >
                        <option value="ADMIN">Admin</option>
                        <option value="OPERATOR">Operator</option>
                      </select>
                    ) : (
                      <span>{ROLE_LABELS[u.role] ?? u.role}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2">
                    {canEdit && !isOwner ? (
                      <button
                        onClick={() => void deleteUser(u.id)}
                        className="text-red-400 hover:text-red-300"
                      >
                        Remove
                      </button>
                    ) : isSelf ? (
                      <span className="text-fg-muted">(you)</span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {loading && <p className="mt-2 text-xs text-fg-muted">Loading...</p>}

      {showForm && (
        <form onSubmit={(e) => void createUser(e)} className="mt-3 space-y-2">
          <input
            type="text"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            placeholder="Password (min 8 chars)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          >
            {auth.user!.role === 'OWNER' && <option value="OWNER">Owner</option>}
            <option value="ADMIN">Admin</option>
            <option value="OPERATOR">Operator</option>
          </select>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create user'}
          </button>
        </form>
      )}
    </section>
  );
}
