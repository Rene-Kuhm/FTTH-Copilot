import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  notifyOnce,
  notificationFingerprint,
} from '../src/notification-deduper';

const baseParts = {
  tenantId: 't1',
  kind: 'k',
  channel: 'webhook' as const,
  sourceIp: '1.2.3.4',
  severity: 'warning',
  title: 't',
};

describe('notificationFingerprint', () => {
  it('produces a stable 16-char hex digest', () => {
    const fp = notificationFingerprint({
      ...baseParts,
      title: 'Possible brute force from 1.2.3.4',
    });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is identical for two calls with the same logical input', () => {
    const a = notificationFingerprint({
      ...baseParts,
      title: 'Possible brute force from 1.2.3.4',
    });
    const b = notificationFingerprint({
      ...baseParts,
      title: 'Possible brute force from 1.2.3.4',
    });
    expect(a).toBe(b);
  });

  it('differs when any field changes', () => {
    const base = notificationFingerprint({ ...baseParts });
    expect(notificationFingerprint({ ...baseParts, sourceIp: '5.6.7.8' })).not.toBe(base);
    expect(notificationFingerprint({ ...baseParts, severity: 'critical' })).not.toBe(base);
    expect(notificationFingerprint({ ...baseParts, title: 'different' })).not.toBe(base);
    // The fingerprint function explicitly canonicalizes both null and
    // undefined connectionId to '' (see helper source), so passing
    // either form must NOT change the fingerprint. Pinning that
    // behavior prevents drift to undefined-as-distinct in the future.
    expect(notificationFingerprint({ ...baseParts, connectionId: null })).toBe(base);
    expect(notificationFingerprint({ ...baseParts, channel: 'telegram' })).not.toBe(base);
  });

  it('treats undefined and empty-string connectionId the same (canonical fingerprint)', () => {
    const a = notificationFingerprint({
      ...baseParts,
      connectionId: undefined,
    });
    const b = notificationFingerprint({
      ...baseParts,
      connectionId: '',
    });
    expect(a).toBe(b);
  });
});

