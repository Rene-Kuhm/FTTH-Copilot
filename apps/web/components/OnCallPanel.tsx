'use client';

/**
 * OnCallPanel - On-Call Scheduling Component
 *
 * Displays current on-call assignments and allows managing schedules.
 */
import { useState, useEffect, useCallback } from 'react';

interface OnCallSchedule {
  id: string;
  name: string;
  description: string | null;
  rotationType: string;
  primaryUserId: string | null;
  backupUserId: string | null;
  escalationUserId: string | null;
  handoffTime: string;
  timezone: string;
  enabled: boolean;
  currentEntry: OnCallEntry | null;
  createdAt: string;
}

interface OnCallEntry {
  id: string;
  userId: string;
  role: string;
  startUtc: string;
  endUtc: string;
  notes: string | null;
}

interface User {
  id: string;
  email: string;
  name: string | null;
}

export function OnCallPanel() {
  const [schedules, setSchedules] = useState<OnCallSchedule[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    rotationType: 'weekly',
    primaryUserId: '',
    backupUserId: '',
    escalationUserId: '',
    handoffTime: '09:00',
    timezone: 'UTC',
  });

  const fetchSchedules = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/oncall');
      if (!res.ok) throw new Error('Failed to fetch schedules');
      const data = await res.json();
      setSchedules(data.schedules ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
      }
    } catch {
      // Ignore user fetch errors
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchSchedules(); }, [fetchSchedules]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const res = await fetch('/api/ops/oncall', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editingId ? { id: editingId, ...formData } : formData),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save schedule');
      }

      setShowCreateForm(false);
      setEditingId(null);
      setFormData({
        name: '',
        description: '',
        rotationType: 'weekly',
        primaryUserId: '',
        backupUserId: '',
        escalationUserId: '',
        handoffTime: '09:00',
        timezone: 'UTC',
      });
      fetchSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return;

    try {
      const res = await fetch(`/api/ops/oncall?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete schedule');
      fetchSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleEdit = (schedule: OnCallSchedule) => {
    setFormData({
      name: schedule.name,
      description: schedule.description ?? '',
      rotationType: schedule.rotationType,
      primaryUserId: schedule.primaryUserId ?? '',
      backupUserId: schedule.backupUserId ?? '',
      escalationUserId: schedule.escalationUserId ?? '',
      handoffTime: schedule.handoffTime,
      timezone: schedule.timezone,
    });
    setEditingId(schedule.id);
    setShowCreateForm(true);
  };

  const getUserName = (userId: string | null): string => {
    if (!userId) return 'Unassigned';
    const user = users.find((u) => u.id === userId);
    return user?.name ?? user?.email ?? 'Unknown';
  };

  const formatTime = (dateStr: string): string => {
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          On-Call Schedules
        </h2>
        <button
          onClick={() => {
            setShowCreateForm(true);
            setEditingId(null);
            setFormData({
              name: '',
              description: '',
              rotationType: 'weekly',
              primaryUserId: '',
              backupUserId: '',
              escalationUserId: '',
              handoffTime: '09:00',
              timezone: 'UTC',
            });
          }}
          className="px-3 py-1.5 bg-primary-600 text-white text-sm rounded-md hover:bg-primary-700"
        >
          + New Schedule
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleSubmit} className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Schedule Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-800"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Rotation Type
              </label>
              <select
                value={formData.rotationType}
                onChange={(e) => setFormData({ ...formData, rotationType: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-800"
              >
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Primary On-Call
              </label>
              <select
                value={formData.primaryUserId}
                onChange={(e) => setFormData({ ...formData, primaryUserId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-800"
              >
                <option value="">Select user</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name ?? user.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Backup On-Call
              </label>
              <select
                value={formData.backupUserId}
                onChange={(e) => setFormData({ ...formData, backupUserId: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-800"
              >
                <option value="">Select user</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name ?? user.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Handoff Time
              </label>
              <input
                type="time"
                value={formData.handoffTime}
                onChange={(e) => setFormData({ ...formData, handoffTime: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-800"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Timezone
              </label>
              <input
                type="text"
                value={formData.timezone}
                onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-800"
                placeholder="UTC"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-800"
                rows={2}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
            >
              {editingId ? 'Update Schedule' : 'Create Schedule'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setEditingId(null);
              }}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {schedules.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No on-call schedules configured
          </div>
        ) : (
          schedules.map((schedule) => (
            <div key={schedule.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white">
                    {schedule.name}
                    {!schedule.enabled && (
                      <span className="ml-2 text-xs bg-gray-200 dark:bg-gray-700 px-2 py-0.5 rounded">
                        Disabled
                      </span>
                    )}
                  </h3>
                  {schedule.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {schedule.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Primary: </span>
                      <span className="font-medium text-primary-600 dark:text-primary-400">
                        {getUserName(schedule.primaryUserId)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Backup: </span>
                      <span className="font-medium">
                        {getUserName(schedule.backupUserId)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Rotation: </span>
                      <span className="capitalize">{schedule.rotationType}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Handoff: </span>
                      <span>{schedule.handoffTime} {schedule.timezone}</span>
                    </div>
                  </div>

                  {schedule.currentEntry && (
                    <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                        Currently On-Call
                      </p>
                      <p className="text-sm text-blue-600 dark:text-blue-400">
                        {getUserName(schedule.currentEntry.userId)} ({schedule.currentEntry.role})
                      </p>
                      <p className="text-xs text-blue-500 dark:text-blue-500">
                        {formatTime(schedule.currentEntry.startUtc)} - {formatTime(schedule.currentEntry.endUtc)}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(schedule)}
                    className="px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(schedule.id)}
                    className="px-2 py-1 text-sm text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
