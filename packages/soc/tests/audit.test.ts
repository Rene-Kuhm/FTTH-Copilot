import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock before imports (hoisted via vi.hoisted) ──────────────────────────
const { mockFn } = vi.hoisted(() => {
  const fn = vi.fn().mockResolvedValue({ id: 'audit-1' });
  return { mockFn: fn };
});
vi.mock('@ftth-copilot/db', () => ({
  prisma: {
    auditLog: {
      create: mockFn,
    },
  },
}));

// ── Imports to test ─────────────────────────────────────────────────────────
import {
  audit,
  auditAuth,
  auditIncident,
  auditConnector,
  auditNotification,
  auditMaintenance,
  auditUser,
} from '../src/audit';

const ctx = {
  tenantId: 'tenant-1',
  actorId: 'user-1',
  actorEmail: 'admin@test.com',
  actorRole: 'ADMIN',
  ipAddress: '192.168.1.1',
  userAgent: 'Test/1.0',
};

describe('audit() — core function', () => {
  beforeEach(() => mockFn.mockClear());
  afterEach(() => mockFn.mockClear());

  it('calls prisma.auditLog.create with all context fields', async () => {
    await audit(ctx, {
      category: 'AUTH',
      action: 'logged in',
      resourceType: 'User',
      resourceId: 'user-1',
      outcome: 'SUCCESS',
    });
    expect(mockFn).toHaveBeenCalledTimes(1);
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.category).toBe('AUTH');
    expect(data.action).toBe('logged in');
    expect(data.resourceType).toBe('User');
    expect(data.resourceId).toBe('user-1');
    expect(data.outcome).toBe('SUCCESS');
    expect(data.tenantId).toBe('tenant-1');
    expect(data.actorId).toBe('user-1');
    expect(data.actorEmail).toBe('admin@test.com');
    expect(data.actorRole).toBe('ADMIN');
    expect(data.ipAddress).toBe('192.168.1.1');
    expect(data.userAgent).toBe('Test/1.0');
  });

  it('nulls optional context fields when not provided', async () => {
    await audit({ tenantId: 't1', actorId: 'system' }, {
      category: 'SYSTEM',
      action: 'background job ran',
      resourceType: 'Job',
      resourceId: 'job-1',
      outcome: 'SUCCESS',
    });
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.actorEmail).toBeNull();
    expect(data.actorRole).toBeNull();
    expect(data.ipAddress).toBeNull();
    expect(data.userAgent).toBeNull();
  });

  it('accepts metadata in entry', async () => {
    await audit(ctx, {
      category: 'INCIDENT',
      action: 'confirmed incident',
      resourceType: 'Incident',
      resourceId: 'inc-1',
      outcome: 'SUCCESS',
      metadata: { previousStatus: 'open', newStatus: 'confirmed' },
    });
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.metadata).toEqual({ previousStatus: 'open', newStatus: 'confirmed' });
  });

  it('swallows DB errors silently (catch branch)', async () => {
    // Make the mock reject so the catch branch executes
    mockFn.mockRejectedValueOnce(new Error('DB unavailable'));
    // audit() must NOT throw — errors are swallowed
    await expect(audit(ctx, {
      category: 'AUTH',
      action: 'login failed',
      resourceType: 'User',
      resourceId: 'user-1',
      outcome: 'FAILURE',
    })).resolves.toBeUndefined();
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('accepts undefined metadata (defaults to empty object)', async () => {
    await audit(ctx, {
      category: 'AUTH',
      action: 'logout',
      resourceType: 'User',
      resourceId: 'user-1',
      outcome: 'SUCCESS',
    });
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    // metadata should be present (never undefined after casting)
    expect(typeof data.metadata).toBe('object');
  });
});

describe('auditAuth', () => {
  beforeEach(() => mockFn.mockClear());

  it('login success → action "logged in", outcome SUCCESS', async () => {
    await auditAuth.login(ctx, 'user-1', true);
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.category).toBe('AUTH');
    expect(data.action).toBe('logged in');
    expect(data.outcome).toBe('SUCCESS');
    expect(data.resourceType).toBe('User');
    expect(data.resourceId).toBe('user-1');
  });

  it('login failure → action "login failed", outcome FAILURE', async () => {
    await auditAuth.login(ctx, 'user-1', false, { reason: 'bad password' });
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('login failed');
    expect(data.outcome).toBe('FAILURE');
    expect(data.metadata).toEqual({ reason: 'bad password' });
  });

  it('logout → action "logged out"', async () => {
    await auditAuth.logout(ctx, 'user-1');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('logged out');
    expect(data.outcome).toBe('SUCCESS');
  });

  it('permissionDenied → action contains reason, outcome FAILURE', async () => {
    await auditAuth.permissionDenied(ctx, 'delete_connector', 'NmsConnection', 'conn-1');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toContain('permission denied');
    expect(data.action).toContain('delete_connector');
    expect(data.outcome).toBe('FAILURE');
  });
});

