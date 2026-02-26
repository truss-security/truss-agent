import cron from 'node-cron';
import config from '../config/config';
import { loadJobs, type Job } from '../config/jobs';
import {
  loadConnections,
  getConnectionByName,
  getWebhookUrlForConnection,
  isConnectionEnabled,
  buildFilterFromConnectionQuery,
} from '../config/connections';
import { logger } from '../utils/logger';
<<<<<<< Updated upstream
=======
import { sanitizeErrorForLog } from '../utils/sanitize-error';
import { formatFiltersUsed } from '../formatters/exec-summary-formatter';
>>>>>>> Stashed changes
import TrussApi, { type AgentData } from '../adapters/input/truss-api';
import { sendTextToDiscord, sendReportToDiscord, sendExecSummaryToDiscord } from '../adapters/output/discord';
import { formatIndicatorsAsIoc } from '../formatters/ioc-formatter';
import { ApiSearchFilter } from '../models/types';

const DEFAULT_WINDOW_MINUTES = 24 * 60;

export class QueryManager {
  private trussApi: TrussApi;
  private jobs: Job[] = [];
  private intervalHandles: ReturnType<typeof setInterval>[] = [];

  constructor() {
    this.trussApi = new TrussApi();
  }

  load(): Job[] {
    const jobsFile = config.get('jobs.jobsFile') as string;
    const jobsJson = config.get('jobs.jobsJson') as string | undefined;
    this.jobs = loadJobs(jobsFile, jobsJson);
    return this.jobs;
  }

  start(): void {
    if (this.jobs.length === 0) {
      logger.warn('No jobs loaded; scheduler not started');
      return;
    }
    const apiKey = config.get('indicators.apiKey') as string;
    if (!apiKey) {
      logger.error('TRUSS_API_KEY is not set; cannot run jobs');
      return;
    }

    for (const job of this.jobs) {
      const schedule = job.schedule;
      if (typeof schedule === 'number') {
        const ms = schedule * 60 * 1000;
        const handle = setInterval(() => this.runJob(job), ms);
        this.intervalHandles.push(handle);
        logger.info({ job: job.name, intervalMinutes: schedule }, 'Scheduled job (interval)');
      } else if (typeof schedule === 'string' && schedule.trim()) {
        const valid = cron.validate(schedule);
        if (!valid) {
          logger.warn({ job: job.name, schedule }, 'Invalid cron expression; skipping');
          continue;
        }
        cron.schedule(schedule, () => this.runJob(job));
        logger.info({ job: job.name, cron: schedule }, 'Scheduled job (cron)');
      }
    }
  }

  stop(): void {
    for (const handle of this.intervalHandles) {
      clearInterval(handle);
    }
    this.intervalHandles = [];
  }

  /** Run all jobs once (e.g. for `sync` CLI). */
  async runAllOnce(): Promise<void> {
    for (const job of this.jobs) {
      await this.runJob(job);
    }
  }

