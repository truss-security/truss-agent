import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import {
  type Connection,
  ConnectionSchema,
  getWebhookUrl,
} from '../connections';

export const ConnectionsFileSchema = z.object({
  connections: z.array(ConnectionSchema),
});
export type ConnectionsFile = z.infer<typeof ConnectionsFileSchema>;

/**
 * Whether the connection is enabled (jobs will use it). Disabled connections are skipped when resolving webhooks.
 */
export function isConnectionEnabled(connection: Connection): boolean {
  return connection.enabled === true;
}

/**
 * Return the webhook URL for a connection. Delegates to the connection registry.
 */
export function getWebhookUrlForConnection(connection: Connection): string {
  return getWebhookUrl(connection);
}

/**
 * Load connections from the configured file path.
 */
export function loadConnections(connectionsFilePath: string | undefined): Connection[] {
  if (!connectionsFilePath || !connectionsFilePath.trim()) {
    return [];
  }
  const resolved = path.isAbsolute(connectionsFilePath)
    ? connectionsFilePath
    : path.resolve(process.cwd(), connectionsFilePath);
  if (!fs.existsSync(resolved)) {
    logger.debug({ path: resolved }, 'Connections file not found');
    return [];
  }
  const raw = fs.readFileSync(resolved, 'utf-8');
  const data = JSON.parse(raw) as unknown;
  const result = Array.isArray(data) ? { connections: data } : data;
  const validated = ConnectionsFileSchema.parse(result);
  return validated.connections;
}

/**
 * Save connections to the configured file path. Creates directory if needed.
 */
export function saveConnections(
  connectionsFilePath: string | undefined,
  connections: Connection[]
): void {
  if (!connectionsFilePath || !connectionsFilePath.trim()) {
    throw new Error('CONNECTIONS_FILE is not set');
  }
  const resolved = path.isAbsolute(connectionsFilePath)
    ? connectionsFilePath
    : path.resolve(process.cwd(), connectionsFilePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = JSON.stringify({ connections }, null, 2);
  fs.writeFileSync(resolved, content, 'utf-8');
  logger.debug({ path: resolved, count: connections.length }, 'Saved connections');
}

/**
 * Get a connection by name from the loaded list.
 */
export function getConnectionByName(
  connections: Connection[],
  name: string
): Connection | undefined {
  return connections.find((c) => c.name === name);
}

/**
 * Build ApiSearchFilter from a connection's query (filter + date window).
 * Returns undefined if the connection has no query or only configName (caller must use getAgentData for configName).
 */
export function buildFilterFromConnectionQuery(
  connection: Connection,
  endDateIso: string,
  windowMsOverride?: number
): { startDate: string; endDate: string; rest: Record<string, unknown> } | undefined {
  const q = connection.query;
  if (!q?.filter || typeof q.filter !== 'object') return undefined;

  const windowMs =
    windowMsOverride ??
    (q.windowMinutes != null
      ? q.windowMinutes * 60 * 1000
      : (q.windowDays ?? 7) * 24 * 60 * 60 * 1000);
  const startDate = new Date(Date.now() - windowMs).toISOString();

  const rest = { ...q.filter } as Record<string, unknown>;
  delete rest.startDate;
  delete rest.endDate;

  return { startDate, endDate: endDateIso, rest };
}
