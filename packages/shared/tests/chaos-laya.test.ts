import { afterEach, expect, it, vi } from 'vitest';
import { createCircuitBreaker, createLayaClient, DEFAULT_LAYA_CONFIG } from '../src/laya-client';

afterEach(() => vi.useRealTimers());

it('fails open during a Laya outage, suppresses requests, then restores decisions after a successful probe', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T10:00:00.000Z'));

  const circuitBreaker = createCircuitBreaker({
    consecutiveFailuresThreshold: 2,
    resetTimeoutMs: 30_000,
  });
  const transport = vi.fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('Network unavailable'))
    .mockRejectedValueOnce(new TypeError('Network unavailable'))
    .mockImplementationOnce(async () => {
      expect(circuitBreaker.getState().status).toBe('half-open');
      return Response.json({
        eventId: 'event-chaos',
        eventClass: 'NORMAL',
        severity: 'INFO',
        probableScope: 'UNKNOWN',
        requiresInvestigation: false,
        confidence: 0.9,
      });
    });

  const client = createLayaClient({
    config: {
      ...DEFAULT_LAYA_CONFIG, url: 'https://laya.tenant-chaos-a.example',
      enabled: true, mode: 'assisted', failOpen: true,
    },
    fetch: transport,
    circuitBreaker,
  });
  const event = { tenantId: 'tenant-chaos-a', rawSummary: 'Synthetic event during outage' };

  await expect(client.decide(event)).resolves.toBeNull();
  expect(client.getCircuitBreakerState().status).toBe('closed');
  await expect(client.decide(event)).resolves.toBeNull();
  expect(client.getCircuitBreakerState()).toMatchObject({ status: 'open', consecutiveFailures: 2 });

  await vi.advanceTimersByTimeAsync(29_999);
  await expect(client.decide(event)).resolves.toBeNull();
  expect(transport).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(1);
  await expect(client.decide(event)).resolves.toMatchObject({ eventClass: 'NORMAL' });
  expect(transport).toHaveBeenCalledTimes(3);
  expect(client.getCircuitBreakerState()).toMatchObject({ status: 'closed', consecutiveFailures: 0 });
});