describe('notifyOnce', () => {
  let cache: Map<string, { ts: number }>;

  beforeEach(() => {
    cache = new Map();
  });

  it('calls sendFn on the first call (returns sent=true)', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const r = await notifyOnce(cache, baseParts, 5 * 60 * 1000, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe(true);
  });

  it('skips sendFn on the second call within the cooldown', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    await notifyOnce(cache, baseParts, 5 * 60 * 1000, send, 1000);
    const r = await notifyOnce(cache, baseParts, 5 * 60 * 1000, send, 1000 + 30 * 1000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe(false);
    expect(r.skipped).toBe(true);
  });

  it('calls sendFn again after the cooldown window has elapsed', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const cooldown = 60 * 1000;
    await notifyOnce(cache, baseParts, cooldown, send, 1000);
    const r = await notifyOnce(cache, baseParts, cooldown, send, 1000 + cooldown + 1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(r.sent).toBe(true);
  });

  it('processes different fingerprints independently', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const a = { ...baseParts, sourceIp: '1.2.3.4', title: 'A' };
    const b = { ...baseParts, sourceIp: '5.6.7.8', title: 'B' };
    await notifyOnce(cache, a, 60_000, send);
    await notifyOnce(cache, b, 60_000, send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does NOT record the fingerprint when sendFn returns ok=false (transient failure)', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, error: 'webhook 500' });
    const r = await notifyOnce(cache, baseParts, 60_000, send);
    expect(r.sent).toBe(false);
    expect(r.error).toBe('webhook 500');
    // The cache must be empty so the next call retries.
    expect(cache.size).toBe(0);
    const send2 = vi.fn().mockResolvedValue({ ok: true });
    const r2 = await notifyOnce(cache, baseParts, 60_000, send2);
    expect(r2.sent).toBe(true);
    expect(send2).toHaveBeenCalledTimes(1);
  });

  it('pruneCache: drops entries older than the cooldown window', async () => {
    // Two entries with timestamps far enough apart that both fall
    // outside the cooldown of a third, later, call. The prune on the
    // third call drops BOTH A and B; only the third entry (C) remains.
    const send = vi.fn().mockResolvedValue({ ok: true });
    const cooldown = 1000;
    const partsA = { ...baseParts, sourceIp: '1.1.1.1', title: 'A' };
    const partsB = { ...baseParts, sourceIp: '2.2.2.2', title: 'B' };
    const partsC = { ...baseParts, sourceIp: '3.3.3.3', title: 'C' };
    await notifyOnce(cache, partsA, cooldown, send, 1000);  // ts=1000
    await notifyOnce(cache, partsB, cooldown, send, 1100);  // ts=1100
    // The third call lands at t=1100+cooldown+200=2300. cutoff=1300.
    // A(1000) < 1300 → purga. B(1100) < 1300 → purga. C(2300) NOT < 1300 → queda.
    await notifyOnce(cache, partsC, cooldown, send, 1100 + cooldown + 200);
    expect(cache.size).toBe(1);
    expect(cache.has(notificationFingerprint(partsA))).toBe(false);
    expect(cache.has(notificationFingerprint(partsB))).toBe(false);
    expect(cache.has(notificationFingerprint(partsC))).toBe(true);
  });

  it('pruneCache: keeps entries that fall inside the cooldown window', async () => {
    // Two entries added within the cooldown of the third call — the
    // prune must not drop them. Pin current behavior.
    const send = vi.fn().mockResolvedValue({ ok: true });
    const cooldown = 1000;
    const partsA = { ...baseParts, sourceIp: '1.1.1.1', title: 'A' };
    const partsB = { ...baseParts, sourceIp: '2.2.2.2', title: 'B' };
    await notifyOnce(cache, partsA, cooldown, send, 1000); // ts=1000
    await notifyOnce(cache, partsB, cooldown, send, 1100); // ts=1100
    // No third call yet — the cache must hold both entries.
    expect(cache.size).toBe(2);
    expect(cache.has(notificationFingerprint(partsA))).toBe(true);
    expect(cache.has(notificationFingerprint(partsB))).toBe(true);
  });

  it('boundary: at exactly cooldownMs the call is treated as still inside (inclusive less-or-equal)', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const cooldown = 1000;
    await notifyOnce(cache, baseParts, cooldown, send, 1000);
    // Same exact elapsed time → still inside (the guard is `now - ts <= cooldown`).
    const r = await notifyOnce(cache, baseParts, cooldown, send, 1000 + cooldown);
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.sent).toBe(false);
    expect(r.skipped).toBe(true);
  });

  it('webhook and Telegram channels have independent cooldowns', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    const webhookParts = { ...baseParts, channel: 'webhook' as const };
    const telegramParts = { ...baseParts, channel: 'telegram' as const };
    await notifyOnce(cache, webhookParts, 5 * 60 * 1000, send, 1000);
    // Telegram within the same instant should NOT skip — different channel.
    const r = await notifyOnce(cache, telegramParts, 5 * 60 * 1000, send, 1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(r.sent).toBe(true);
  });

  it('regression: 5 ticks at 60s with a 5-min cooldown produce ONE notification in that window', async () => {
    // The original bug report:
    //   "Cada ejecución vuelve a leer los últimos 15 minutos y notifica
    //    todos los hallazgos, sin registrar cuáles ya envió."
    // Pin the fix: 5 ticks at 60s intervals within a 5-min cooldown →
    // exactly one send (the lookback window of 15 min is wider than the
    // 5-min cooldown, so the spam IS bounded by the cooldown).
    const send = vi.fn().mockResolvedValue({ ok: true });
    const parts = {
      ...baseParts,
      kind: 'security.batch',
      sourceIp: null as string | null,
      severity: 'mixed',
      title: 'FTTH-Copilot SOC — 1 hallazgo',
    };
    const cooldown = 5 * 60 * 1000;
    let sent = 0;
    for (let i = 0; i < 5; i++) {
      const r = await notifyOnce(cache, parts, cooldown, send, 1000 + i * 60 * 1000);
      if (r.sent) sent += 1;
    }
    // Tick 0: sent. Ticks 1-4: inside cooldown (60s, 120s, 180s, 240s
    // — all < 5 min), skipped.
    expect(sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
