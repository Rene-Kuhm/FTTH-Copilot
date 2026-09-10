import { describe, expect, it, vi } from 'vitest';
import {
  recordSuppressionAudit,
  listSuppressedEvents,
  type RecordSuppressionInput,
} from '@/lib/maintenance/suppression-audit';

describe('Suppression Audit Log (Fase 5.4)', () => {
  it('records suppression with windowId, category, device, timestamp, and reason', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'log-1' });
    const mockPrisma = {
      agentActionLog: {
        create: mockCreate,
      },
    };

    const input: RecordSuppressionInput = {
      tenantId: 'tenant-1',
      windowId: 'win-123',
      eventId: 'evt-456',
      category: 'metric_anomaly',
      deviceKind: 'ONU',
      deviceId: 'ONU-001',
      whenMs: 1757498400000,
      reason: 'inside_active_maintenance_window',
    };

    const result = await recordSuppressionAudit(mockPrisma as any, input);
    expect(result).toEqual({ id: 'log-1' });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        toolName: '__maintenance_suppression__',
        userId: undefined,
        parameters: {
          windowId: 'win-123',
          eventId: 'evt-456',
          category: 'metric_anomaly',
          deviceKind: 'ONU',
          deviceId: 'ONU-001',
          whenMs: 1757498400000,
          reason: 'inside_active_maintenance_window',
        },
        durationMs: 0,
      },
    });
  });

  it('lists suppressed events for a window filtered by tenantId', async () => {
    const mockFindMany = vi.fn().mockResolvedValue([
      {
        id: 'log-1',
        tenantId: 'tenant-1',
        toolName: '__maintenance_suppression__',
        parameters: {
          windowId: 'win-123',
          category: 'metric_anomaly',
          deviceKind: 'ONU',
          deviceId: 'ONU-001',
          whenMs: 1757498400000,
          reason: 'inside_active_maintenance_window',
        },
        createdAt: new Date('2026-09-10T12:00:00Z'),
      },
    ]);

    const mockPrisma = {
      agentActionLog: {
        findMany: mockFindMany,
      },
    };

    const results = await listSuppressedEvents(mockPrisma as any, {
      tenantId: 'tenant-1',
      windowId: 'win-123',
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'log-1',
      windowId: 'win-123',
      deviceKind: 'ONU',
      deviceId: 'ONU-001',
    });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        toolName: '__maintenance_suppression__',
        parameters: { path: ['windowId'], equals: 'win-123' },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  });
});
