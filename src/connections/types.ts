import { z } from 'zod';
import type { SecurityIndicator, ApiSearchFilter } from '../models/types';

/** Optional connection name, description, and filter summary for Metadata and Report embeds. */
export interface ConnectionDisplay {
  /** Connection name (e.g. metadata card footer). Optional when only jobName is needed for exec summary. */
  name?: string;
  description?: string;
  /** Human-readable filter summary (e.g. from formatFiltersUsed). Shown on metadata card footers only — not duplicated on exec summary (filters appear once as **Filters:**). */
  filterSummary?: string;
  /** Scheduled job name when the report is run from `config/jobs.json`; shown on exec summary header. */
  jobName?: string;
}

/** Truss API query stored on a connection (filter + window or config name). */
export const ConnectionQueryFieldsSchema = z.object({
  configName: z.string().optional(),
  filter: z
    .record(z.union([z.string(), z.array(z.string()), z.number()]))
    .optional(),
  windowDays: z.number().int().positive().optional(),
  windowMinutes: z.number().int().positive().optional(),
});

export const ConnectionQuerySchema = ConnectionQueryFieldsSchema.optional();

export type ConnectionQuery = z.infer<typeof ConnectionQueryFieldsSchema>;

/** Base shape shared by all connection types (name, type, description, enabled, query). */
export interface ConnectionBase {
  name: string;
  type: string;
  description?: string;
  enabled: boolean;
  query?: ConnectionQuery;
}

/**
 * Interface implemented by each connection module (Discord, Slack, MS Teams, etc.).
 * Register with the connection registry so the CLI and query-manager can create, modify, and send without per-type branching.
 */
export interface IConnectionModule<TConnection extends ConnectionBase> {
  readonly typeId: string;
  readonly label: string;
  readonly schema: z.ZodType<TConnection>;

  getWebhookUrl(connection: TConnection): string;

  /** getConnections is provided by the caller so modules can validate (e.g. unique name) without circular imports. */
  promptCreate(getConnections: () => unknown[]): Promise<TConnection>;
  promptModify(existing: TConnection): Promise<TConnection>;

  sendText(webhookUrl: string, text: string): Promise<void>;
  sendReport(
    webhookUrl: string,
    indicators: SecurityIndicator[],
    connectionDisplay?: ConnectionDisplay | null
  ): Promise<void>;
  sendExecSummary(
    webhookUrl: string,
    indicators: SecurityIndicator[],
    filter?: ApiSearchFilter,
    connectionDisplay?: ConnectionDisplay | null
  ): Promise<void>;

  /** Optional: return Truss API config name if this connection uses one (for Test Truss API flow). */
  getConfigName?(connection: TConnection): string | undefined;
}
