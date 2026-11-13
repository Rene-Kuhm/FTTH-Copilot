/**
 * Next.js server instrumentation — runs once when the Node.js server starts.
 *
 * The worker (`services/worker`) owns the background work: the proactive
 * metrics poller, the firmware audit loop, the FEC collection loop, the
 * syslog (SOC) receiver, the SNMP trap receiver and the event drainer. The
 * web serves HTTP and the SSE stream, and nothing else.
 *
 * This process does not even import those modules. A web that imported the
 * in-process scheduler would be one refactor away from running two copies of
 * every loop, and the second copy would fail silently — the kernel hands a
 * datagram to one socket, and the tick would happen twice. Instead the
 * instrumentation marks the loops and the receivers as "not expected" here,
 * so /api/health stays honest about what this container is responsible for.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // The SSRF policy has no exceptions in production. The web refuses to
    // start with them activadas: en producción, una excepción es un agujero
    // hacia la red interna.
    const { assertNoSsrfExceptionsInProduction } = await import('@ftth-copilot/connectors-core');
    assertNoSsrfExceptionsInProduction(process.env);

    // The flag no longer chooses between two paths: the worker is the only
    // owner of the background work. An environment that still asks for
    // `embedded` is one that was never migrated, and it would keep serving
    // HTTP while nobody polls anything — a silent failure, of the kind that
    // surfaces weeks later. The web refuses to start instead.
    const { assertWorkerBackendMode } = await import('@ftth-copilot/jobs');
    assertWorkerBackendMode();

    const { assertValidOidcConfig } = await import('@/lib/auth/oidc');
    assertValidOidcConfig(process.env);

    const { createLogger } = await import('@ftth-copilot/shared');
    const log = createLogger({ name: 'instrumentation' });

    // The loops run in the worker. Marking them as "not expected" keeps
    // /api/health honest: this process is not supposed to run them, so
    // they must not be reported as hung loops here.
    const { markNotExpected } = await import('@/lib/monitoring/scheduler-health');
    markNotExpected('polling');
    markNotExpected('firmware');
    markNotExpected('fec');

    // The syslog receiver binds a UDP port and the worker owns it. The web
    // must not bind it: the kernel delivers a datagram to one socket only,
    // so the second one would wait forever for messages that never arrive.
    markNotExpected('syslog');
    markNotExpected('syslog-detection');

    // The SNMP receiver binds another UDP port and drains the spool in
    // process. Same reason: one socket, one owner.
    markNotExpected('snmp');

    log.info('Background loops and receivers run in the worker', { backendMode: 'worker' });
  }
}
