/**
 * `@ftth-copilot/connectors-factory` — the tenant-aware connector factory.
 *
 * The factory used to live inside the Next.js app (`apps/web/lib/connectors/chat-client.ts`),
 * which made it unreachable for the background worker. It is a package now, so
 * the web and the worker build their connectors the same way.
 */

export {
  buildConnectorFromConnection,
  ConnectorResolutionError,
  type ConnectorDataSource,
  type ResolvedConnector,
} from './connector-factory';