  /** Run a single job by name. */
  async runJobByName(name: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) {
      logger.warn({ name }, 'Job not found');
      return false;
    }
    await this.runJob(job);
    return true;
  }

  async runJob(job: Job): Promise<void> {
    const apiKey = config.get('indicators.apiKey') as string;
    if (!apiKey) {
      logger.error('TRUSS_API_KEY is not set');
      return;
    }

    if (job.connectionName) {
      const connectionsPath = config.get('connections.connectionsFile') as string;
      const connections = loadConnections(connectionsPath);
      const conn = getConnectionByName(connections, job.connectionName);
      if (conn && !isConnectionEnabled(conn)) {
        logger.info({ job: job.name, connectionName: job.connectionName }, 'Connection is disabled; skipping job (no pull, no send)');
        return;
      }
    }

    try {
      logger.info({ job: job.name }, 'Running job');
      const filter = await this.resolveFilter(job, apiKey);
      const indicators = await this.trussApi.searchIndicators(filter);
      logger.info({ job: job.name, count: indicators.length }, 'Fetched indicators');

      if (indicators.length === 0) {
        logger.info({ job: job.name }, 'No indicators to post');
        return;
      }

      const webhookUrl = this.resolveWebhookUrl(job);
      if (!webhookUrl) {
        logger.error(
          { job: job.name },
          'Job has no destination: set connectionName or discordWebhookUrl'
        );
        return;
      }

      if (job.outputFormat === 'ioc') {
        const text = formatIndicatorsAsIoc(indicators);
        if (!text.trim()) {
          logger.info({ job: job.name }, 'Formatter produced empty output');
          return;
        }
        await sendTextToDiscord(webhookUrl, text);
      } else if (job.outputFormat === 'summary') {
        await sendExecSummaryToDiscord(webhookUrl, indicators, filter);
      } else {
        await sendReportToDiscord(webhookUrl, indicators);
      }
      logger.info({ job: job.name }, 'Posted to Discord');
    } catch (err) {
      logger.error({ ...sanitizeErrorForLog(err), job: job.name }, 'Job failed');
    }
  }

  private resolveWebhookUrl(job: Job): string | undefined {
    if (job.connectionName) {
      const connectionsPath = config.get('connections.connectionsFile') as string;
      const connections = loadConnections(connectionsPath);
      const conn = getConnectionByName(connections, job.connectionName);
      if (!conn) {
        logger.warn({ connectionName: job.connectionName }, 'Connection not found');
        return undefined;
      }
      if (!isConnectionEnabled(conn)) {
        logger.warn({ connectionName: job.connectionName }, 'Connection is disabled; skipping');
        return undefined;
      }
      return getWebhookUrlForConnection(conn);
    }
    return job.discordWebhookUrl;
  }

  private async resolveFilter(job: Job, apiKey: string): Promise<ApiSearchFilter> {
    const now = new Date();
    const endDateIso = now.toISOString();

    if (job.configName) {
      const agentData: AgentData = await this.trussApi.getAgentData(apiKey, job.configName);
      const windowMs =
        agentData.runIntervalMinutes > 0
          ? agentData.runIntervalMinutes * 60 * 1000
          : DEFAULT_WINDOW_MINUTES * 60 * 1000;
      const startDate = new Date(Date.now() - windowMs).toISOString();
      return {
        ...agentData.filter,
        startDate,
        endDate: endDateIso,
      };
    }

    const hasJobFilter = job.filter && Object.keys(job.filter).length > 0;
    if (!hasJobFilter && job.connectionName) {
      const connectionsPath = config.get('connections.connectionsFile') as string;
      const connections = loadConnections(connectionsPath);
      const conn = getConnectionByName(connections, job.connectionName);
      if (conn) {
        const connWithQuery = conn as {
          query?: {
            configName?: string;
            filter?: Record<string, unknown>;
            windowDays?: number;
            windowMinutes?: number;
          };
        };
        if (connWithQuery.query?.configName) {
          const agentData: AgentData = await this.trussApi.getAgentData(apiKey, connWithQuery.query.configName);
          const windowMs =
            agentData.runIntervalMinutes > 0
              ? agentData.runIntervalMinutes * 60 * 1000
              : this.getQueryWindowMs(job);
          const startDate = new Date(Date.now() - windowMs).toISOString();
          return {
            ...agentData.filter,
            startDate,
            endDate: endDateIso,
          };
        }
        const built = buildFilterFromConnectionQuery(conn, endDateIso, this.getQueryWindowMs(job));
        if (built) {
          return {
            ...built.rest,
            startDate: built.startDate,
            endDate: built.endDate,
          } as ApiSearchFilter;
        }
      }
    }

    const filter = job.filter ?? {};
    const windowMs = this.getQueryWindowMs(job);
    const startDate = new Date(Date.now() - windowMs).toISOString();
    return {
      ...filter,
      startDate,
      endDate: endDateIso,
    };
  }

  /** Query window = run interval when schedule is in minutes (avoids duplicates). */
  private getQueryWindowMs(job: Job): number {
    if (typeof job.schedule === 'number') {
      return job.schedule * 60 * 1000;
    }
    if (job.windowMinutes != null) {
      return job.windowMinutes * 60 * 1000;
    }
    if (job.windowDays != null) {
      return job.windowDays * 24 * 60 * 60 * 1000;
    }
    return DEFAULT_WINDOW_MINUTES * 60 * 1000;
  }
}