describe('auditIncident', () => {
  beforeEach(() => mockFn.mockClear());

  it('created → INCIDENT category, "created incident" action', async () => {
    await auditIncident.created(ctx, 'inc-123');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.category).toBe('INCIDENT');
    expect(data.action).toBe('created incident');
    expect(data.resourceId).toBe('inc-123');
    expect(data.outcome).toBe('SUCCESS');
  });

  it('confirmed → "confirmed incident"', async () => {
    await auditIncident.confirmed(ctx, 'inc-456');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('confirmed incident');
    expect(data.resourceId).toBe('inc-456');
  });

  it('resolved → "resolved incident"', async () => {
    await auditIncident.resolved(ctx, 'inc-789');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('resolved incident');
  });
});

describe('auditConnector', () => {
  beforeEach(() => mockFn.mockClear());

  it('created → CONNECTOR category with provider in action', async () => {
    await auditConnector.created(ctx, 'conn-1', 'SMARTOLT');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.category).toBe('CONNECTOR');
    expect(data.action).toBe('created SMARTOLT connector');
    expect(data.resourceType).toBe('NmsConnection');
    expect(data.resourceId).toBe('conn-1');
  });

  it('updated → "updated connector config"', async () => {
    await auditConnector.updated(ctx, 'conn-2');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('updated connector config');
  });

  it('deleted → "deleted connector"', async () => {
    await auditConnector.deleted(ctx, 'conn-3');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('deleted connector');
    expect(data.outcome).toBe('SUCCESS');
  });

  it('tested success → outcome SUCCESS', async () => {
    await auditConnector.tested(ctx, 'conn-1', true);
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('tested connector');
    expect(data.outcome).toBe('SUCCESS');
  });

  it('tested failure → outcome FAILURE', async () => {
    await auditConnector.tested(ctx, 'conn-1', false);
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.outcome).toBe('FAILURE');
  });
});

describe('auditNotification', () => {
  beforeEach(() => mockFn.mockClear());

  it('channelCreated with type → action includes type', async () => {
    await auditNotification.channelCreated(ctx, 'ch-1', 'slack');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.category).toBe('NOTIFICATION');
    expect(data.action).toBe('created slack notification channel');
    expect(data.resourceType).toBe('NotificationChannel');
  });

  it('channelUpdated → "updated notification channel"', async () => {
    await auditNotification.channelUpdated(ctx, 'ch-2');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('updated notification channel');
  });

  it('channelDeleted → "deleted notification channel"', async () => {
    await auditNotification.channelDeleted(ctx, 'ch-3');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('deleted notification channel');
  });

  it('deliveryFailed → FAILURE with error metadata', async () => {
    await auditNotification.deliveryFailed(ctx, 'ch-1', 'Connection refused');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.outcome).toBe('FAILURE');
    expect(data.metadata).toEqual({ error: 'Connection refused' });
  });
});

describe('auditMaintenance', () => {
  beforeEach(() => mockFn.mockClear());

  it('created → MAINTENANCE category', async () => {
    await auditMaintenance.created(ctx, 'mw-1');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.category).toBe('MAINTENANCE');
    expect(data.action).toBe('created maintenance window');
    expect(data.resourceType).toBe('MaintenanceWindow');
  });

  it('updated → "updated maintenance window"', async () => {
    await auditMaintenance.updated(ctx, 'mw-1');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('updated maintenance window');
  });

  it('deleted → "deleted maintenance window"', async () => {
    await auditMaintenance.deleted(ctx, 'mw-1');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('deleted maintenance window');
  });
});

describe('auditUser', () => {
  beforeEach(() => mockFn.mockClear());

  it('created → USER_MANAGEMENT category', async () => {
    await auditUser.created(ctx, 'user-new');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.category).toBe('USER_MANAGEMENT');
    expect(data.action).toBe('created user');
    expect(data.resourceType).toBe('User');
  });

  it('roleChanged → metadata includes oldRole and newRole', async () => {
    await auditUser.roleChanged(ctx, 'user-1', 'MEMBER', 'ADMIN');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('changed user role');
    expect(data.metadata).toEqual({ oldRole: 'MEMBER', newRole: 'ADMIN' });
  });

  it('deleted → "deleted user"', async () => {
    await auditUser.deleted(ctx, 'user-1');
    const { data } = mockFn.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data.action).toBe('deleted user');
  });
});
