import dgram from 'node:dgram';
import { parseSyslogMessage, classifyEvent } from '@ftth-copilot/security';
import { ingestEvent, runSecurityDetection } from '@ftth-copilot/soc';

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
  if (!tenantId || process.env['SYSLOG_RECEIVER_ENABLED'] !== 'true') return () => {};

  const port = positiveInt(process.env['SYSLOG_UDP_PORT'], 5514);
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const parsed = parseSyslogMessage(msg.toString('utf8'));
    if (!parsed) return;
    ingestEvent({
      tenantId,
      sourceIp: parsed.hostname ?? rinfo.address,
      facility: parsed.facility,
      severity: parsed.severity,
      category: classifyEvent(parsed),
      message: `${parsed.tag ? `${parsed.tag}: ` : ''}${parsed.message}`.trim(),
    }).catch(() => {});
  });

  socket.on('error', () => {});
  socket.bind(port);

  const intervalMs = positiveInt(process.env['SYSLOG_DETECTION_INTERVAL_MS'], 60 * 1000);
  const timer = setInterval(() => {
    runSecurityDetection({
      tenantId,
      webhookUrl: process.env['ALERT_WEBHOOK_URL'],
      telegram: telegramConfig(),
    }).catch(() => {});
  }, intervalMs);

  return () => {
    clearInterval(timer);
    socket.close();
  };
}
