import dgram from 'node:dgram';
import { createLogger } from '@ftth-copilot/shared';
import {
  parseSyslogMessage,
  classifyEvent,
  truncateSyslogMessage,
  createRateWindowCounter,
  extractSourceIpFromMessage,
} from '@ftth-copilot/security';
import { runSecurityDetection } from '@ftth-copilot/soc';
import { spoolEvent, recordDroppedEvent } from './ingest';
import {
  recordError as recordSchedulerError,
  recordSuccess as recordSchedulerSuccess,
  markExpected as markSchedulerExpected,
  markNotExpected as markSchedulerNotExpected,
  recordSyslogBound,
  setNextRun,
} from '@ftth-copilot/scheduler';

const log = createLogger({ name: 'syslog' });

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
 * Options of the syslog receiver.
 */
export interface SyslogReceiverOptions {
  /**
   * Called for every event that reached the durable spool, with the
   * `ingestId` the spool assigned to it (`null` when the spool refused the
   * record).
   *
   * The callback fires only after the event is durably on disk: the caller
   * can ask for a drain of an event that is already there. The web passes no
   * callback, so its behaviour is unchanged.
   */
  onEventSpooled?: (ingestId: string | null) => void;
}

/**
 * Starts a UDP syslog receiver plus a periodic SOC detection pass. Disabled
 * unless SYSLOG_RECEIVER_ENABLED=true and SYSLOG_TENANT_ID is set, so dev,
 * preview and test instances never bind a socket.
 */
export function startSyslogReceiver(options: SyslogReceiverOptions = {}): () => void {
  const tenantId = process.env['SYSLOG_TENANT_ID'];
  if (!tenantId || process.env['SYSLOG_RECEIVER_ENABLED'] !== 'true') {
    markSchedulerNotExpected('syslog');
    markSchedulerNotExpected('syslog-detection');
    recordSyslogBound(false);
    return () => {};
  }
  markSchedulerExpected('syslog');
  // The detection pass is a loop, not a socket: it has a tick and a cadence,
  // so the registry needs its deadline. Without it, a worker that just booted
  // reported the loop as hung until the first pass — and the system degraded
  // on every restart. The deadline says "it is warming up", and only a pass
  // that does not arrive turns it into a hung loop.
  const detectionIntervalMs = positiveInt(
    process.env['SYSLOG_DETECTION_INTERVAL_MS'],
    60 * 1000,
  );
  markSchedulerExpected('syslog-detection', {
    intervalMs: detectionIntervalMs,
    nextRunAt: Date.now() + detectionIntervalMs,
  });
  recordSyslogBound(false);

  const port = positiveInt(process.env['SYSLOG_UDP_PORT'], 5514);
  const socket = dgram.createSocket('udp4');

  // UDP has no flow control: when the kernel receive buffer fills, it silently
  // drops datagrams with no error and no event. A burst (a link flap produces
  // thousands of messages) has to be absorbed before anything else.
  //
  // The buffer is enlarged **after** the bind, not before: the size of the
  // buffer is a property of the socket, and a socket that is not bound yet
  // has no file descriptor to set it on. `setRecvBufferSize()` before the
  // bind fails with EBADF, and the socket keeps the small default buffer —
  // exactly the one that drops the datagrams of a burst.
  const recvBufferBytes = positiveInt(
    process.env['SYSLOG_RECV_BUFFER_BYTES'],
    4 * 1024 * 1024,
  );

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
      const ingestId = spoolEvent({
        tenantId,
        sourceIp,
        facility: parsed.facility,
        severity: parsed.severity,
        category: classifyEvent(parsed),
        message,
      });
      // The event is on disk now: only now can the caller drain it.
      options.onEventSpooled?.(ingestId);
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
    log.warn('Socket error', { error: err });
    recordSchedulerError('syslog', `socket error: ${err.message}`);
    recordSyslogBound(false);
  });
  socket.bind(port, () => {
    // Now that the socket has a file descriptor, the receive buffer can be
    // enlarged. Not fatal if it fails: the default buffer still works, just
    // with less headroom.
    try {
      socket.setRecvBufferSize(recvBufferBytes);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      recordSchedulerError('syslog', `could not enlarge recv buffer: ${detail}`);
    }
    recordSyslogBound(true);
  });

  const intervalMs = detectionIntervalMs;
  log.info('Syslog detection scheduled', { everyMs: intervalMs, tenantId });
  const timer = setInterval(() => {
    log.debug('Syslog detection pass started', { tenantId });
    runSecurityDetection({
      tenantId,
      webhookUrl: process.env['ALERT_WEBHOOK_URL'],
      telegram: telegramConfig(),
    })
      .then(() => {
        recordSchedulerSuccess('syslog-detection');
        // The pass happened: the next one is due in an interval.
        setNextRun('syslog-detection', Date.now() + intervalMs);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        recordSchedulerError('syslog-detection', msg);
        // The pass failed, but the loop is alive: it tries again in an
        // interval. The error is in the health; the deadline keeps the loop
        // from being reported as hung on top of it.
        setNextRun('syslog-detection', Date.now() + intervalMs);
      });
  }, intervalMs);

  return () => {
    clearInterval(timer);
    recordSyslogBound(false);
    socket.close();
  };
}
