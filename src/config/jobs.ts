import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { ApiSearchFilter } from '../models/types';

const ProductSearchOrderBySchema = z.enum(['pub_date', 'downloads', 'rating', 'timestamp']);

export const OutputFormatSchema = z.enum(['ioc', 'metadata', 'report']);
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

/** Schedule: cron expression (e.g. every 6 hours) or interval in minutes (number). */
export const JobScheduleSchema = z.union([
  z.string().min(1),
  z.number().int().positive(),
]);
export type JobSchedule = z.infer<typeof JobScheduleSchema>;

export const ApiSearchFilterSchema: z.ZodType<ApiSearchFilter> = z.object({
  filterExpression: z.string().optional(),
  days: z.number().int().nonnegative().optional(),
  order_by: ProductSearchOrderBySchema.optional(),
  order_direction: z.enum(['asc', 'desc']).optional(),
  startDate: z.union([z.number(), z.string()]).optional(),
  endDate: z.union([z.number(), z.string()]).optional(),
  category: z.array(z.string()).optional(),
  source: z.array(z.string()).optional(),
  author: z.array(z.string()).optional(),
  industry: z.array(z.string()).optional(),
  region: z.array(z.string()).optional(),
  reference: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  indicators: z.array(z.string()).optional(),
});

export const JobSchema = z
  .object({
    /** Unique name for this job (for logging and CLI). */
    name: z.string().min(1),
    /** If set, fetch filter and interval from Truss API via getAgentData(apiKey, configName). */
    configName: z.string().optional(),
    /** Local ApiSearchFilter when not using configName. */
    filter: ApiSearchFilterSchema.optional(),
    /** When set with filter, startDate is computed at run time as now minus this many days. */
    windowDays: z.number().int().positive().optional(),
    /** When set with filter, startDate is computed at run time as now minus this many minutes (overrides windowDays for cron jobs). */
    windowMinutes: z.number().int().positive().optional(),
    /** Cron expression or interval in minutes (number). For interval jobs, query window = schedule to avoid duplicates. */
    schedule: JobScheduleSchema,
    /** Named connection from config/connections.json (takes precedence over discordWebhookUrl). */
    connectionName: z.string().optional(),
    /** Discord webhook URL (each webhook = one channel). Used when connectionName is not set. */
    discordWebhookUrl: z.string().url().optional(),
    /** Output format: IOCs only, metadata (awareness) embeds, or report (exec summary text/embed). */
    outputFormat: OutputFormatSchema,
  })
  .refine((data) => data.connectionName != null || data.discordWebhookUrl != null, {
    message: 'Job must have either connectionName or discordWebhookUrl',
    path: ['connectionName'],
  });
export type Job = z.infer<typeof JobSchema>;

export const JobsFileSchema = z.object({
  /** When >= 2, `outputFormat` values are `ioc` | `metadata` | `report` (no legacy remap on load). */
  formatVersion: z.number().optional(),
  jobs: z.array(JobSchema),
});

export type JobsFile = z.infer<typeof JobsFileSchema>;

/** Remap legacy v1 `outputFormat` before validation. See README / formatVersion on jobs file. */
function migrateJobsFilePayload(data: unknown): unknown {
  if (data == null || typeof data !== 'object') return data;
  const o = data as Record<string, unknown>;
  const version = typeof o.formatVersion === 'number' ? o.formatVersion : 1;
  const rawJobs = Array.isArray(o.jobs)
    ? o.jobs
    : Array.isArray(data)
      ? (data as unknown[])
      : [];
  if (version >= 2) {
    return Array.isArray(data) ? { jobs: rawJobs } : { ...o, jobs: rawJobs };
  }
  const migratedJobs = rawJobs.map((j) => {
    if (j == null || typeof j !== 'object') return j;
    const job = { ...(j as Record<string, unknown>) };
    const of = job.outputFormat;
    if (of === 'summary') job.outputFormat = 'report';
    else if (of === 'report') job.outputFormat = 'metadata';
    return job;
  });
  if (Array.isArray(data)) {
    return { formatVersion: 2, jobs: migratedJobs };
  }
  return { ...o, formatVersion: 2, jobs: migratedJobs };
}

/**
 * Load jobs from configured file path or from JOBS_JSON env.
 * File can be .json. Path is relative to cwd unless absolute.
 */
export function loadJobs(jobsFilePath: string | undefined, jobsJsonEnv?: string): Job[] {
  if (jobsJsonEnv && jobsJsonEnv.trim()) {
    try {
      const parsed = JSON.parse(jobsJsonEnv) as unknown;
      const result = Array.isArray(parsed) ? { jobs: parsed } : parsed;
      const migrated = migrateJobsFilePayload(result);
      const validated = JobsFileSchema.parse(migrated);
      logger.info({ count: validated.jobs.length }, 'Loaded jobs from JOBS_JSON');
      return validated.jobs;
    } catch (err) {
      logger.error({ err }, 'Invalid JOBS_JSON');
      throw err;
    }
  }

  if (!jobsFilePath || !jobsFilePath.trim()) {
    logger.warn('No JOBS_FILE or JOBS_JSON set; no jobs to run');
    return [];
  }

  const resolved = path.isAbsolute(jobsFilePath)
    ? jobsFilePath
    : path.resolve(process.cwd(), jobsFilePath);

  if (!fs.existsSync(resolved)) {
    logger.warn({ path: resolved }, 'Jobs file not found');
    return [];
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  const data = JSON.parse(raw) as unknown;
  const result = Array.isArray(data) ? { jobs: data } : data;
  const migrated = migrateJobsFilePayload(result);
  const validated = JobsFileSchema.parse(migrated);
  logger.info({ path: resolved, count: validated.jobs.length }, 'Loaded jobs from file');
  return validated.jobs;
}

/**
 * Save jobs to the configured file path. Creates directory if needed.
 * Use when adding or updating jobs from the config CLI.
 */
export function saveJobs(jobsFilePath: string | undefined, jobs: Job[]): void {
  if (!jobsFilePath || !jobsFilePath.trim()) {
    throw new Error('JOBS_FILE is not set; cannot save jobs');
  }
  const resolved = path.isAbsolute(jobsFilePath)
    ? jobsFilePath
    : path.resolve(process.cwd(), jobsFilePath);
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = JSON.stringify({ formatVersion: 2, jobs }, null, 2);
  fs.writeFileSync(resolved, content, 'utf-8');
  logger.debug({ path: resolved, count: jobs.length }, 'Saved jobs');
}
