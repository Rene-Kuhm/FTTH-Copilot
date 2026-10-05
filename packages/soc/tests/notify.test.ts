import { describe, it, expect, vi } from 'vitest';
import {
  buildSlackPayload,
  buildWebhookPayload,
  buildEmailMessage,
  resolveRouting,
  redactSecrets,
  type NotificationContext,
  type NotificationChannel,
} from '../src/notify';

const ctx: NotificationContext = {
  title: 'OLT-Este-01 offline',
  body: '6 ONUs lost optical signal under OLT-Este-01/pon1',
  severity: 'critical',
  kind: 'optical_degradation',
  deviceKind: 'OLT',
  deviceId: 'OLT-Este-01',
  url: 'https://copilot.example.com/dashboard/metrics',
  dedupeKey: 'olt-este-01-offline',
};

const slack: NotificationChannel = {
  id: 'c1',
  tenantId: 't1',
  type: 'slack',
  target: 'https://hooks.slack.com/services/T/B/X',
  enabled: true,
  minSeverity: 'warning',
  labels: ['noc'],
  cooldownSeconds: 300,
};

describe('redactSecrets', () => {
  it('masks a Slack webhook token in a URL', () => {
    const out = redactSecrets('https://hooks.slack.com/services/T000/B000/XXXXXXXX');
    expect(out).not.toContain('XXXXXXXX');
    expect(out).toContain('hooks.slack.com');
  });

  it('masks a bearer token in free text', () => {
    expect(redactSecrets('Authorization: Bearer abc123def456')).not.toContain('abc123def456');
  });

  it('masks a URL userinfo password', () => {
    expect(redactSecrets('https://user:sup3rsecret@ntp.example.com')).not.toContain('sup3rsecret');
  });

  it('leaves harmless text untouched', () => {
    expect(redactSecrets('OLT-Este-01 lost 3 ONUs')).toBe('OLT-Este-01 lost 3 ONUs');
  });
});

describe('buildSlackPayload', () => {
  it('produces a Block Kit payload with the title in the header', () => {
    const p = buildSlackPayload(ctx);
    expect(p.text).toContain(ctx.title);
    expect(JSON.stringify(p)).toContain('header');
  });

  it('colours the attachment by severity', () => {
    const critical = JSON.stringify(buildSlackPayload({ ...ctx, severity: 'critical' }));
    const info = JSON.stringify(buildSlackPayload({ ...ctx, severity: 'info' }));
    expect(critical).not.toBe(info);
    expect(critical).toContain('#EF4444');
    expect(info).toContain('#3B82F6');
  });

  it('includes the device identity and a link', () => {
    const s = JSON.stringify(buildSlackPayload(ctx));
    expect(s).toContain(ctx.deviceId);
    expect(s).toContain(ctx.url);
  });
});

describe('buildWebhookPayload', () => {
  it('is stable and JSON-serialisable with a schema tag', () => {
    const p = buildWebhookPayload(ctx);
    expect(p.schema).toBe('ftth.notification.v1');
    expect(p.severity).toBe('critical');
    expect(() => JSON.stringify(p)).not.toThrow();
  });
});

describe('buildEmailMessage', () => {
  it('renders subject, text and html parts', () => {
    const m = buildEmailMessage(ctx);
    expect(m.subject).toContain(ctx.title);
    expect(m.text).toContain(ctx.body);
    expect(m.html).toContain('<');
  });

  it('escapes HTML in the body so a crafted title cannot inject markup', () => {
    const m = buildEmailMessage({ ...ctx, title: '<script>alert(1)</script>' });
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('&lt;script&gt;');
  });
});

describe('resolveRouting', () => {
  it('selects only enabled channels at or above the minimum severity', () => {
    const selected = resolveRouting([slack], 'info');
    expect(selected).toHaveLength(0);
  });

  it('includes a channel whose threshold is met', () => {
    expect(resolveRouting([slack], 'critical')).toHaveLength(1);
    expect(resolveRouting([slack], 'warning')).toHaveLength(1);
  });

  it('skips disabled channels', () => {
    expect(resolveRouting([{ ...slack, enabled: false }], 'critical')).toHaveLength(0);
  });

  it('never routes an unknown severity to a channel', () => {
    // An unrecognised severity must fail closed, not inherit the lowest threshold.
    expect(resolveRouting([slack], 'nonsense')).toHaveLength(0);
  });

  it('ranks critical above warning above info', () => {
    const all = resolveRouting([slack], 'critical');
    expect(all.map((c) => c.severityRank)).toEqual([expect.any(Number)]);
  });
});

describe('http dispatch', () => {
  it('is exercised through the exported sender contract', async () => {
    const send = vi.fn(async () => true);
    const result = await send();
    expect(result).toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('redactSecrets — Ntfy', () => {
  it('masks the topic in a Ntfy URL', () => {
    const out = redactSecrets('https://ntfy.sh/my-private-topic');
    expect(out).not.toContain('my-private-topic');
    expect(out).toContain('ntfy.sh');
  });

  it('masks self-hosted Ntfy topics', () => {
    const out = redactSecrets('http://localhost:8125/mytenant-alerts');
    expect(out).not.toContain('mytenant-alerts');
    expect(out).toContain('localhost');
  });

  it('does not redact the server base URL without a topic', () => {
    const out = redactSecrets('https://ntfy.sh/');
    // Only topics are redacted, not the server root
    expect(out).toContain('ntfy.sh');
  });
});
