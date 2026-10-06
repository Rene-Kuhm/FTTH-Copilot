import dgram from 'node:dgram';
import {
  parseSyslogMessage,
  classifyEvent,
  truncateSyslogMessage,
  createRateWindowCounter,
  extractSourceIpFromMessage,
} from '@ftth-copilot/security';
import { runSecurityDetection } from '@ftth-copilot/soc';
import { spoolEvent, recordDroppedEvent, startEventDrainer } from './event-ingest';
import {
  recordError as recordSchedulerError,
  recordSuccess as recordSchedulerSuccess,
  markExpected as markSchedulerExpected,
  markNotExpected as markSchedulerNotExpected,
  recordSyslogBound,
} from './scheduler-health';

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function telegramConfig() {
  const botToken = process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = process.env['TELEGRAM_CHAT_ID'];
  return botToken && chatId ? { botToken, chatId } : undefined;
}

/**
 * Starts a UDP syslog receiver plus a periodic SOC detection pass. Disabled
 * unless SYSLOG_RECEIVER_ENABLED=true and SYSLOG_TENANT_ID is set, so dev,
 * preview and test instances never bind a socket.
 */
export function startSyslogReceiver(): () => void {
  const tenantId = process.env['SYSLOG_TENANT_ID'];
  if (!tenantId || process.env['SYSLOG_RECEIVER_ENABLED'] !== 'true') {
    markSchedulerNotExpected('syslog');
    markSchedulerNotExpected('syslog-detection');
    recordSyslogBound(false);
    return () => {};
  }
  markSchedulerExpected('syslog');
  markSchedulerExpected('syslog-detection');
  recordSyslogBound(false);

  const port = positiveInt(process.env['SYSLOG_UDP_PORT'], 5514);
  const socket = dgram.createSocket('udp4');

  // UDP has no flow control: when the kernel receive buffer fills, it silently
  // drops datagrams with no error and no event. A burst (a link flap produces
  // thousands of messages) has to be absorbed before anything else, so the
  // buffer is enlarged before binding.
  const recvBufferBytes = positiveInt(
    process.env['SYSLOG_RECV_BUFFER_BYTES'],
    4 * 1024 * 1024,
  );
  try {
    socket.setRecvBufferSize(recvBufferBytes);
  } catch (err) {
    // Not fatal: the default buffer still works, just with less headroom.
    const detail = err instanceof Error ? err.message : String(err);
    recordSchedulerError('syslog', `could not enlarge recv buffer: ${detail}`);
  }

  // Bound message size and ingest rate so a flood of UDP datagrams cannot
  // bloat the events table or exhaust the database connection pool.
  const maxMessageLength = positiveInt(process.env['SYSLOG_MAX_MESSAGE_LENGTH'], 2000);
  const rateCounter = createRateWindowCounter({
    maxEvents: positiveInt(process.env['SYSLOG_MAX_EVENTS_PER_MINUTE'], 1000),
    windowMs: 60 * 1000,
  });

  socket.on('message', (msg, rinfo) => {
    const parsed = parseSyslogMessage(msg.toString('utf8'));
    if (!parsed) return;
    if (!rateCounter.allow(Date.now())) {
      // Rate limiting protects the database, but a dropped event is still a
      // lost event. Count it so the loss is visible in /api/health instead of
      // silent.
      recordDroppedEvent();
      return;
    }
    const message = truncateSyslogMessage(
      `${parsed.tag ? `${parsed.tag}: ` : ''}${parsed.message}`.trim(),
      maxMessageLength,
    );
    // The previous implementation stored `parsed.hostname` as the
    // event sourceIp, which silently merged attacks from distinct
    // remote IPs into a single source whenever the syslog sender
    // was a router forwarding logs for many internal hosts. Extract
    // the IP from the message body instead, and fall back to the
    // UDP source address only when the message has no IP literal.
    const sourceIp = extractSourceIpFromMessage(parsed.message, rinfo.address);

    // Durable enqueue, not a database write. A failed write now delays
    // persistence instead of discarding the datagram, which is already gone
    // from the network by the time we get here.
    try {
      spoolEvent({
        tenantId,
        sourceIp,
        facility: parsed.facility,
        severity: parsed.severity,
        category: classifyEvent(parsed),
        message,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      recordSchedulerError('syslog', `spool write failed: ${detail}`);
    }
  });

  // The previous implementation swallowed socket errors with
  // `socket.on('error', () => {})`. The bug-report quote:
  //   "el puerto syslog puede estar ocupado y el error no queda
  //    informado".
  // We still swallow the error to keep the listener alive, but we
  // surface it via the health registry and emit a warn to logs.
  socket.on('error', (err: Error) => {
    console.warn('[syslog] socket error', { error: err.message });
    recordSchedulerError('syslog', `socket error: ${err.message}`);
    recordSyslogBound(false);
  });
  socket.bind(port, () => {
    recordSyslogBound(true);
    startEventDrainer();
  });

  const intervalMs = positiveInt(process.env['SYSLOG_DETECTION_INTERVAL_MS'], 60 * 1000);
  const timer = setInterval(() => {
    runSecurityDetection({
      tenantId,
      webhookUrl: process.env['ALERT_WEBHOOK_URL'],
      telegram: telegramConfig(),
    })
      .then(() => recordSchedulerSuccess('syslog-detection'))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        recordSchedulerError('syslog-detection', msg);
      });
  }, intervalMs);

  return () => {
    clearInterval(timer);
    recordSyslogBound(false);
    socket.close();
  };
}
