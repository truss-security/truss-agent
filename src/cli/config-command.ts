import dotenv from 'dotenv';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import inquirer from 'inquirer';
import config from '../config/config';
import {
  loadConnections,
  saveConnections,
  getConnectionByName,
  getWebhookUrlForConnection,
  isConnectionEnabled,
  buildFilterFromConnectionQuery,
} from '../config/connections';
import type { Connection, ConnectionQuery } from '../connections';
import { getConnectionTypes, getModule } from '../connections';
import { loadJobs, saveJobs, type Job, type OutputFormat } from '../config/jobs';
import {
  loadAgentConfig,
  saveAgentConfig,
  updateEnvFile,
  clearEnvFile,
  deleteAgentConfigFile,
} from '../config/agent';
import type { ApiSearchFilter } from '../models/types';
import { LEGACY_ARRAY_FILTER_KEYS } from '../adapters/input/build-product-search-payload';
import cron from 'node-cron';
import TrussApi from '../adapters/input/truss-api';
import { extractQueryFromPaste as extractTrussSearchBodyFromPaste } from '../utils/extract-query-from-paste';
import { formatIndicatorsAsIoc } from '../formatters/ioc-formatter';
import { buildExecSummary, formatFiltersUsed } from '../formatters/exec-summary-formatter';

const CONNECTIONS_FILE = config.get('connections.connectionsFile') as string;
const JOBS_FILE = config.get('jobs.jobsFile') as string;
const AGENT_FILE = config.get('agent.agentFile') as string;

const BACK_TO_MENU_VALUE = '__back__';

const SETUP_CHOICE_VALUE = 'setup';

const MAIN_MENU_CHOICES_BASE = [
  { name: 'First-Time Setup (agent name, Truss API key)', value: SETUP_CHOICE_VALUE },
  { name: 'Create New Connection', value: 'create' },
  { name: 'Test Destination Connection', value: 'test' },
  { name: 'Test Truss API → Destination', value: 'testTrussToDiscord' },
  { name: 'Enable/Disable Connection', value: 'enableDisable' },
  { name: 'List All Connections', value: 'list' },
  { name: 'Modify Existing Connection', value: 'modify' },
  { name: 'Delete Connection', value: 'delete' },
  { name: 'Reset All Configuration', value: 'reset' },
  { name: 'Build Docker Container (docker only)', value: 'buildDocker' },
  { name: 'Build and run Docker container (docker-compose)', value: 'buildRunDockerCompose' },
  { name: 'Exit', value: 'exit' },
] as const;

type MainMenuChoice = (typeof MAIN_MENU_CHOICES_BASE)[number]['value'];

function getMainMenuChoices(): { name: string; value: MainMenuChoice }[] {
  const agent = loadAgentConfig(AGENT_FILE);
  const isEstablished = agent != null && agent.agentName?.trim() !== '';
  const setupLabel = isEstablished
    ? 'Modify Agent Settings (agent name, Truss API key)'
    : 'First-Time Setup (agent name, Truss API key)';
  return [
    { name: setupLabel, value: SETUP_CHOICE_VALUE },
    ...MAIN_MENU_CHOICES_BASE.slice(1),
  ];
}

function getConnections(): Connection[] {
  return loadConnections(CONNECTIONS_FILE);
}

async function runFirstTimeSetup(): Promise<void> {
  const existing = loadAgentConfig(AGENT_FILE);
  const answers = await inquirer.prompt<{ agentName: string; apiKey: string }>([
    {
      type: 'input',
      name: 'agentName',
      message: "Agent's name:",
      default: existing?.agentName ?? '',
      validate: (input: string) => (input.trim() ? true : 'Agent name is required'),
    },
    {
      type: 'password',
      name: 'apiKey',
      message: 'Truss API key (stored in .env):',
      default: '',
      validate: (input: string) => (input.trim() ? true : 'API key is required'),
    },
  ]);
  saveAgentConfig({ agentName: answers.agentName.trim() }, AGENT_FILE);
  updateEnvFile('TRUSS_API_KEY', answers.apiKey.trim());
  updateEnvFile('NODE_ENV', 'development');
  updateEnvFile('LOG_LEVEL', 'info');
  updateEnvFile('JOBS_FILE', 'config/jobs.json');
  console.log('Agent name saved to', AGENT_FILE);
  console.log('.env updated with TRUSS_API_KEY, NODE_ENV, LOG_LEVEL, JOBS_FILE. You can use Test Truss API → Destination in this session.');
}

/**
 * Parse interval shorthand: 5m, 45m, 1h, 24h, 7d, 1day, etc.
 * Units: m/min/mins/minute/minutes, h/hour/hours, d/day/days.
 * Returns equivalent minutes or null if not matched.
 */
function parseIntervalSpec(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const match = trimmed.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hour|hours|d|day|days)$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  if (Number.isNaN(n) || n < 1) return null;
  const unit = match[2];
  if (unit === 'm' || unit.startsWith('min')) return n;
  if (unit === 'h' || unit.startsWith('hour')) return n * 60;
  if (unit === 'd' || unit.startsWith('day')) return n * 24 * 60;
  return null;
}

function parseSchedule(input: string): string | number {
  const trimmed = input.trim();
  const interval = parseIntervalSpec(trimmed);
  if (interval != null) return interval;
  const num = parseInt(trimmed, 10);
  if (!Number.isNaN(num) && num > 0) return num;
  return trimmed;
}

/** 24-hour time → hour 0–23, minute 0–59. */
function parseTime24h(input: string): { hour: number; minute: number } | null {
  const m = input.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) return null;
  return { hour, minute };
}

type SchedulePlan = {
  schedule: string | number;
  outputFormat: OutputFormat;
  windowMinutes?: number;
  windowDays?: number;
};

function parseCommaList(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Infer approximate window in days from startDate/endDate in a filter (for suggestion). */
function inferWindowDaysFromFilter(filter: ApiSearchFilter): number | undefined {
  const start = filter.startDate;
  const end = filter.endDate;
  if (start == null || end == null) return undefined;
  const startMs = typeof start === 'string' ? new Date(start).getTime() : start;
  const endMs = typeof end === 'string' ? new Date(end).getTime() : end;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return undefined;
  const days = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));
  return days > 0 ? days : undefined;
}

async function promptManualTrussFilterFields(): Promise<{
  filter: ApiSearchFilter;
  windowDays: number;
}> {
  const a = await inquirer.prompt<{
    lastDays: string;
    category: string;
    source: string;
    author: string;
    region: string;
    industry: string;
    reference: string;
    tags: string;
    indicators: string;
  }>([
    {
      type: 'input',
      name: 'lastDays',
      message:
        'Pull data from the last N days (e.g. 1, 7, 30). For interval schedule (e.g. 10 min), query window = run interval to avoid duplicates:',
      default: '7',
      validate: (input: string) => {
        const n = parseInt(input.trim(), 10);
        if (Number.isNaN(n) || n < 1) return 'Enter a positive number of days';
        return true;
      },
    },
    {
      type: 'input',
      name: 'category',
      message: 'Category (comma-separated; e.g. Malware, Phishing; optional):',
      default: '',
    },
    {
      type: 'input',
      name: 'source',
      message: 'Sources (comma-separated; optional):',
      default: '',
    },
    {
      type: 'input',
      name: 'author',
      message: 'Authors (comma-separated; optional):',
      default: '',
    },
    {
      type: 'input',
      name: 'region',
      message: 'Region (comma-separated; optional):',
      default: '',
    },
    {
      type: 'input',
      name: 'industry',
      message:
        'Industry (comma-separated; e.g. Cryptocurrency, Financial Services, Banking, Web3, Blockchain; optional):',
      default: '',
    },
    {
      type: 'input',
      name: 'reference',
      message: 'References (comma-separated; optional):',
      default: '',
    },
    {
      type: 'input',
      name: 'tags',
      message: 'Tags (comma-separated; optional):',
      default: '',
    },
    {
      type: 'input',
      name: 'indicators',
      message: 'Indicator types (comma-separated; optional):',
      default: '',
    },
  ]);
  const windowDays = parseInt(a.lastDays.trim(), 10) || 7;
  const filter: ApiSearchFilter = {
    ...(parseCommaList(a.category).length > 0 && { category: parseCommaList(a.category) }),
    ...(parseCommaList(a.source).length > 0 && { source: parseCommaList(a.source) }),
    ...(parseCommaList(a.author).length > 0 && { author: parseCommaList(a.author) }),
    ...(parseCommaList(a.region).length > 0 && { region: parseCommaList(a.region) }),
    ...(parseCommaList(a.industry).length > 0 && { industry: parseCommaList(a.industry) }),
    ...(parseCommaList(a.reference).length > 0 && { reference: parseCommaList(a.reference) }),
    ...(parseCommaList(a.tags).length > 0 && { tags: parseCommaList(a.tags) }),
    ...(parseCommaList(a.indicators).length > 0 && { indicators: parseCommaList(a.indicators) }),
  };
  return { filter, windowDays };
}

async function promptTrussQueryFields(): Promise<{
  configName?: string;
  filter?: ApiSearchFilter;
  windowDays?: number;
}> {
  const querySource = await inquirer.prompt<{ source: 'pasteExample' | 'manual' }>({
    type: 'list',
    name: 'source',
    message: 'How do you want to define what the agent pulls from Truss?',
    choices: [
      { name: 'Copy in Truss API example', value: 'pasteExample' },
      { name: 'Manually enter Truss filter options', value: 'manual' },
    ],
  });

  let filter: ApiSearchFilter | undefined;
  let windowDays: number | undefined;

  if (querySource.source === 'manual') {
    const manual = await promptManualTrussFilterFields();
    filter = manual.filter;
    windowDays = manual.windowDays;
    return { filter, windowDays };
  }

  const editorChoice = await inquirer.prompt<{ editor: 'vim' | 'nano' }>({
    type: 'list',
    name: 'editor',
    message: 'Which editor should open for your paste?',
    choices: [
      { name: 'vim', value: 'vim' },
      { name: 'nano', value: 'nano' },
    ],
  });
  const previousEditor = process.env.EDITOR;
  process.env.EDITOR = editorChoice.editor;
  const pasteAnswer = await inquirer.prompt<{ pasted: string }>([
    {
      type: 'editor',
      name: 'pasted',
      message:
        'Paste POST /product/search JSON or a dashboard sample (curl, JavaScript, Python, bash, Go, Rust, Ruby). Press Enter to open the editor, paste, save and close:',
      default: '',
    },
  ]);
  if (previousEditor !== undefined) process.env.EDITOR = previousEditor;
  else delete process.env.EDITOR;
  const pasted = (pasteAnswer.pasted ?? '').trim();
  let extracted: ApiSearchFilter | null = null;
  if (pasted) {
    const { filter: parsed, hint } = extractTrussSearchBodyFromPaste(pasted);
    if (hint) {
      console.log(hint);
    }
    if (parsed) {
      const arrayNames = LEGACY_ARRAY_FILTER_KEYS.filter((k) => {
        const arr = parsed[k];
        return Array.isArray(arr) && arr.length > 0;
      });
      const pieces: string[] = [];
      if (parsed.filterExpression) {
        pieces.push('FilterQL (filterExpression)');
      }
      if (parsed.days != null) {
        pieces.push(`days (${parsed.days})`);
      }
      if (parsed.order_by) {
        const dir = parsed.order_direction ? ` ${parsed.order_direction}` : '';
        pieces.push(`sort (${parsed.order_by}${dir})`);
      }
      if (parsed.startDate != null) {
        pieces.push('startDate');
      }
      if (parsed.endDate != null) {
        pieces.push('endDate');
      }
      if (arrayNames.length > 0) {
        pieces.push(`lists: ${arrayNames.join(', ')}`);
      }
      console.log(`Parsed sample OK — using: ${pieces.join('; ')}.`);
      if (parsed.filterExpression && arrayNames.length === 0) {
        console.log(
          '(Dashboard pastes often only include filterExpression + dates; that is enough. Lists like category/tags arrays are optional.)'
        );
      }
    } else if (!hint) {
      console.log('Could not parse an example from the paste; enter filter options manually next.');
    }
    extracted = parsed;
  }

  if (extracted) {
    const { startDate: _s, endDate: _e, ...rest } = extracted;
    filter = rest as ApiSearchFilter;
    const inferredDays = inferWindowDaysFromFilter(extracted);
    windowDays = inferredDays ?? 7;
    if (inferredDays != null) {
      console.log(`Pasted date range suggests ${inferredDays} day(s) lookback (used as default for cron).`);
    }
  }

  if (filter == null) {
    const manual = await promptManualTrussFilterFields();
    filter = manual.filter;
    windowDays = manual.windowDays;
  }

  return { filter, windowDays };
}

const WEEKDAY_CRON_CHOICES = [
  { name: 'Sunday', value: '0' },
  { name: 'Monday', value: '1' },
  { name: 'Tuesday', value: '2' },
  { name: 'Wednesday', value: '3' },
  { name: 'Thursday', value: '4' },
  { name: 'Friday', value: '5' },
  { name: 'Saturday', value: '6' },
] as const;

/** Weekly cron (node-cron 5-field: minute hour dom month dow) + lookback for exec-summary runs. */
async function promptExecSummaryWeeklyPlan(dayHint: number): Promise<SchedulePlan> {
  const w = await inquirer.prompt<{ weekday: string; timeStr: string }>([
    {
      type: 'list',
      name: 'weekday',
      message: 'Which day should the weekly report run?',
      choices: [...WEEKDAY_CRON_CHOICES],
    },
    {
      type: 'input',
      name: 'timeStr',
      message: 'Time to run (24-hour, e.g. 05:00 or 17:30):',
      validate: (input: string) => {
        const t = parseTime24h(input);
        return t != null ? true : 'Use HH:MM in 24-hour form (e.g. 05:00)';
      },
    },
  ]);
  const t = parseTime24h(w.timeStr)!;
  const cronExpr = `${t.minute} ${t.hour} * * ${w.weekday}`;
  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron built from day/time: ${cronExpr}`);
  }
  console.log(`Weekly report schedule (cron): ${cronExpr}`);

  const lookback = await inquirer.prompt<{ windowMinutes: string }>({
    type: 'input',
    name: 'windowMinutes',
    message: `For each run, how far back to pull indicators? Minutes (e.g. 10080 for 7 days) or leave blank for ${dayHint} day(s):`,
    default: '',
  });
  let windowMinutes: number | undefined;
  let windowDays: number | undefined = dayHint;
  const parsed = parseInt(lookback.windowMinutes.trim(), 10);
  if (!Number.isNaN(parsed) && parsed > 0) {
    windowMinutes = parsed;
    windowDays = undefined;
  } else if (windowDays == null) {
    windowDays = dayHint;
  }

  return {
    schedule: cronExpr,
    outputFormat: 'report',
    windowMinutes,
    windowDays,
  };
}

async function promptIocOrMetadataSchedulePlan(
  outputFormat: 'ioc' | 'metadata',
  dayHint: number,
  defaultScheduleInput: string
): Promise<SchedulePlan> {
  const answers = await inquirer.prompt<{ scheduleInput: string }>([
    {
      type: 'input',
      name: 'scheduleInput',
      message:
        'Pull frequency (how often + how far back): e.g. 5m, 45m, 1h, 24h, 7d, 1day (any number + m/min/h/hour/d/day), plain minutes, or cron (e.g. "0 */6 * * *"):',
      default: defaultScheduleInput,
      validate: (input: string) => {
        if (!input.trim()) return 'Schedule is required';
        const trimmed = input.trim();
        if (parseIntervalSpec(trimmed) != null) return true;
        const num = parseInt(trimmed, 10);
        if (!Number.isNaN(num) && num > 0) return true;
        if (trimmed.length >= 5) return true;
        return 'Use e.g. 5m, 1h, 7d or 1day; a number of minutes; or a cron expression';
      },
    },
  ]);

  const schedule = parseSchedule(answers.scheduleInput);
  let windowMinutes: number | undefined;
  let windowDays: number | undefined = dayHint;

  if (typeof schedule === 'number') {
    windowMinutes = schedule;
    windowDays = undefined;
    console.log(`Using interval: every ${schedule} min(s), pulling last ${schedule} min(s).`);
  } else {
    const win = await inquirer.prompt<{ windowMinutes: string }>({
      type: 'input',
      name: 'windowMinutes',
      message: `For each run, how far back to pull? Minutes (e.g. 360) or leave blank for ${dayHint} day(s):`,
      default: '',
    });
    const parsed = parseInt(win.windowMinutes.trim(), 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      windowMinutes = parsed;
      windowDays = undefined;
    } else if (windowDays == null) {
      windowDays = dayHint;
    }
  }

  return {
    schedule,
    outputFormat,
    windowMinutes,
    windowDays,
  };
}

/**
 * Output format first, then schedule: exec summary → weekly day + time (cron); IOC / Metadata → interval or cron + lookback.
 */
async function promptOutputFormatAndSchedule(options: {
  filterWindowDays?: number;
  defaults?: {
    scheduleInput: string;
    outputFormat: OutputFormat;
  };
}): Promise<SchedulePlan> {
  const dayHint = options.filterWindowDays ?? 7;

  const { outputFormat } = await inquirer.prompt<{ outputFormat: OutputFormat }>({
    type: 'list',
    name: 'outputFormat',
    message: 'Output format:',
    default: options.defaults?.outputFormat ?? 'ioc',
    choices: [
      { name: 'IOC only', value: 'ioc' },
      { name: 'Metadata (awareness)', value: 'metadata' },
      { name: 'Report (exec summary)', value: 'report' },
    ],
  });

  if (outputFormat === 'report') {
    return promptExecSummaryWeeklyPlan(dayHint);
  }
  return promptIocOrMetadataSchedulePlan(
    outputFormat,
    dayHint,
    options.defaults?.scheduleInput ?? ''
  );
}

function mergeQueryWithEarlySchedule(
  query: ConnectionQuery | undefined,
  plan?: SchedulePlan
): ConnectionQuery | undefined {
  if (!plan) {
    return query != null && Object.keys(query).length > 0 ? query : undefined;
  }
  const base: ConnectionQuery = { ...(query ?? {}) };
  const hasQueryWindow = base.windowDays != null || base.windowMinutes != null;
  if (hasQueryWindow) {
    return Object.keys(base).length > 0 ? base : undefined;
  }
  const merged = mergeQueryWithScheduleWindow(base, plan);
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function schedulePatchFromPlanAndMergedQuery(
  plan: SchedulePlan,
  mergedQuery: ConnectionQuery | undefined
): {
  schedule: string | number;
  outputFormat: OutputFormat;
  windowMinutes?: number;
  windowDays?: number;
} {
  return {
    schedule: plan.schedule,
    outputFormat: plan.outputFormat,
    windowMinutes: mergedQuery?.windowMinutes ?? plan.windowMinutes,
    windowDays: mergedQuery?.windowDays ?? plan.windowDays,
  };
}

function filterHasPayload(f: ApiSearchFilter | undefined): boolean {
  if (f == null) return false;
  return Object.keys(f).length > 0;
}

function connectionQueryHasFilterPayload(q: ConnectionQuery | undefined): boolean {
  return q != null && q.filter != null && typeof q.filter === 'object' && Object.keys(q.filter).length > 0;
}

/** Deep copy filter from connection query onto job JSON (same shape as connections.json query.filter). */
function jobFilterFromConnectionQuery(mergedQuery: ConnectionQuery | undefined): Job['filter'] | undefined {
  if (!mergedQuery || !connectionQueryHasFilterPayload(mergedQuery)) return undefined;
  const f = mergedQuery.filter;
  try {
    return JSON.parse(JSON.stringify(f)) as Job['filter'];
  } catch {
    return f as Job['filter'];
  }
}

function formatScheduleForUserLog(schedule: string | number): string {
  if (typeof schedule === 'number') {
    return `every ${schedule} minute(s) (interval)`;
  }
  return `cron: ${schedule}`;
}

function buildConnectionQueryFromFields(
  fields: { configName?: string; filter?: ApiSearchFilter; windowDays?: number },
  previous?: ConnectionQuery
): ConnectionQuery | undefined {
  const prev = previous ?? {};
  if (fields.configName) {
    const q: ConnectionQuery = { configName: fields.configName };
    if (fields.windowDays != null) q.windowDays = fields.windowDays;
    if (prev.windowMinutes != null) q.windowMinutes = prev.windowMinutes;
    return q;
  }
  if (!filterHasPayload(fields.filter)) {
    return undefined;
  }
  return {
    filter: fields.filter as Record<string, string | number | string[]>,
    ...(fields.windowDays != null ? { windowDays: fields.windowDays } : {}),
    ...(prev.windowMinutes != null ? { windowMinutes: prev.windowMinutes } : {}),
  };
}

function applyQueryToJob(job: Job, query: ConnectionQuery): Job {
  const next = { ...job };
  delete next.filter;
  delete next.configName;
  if (query.configName) {
    next.configName = query.configName;
  }
  if (query.filter && Object.keys(query.filter).length > 0) {
    next.filter = query.filter as Job['filter'];
  }
  if (query.windowDays != null) {
    next.windowDays = query.windowDays;
    delete next.windowMinutes;
  } else if (query.windowMinutes != null) {
    next.windowMinutes = query.windowMinutes;
    delete next.windowDays;
  }
  return next;
}

function formatScheduleForPrompt(schedule: string | number): string {
  return typeof schedule === 'number' ? String(schedule) : schedule;
}

function mergeQueryWithScheduleWindow(
  query: ConnectionQuery | undefined,
  schedulePart: { windowMinutes?: number; windowDays?: number }
): ConnectionQuery {
  const base: ConnectionQuery = { ...(query ?? {}) };
  if (schedulePart.windowMinutes != null) {
    base.windowMinutes = schedulePart.windowMinutes;
    delete base.windowDays;
  } else if (schedulePart.windowDays != null) {
    base.windowDays = schedulePart.windowDays;
    delete base.windowMinutes;
  }
  return base;
}

function applyScheduleAndWindowToJob(
  job: Job,
  result: {
    schedule: string | number;
    outputFormat: OutputFormat;
    windowMinutes?: number;
    windowDays?: number;
  }
): Job {
  const next: Job = {
    ...job,
    schedule: result.schedule,
    outputFormat: result.outputFormat,
  };
  delete next.windowDays;
  delete next.windowMinutes;
  if (result.windowMinutes != null) {
    next.windowMinutes = result.windowMinutes;
  } else if (result.windowDays != null) {
    next.windowDays = result.windowDays;
  }
  return next;
}

function syncLinkedJobsAfterModify(
  previousConnectionName: string,
  currentConnectionName: string,
  patches: {
    query?: ConnectionQuery;
    schedule?: {
      schedule: string | number;
      outputFormat: OutputFormat;
      windowMinutes?: number;
      windowDays?: number;
    };
  }
): void {
  const jobsJson = (config.get('jobs.jobsJson') as string)?.trim();
  if (jobsJson) {
    console.log('JOBS_JSON is set; update jobs manually for this connection.');
    return;
  }
  if (!JOBS_FILE?.trim()) return;

  const jobs = loadJobs(JOBS_FILE);
  let touched = false;
  const next = jobs.map((job) => {
    const matches =
      job.connectionName === previousConnectionName ||
      job.connectionName === currentConnectionName;
    if (!matches) return job;
    touched = true;
    const renamed =
      job.connectionName === previousConnectionName &&
      previousConnectionName !== currentConnectionName;
    let j: Job = renamed
      ? { ...job, connectionName: currentConnectionName, name: currentConnectionName }
      : { ...job };
    if (patches.schedule) {
      j = applyScheduleAndWindowToJob(j, patches.schedule);
    }
    if (patches.query) {
      j = applyQueryToJob(j, patches.query);
    }
    return j;
  });
  if (touched) {
    saveJobs(JOBS_FILE, next);
    console.log(`Updated job(s) for connection "${currentConnectionName}".`);
  }
}

async function promptTrussQueryAddon(): Promise<{
  configName?: string;
  filter?: ApiSearchFilter;
  windowDays?: number;
} | null> {
  const add = await inquirer.prompt<{ add: boolean }>({
    type: 'confirm',
    name: 'add',
    message: 'Add a Truss query for this connection?',
    default: true,
  });
  if (!add.add) return null;
  return promptTrussQueryFields();
}

function getJobsFromFile(): Job[] {
  const jobsJson = config.get('jobs.jobsJson') as string | undefined;
  if (jobsJson && jobsJson.trim()) {
    console.log('Jobs are set via JOBS_JSON; not writing to file.');
    return [];
  }
  return loadJobs(JOBS_FILE);
}

/** Get the query window (ms) for the job that uses this connection. Used so Report/Test Truss use the connection's cron timeframe. */
function getWindowMsFromJobForConnection(connectionName: string): number {
  const jobs = getJobsFromFile();
  const job = jobs.find((j) => j.connectionName === connectionName);
  if (!job) return 7 * 24 * 60 * 60 * 1000;
  if (typeof job.schedule === 'number') return job.schedule * 60 * 1000;
  if (job.windowMinutes != null) return job.windowMinutes * 60 * 1000;
  if (job.windowDays != null) return job.windowDays * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
}

async function runCreate(): Promise<void> {
  const typeAnswer = await inquirer.prompt<{ type: string }>({
    type: 'list',
    name: 'type',
    message: 'Connection type:',
    choices: [
      { name: 'Back to main menu', value: BACK_TO_MENU_VALUE },
      ...getConnectionTypes().map((m) => ({ name: m.label, value: m.typeId })),
    ],
  });
  if (typeAnswer.type === BACK_TO_MENU_VALUE) return;
  const module = getModule(typeAnswer.type);
  if (!module) return;

  const plan = await promptOutputFormatAndSchedule({ filterWindowDays: 7 });

  let conn = await module.promptCreate(getConnections);
  const connections = getConnections();
  connections.push(conn);
  saveConnections(CONNECTIONS_FILE, connections);
  console.log(`Saved connection "${conn.name}".`);

  const fields = await promptTrussQueryAddon();
  if (!fields) {
    console.log(
      'No Truss query added; no job was created. Output format and schedule you chose were not saved. Add a query later via Modify or edit config files.'
    );
    return;
  }

  const built = buildConnectionQueryFromFields(fields, undefined);
  if (built == null) {
    console.log('No query saved (paste a valid example or enter at least one filter field / filterExpression).');
    return;
  }

  const mergedQuery = mergeQueryWithEarlySchedule(built, plan) ?? built;
  conn = { ...conn, query: mergedQuery };
  const updatedConnections = getConnections().map((c) => (c.name === conn.name ? conn : c));
  saveConnections(CONNECTIONS_FILE, updatedConnections);
  console.log('Connection query saved to config/connections.json.');

  const jobPatch = schedulePatchFromPlanAndMergedQuery(plan, mergedQuery);

  const jobsJson = (config.get('jobs.jobsJson') as string)?.trim();
  if (jobsJson) {
    console.log('Jobs are set via JOBS_JSON; add a job manually that uses connectionName:', conn.name);
  } else if (JOBS_FILE) {
    const existingJobs = getJobsFromFile();
    const jobName = conn.name;
    const jobFilter = jobFilterFromConnectionQuery(mergedQuery) ?? (filterHasPayload(fields.filter) ? fields.filter : undefined);
    const newJob: Job = {
      name: jobName,
      connectionName: conn.name,
      schedule: jobPatch.schedule,
      outputFormat: jobPatch.outputFormat,
      ...(fields.configName ? { configName: fields.configName } : {}),
      ...(jobFilter ? { filter: jobFilter } : {}),
      ...(jobPatch.windowDays != null ? { windowDays: jobPatch.windowDays } : {}),
      ...(jobPatch.windowMinutes != null ? { windowMinutes: jobPatch.windowMinutes } : {}),
    };
    saveJobs(JOBS_FILE, [...existingJobs, newJob]);
    console.log(`Added job "${jobName}" with schedule (${formatScheduleForUserLog(jobPatch.schedule)}).`);
  }
}

async function runModify(): Promise<void> {
  const connections = getConnections();
  if (connections.length === 0) {
    console.log('No connections defined. Create one first.');
    return;
  }
  const choice = await inquirer.prompt<{ connection: string }>({
    type: 'list',
    name: 'connection',
    message: 'Select connection to modify:',
    choices: [
      { name: 'Back to main menu', value: BACK_TO_MENU_VALUE },
      ...connections.map((c) => ({
        name: `${c.name} (${c.type})`,
        value: c.name,
      })),
    ],
  });
  if (choice.connection === BACK_TO_MENU_VALUE) return;
  const existing = getConnectionByName(connections, choice.connection);
  if (!existing) return;
  const module = getModule(existing.type);
  if (!module) {
    console.log('Unsupported connection type.');
    return;
  }
  const previousName = existing.name;
  const refJob = getJobsFromFile().find((j) => j.connectionName === existing.name);

  const reconfigSchedule = await inquirer.prompt<{ yes: boolean }>({
    type: 'confirm',
    name: 'yes',
    message:
      'Update output format and pull schedule now? (If No, the current job schedule and format stay until a later edit.)',
    default: true,
  });

  let plan: SchedulePlan | undefined;
  if (reconfigSchedule.yes) {
    plan = await promptOutputFormatAndSchedule({
      filterWindowDays: existing.query?.windowDays ?? refJob?.windowDays ?? 7,
      defaults: refJob
        ? {
            scheduleInput: formatScheduleForPrompt(refJob.schedule),
            outputFormat: refJob.outputFormat,
          }
        : undefined,
    });
  }

  const updated = await module.promptModify(existing);

  const wantQuery = await inquirer.prompt<{ yes: boolean }>({
    type: 'confirm',
    name: 'yes',
    message:
      'Update the Truss API query (paste a Truss API example or enter filter options manually, same as create)?',
    default: true,
  });

  let conn = updated;
  let queryDirty = false;
  if (wantQuery.yes) {
    const fields = await promptTrussQueryFields();
    const newQuery = buildConnectionQueryFromFields(fields, updated.query);
    if (newQuery == null) {
      console.log(
        'No query changes applied (paste a valid example or enter at least one filter field / filterExpression).'
      );
    } else {
      conn = { ...updated, query: newQuery };
      queryDirty = true;
    }
  }

  let mergedQuery: ConnectionQuery | undefined = conn.query;
  if (plan) {
    mergedQuery = mergeQueryWithEarlySchedule(conn.query, plan) ?? conn.query;
    conn = { ...conn, query: mergedQuery };
  }

  const schedulePatch = plan ? schedulePatchFromPlanAndMergedQuery(plan, mergedQuery) : undefined;

  const next = connections.map((c) => (c.name === previousName ? conn : c));
  saveConnections(CONNECTIONS_FILE, next);
  console.log(`Updated connection "${conn.name}".`);

  const connectionRenamed = previousName !== conn.name;
  if (queryDirty || schedulePatch != null || connectionRenamed) {
    const queryPatchForJobs =
      queryDirty && conn.query
        ? conn.query
        : (schedulePatch != null || connectionRenamed) && connectionQueryHasFilterPayload(conn.query)
          ? conn.query
          : undefined;
    syncLinkedJobsAfterModify(previousName, conn.name, {
      query: queryPatchForJobs,
      schedule: schedulePatch,
    });
  }
}

async function runTest(): Promise<void> {
  const connections = getConnections();
  if (connections.length === 0) {
    console.log('No connections defined. Create one first.');
    return;
  }
  console.log('This only tests the destination (webhook). No API pull.\n');
  const choice = await inquirer.prompt<{ connection: string }>({
    type: 'list',
    name: 'connection',
    message: 'Select connection to test (destination only):',
    choices: [
      { name: 'Back to main menu', value: BACK_TO_MENU_VALUE },
      { name: 'None (skip test)', value: '__none__' },
      ...connections.map((c) => ({
        name: `${c.name} (${c.type})`,
        value: c.name,
      })),
    ],
  });
  if (choice.connection === BACK_TO_MENU_VALUE || choice.connection === '__none__') return;
  const conn = getConnectionByName(connections, choice.connection);
  if (!conn) return;
  const module = getModule(conn.type);
  if (!module) return;
  const webhookUrl = getWebhookUrlForConnection(conn);
  const testMessage =
    'Truss Agent test message – if you see this, the connection works.';
  try {
    await module.sendText(webhookUrl, testMessage);
    console.log('Test message sent successfully. Check the channel.');
  } catch (err) {
    console.error('Test failed:', err instanceof Error ? err.message : err);
  }
}

async function runTestTrussToDiscord(): Promise<void> {
  dotenv.config();
  const apiKey = (process.env.TRUSS_API_KEY ?? config.get('indicators.apiKey')) as string;
  if (!apiKey || !apiKey.trim()) {
    console.log('TRUSS_API_KEY is not set. Run First-time setup first.');
    return;
  }
  const connections = getConnections().filter((c) => getWebhookUrlForConnection(c));
  if (connections.length === 0) {
    console.log('No connections defined. Create one first.');
    return;
  }
  console.log('This tests the full operation (pull from Truss API + send to destination) for the selected connection, regardless of enabled/disabled.\n');
  const connChoice = await inquirer.prompt<{ connection: string }>({
    type: 'list',
    name: 'connection',
    message: 'Select connection to test (full flow):',
    choices: [
      { name: 'Back to main menu', value: BACK_TO_MENU_VALUE },
      { name: 'None (skip test)', value: '__none__' },
      ...connections.map((c) => ({
        name: `${c.name} (${c.type}) – ${isConnectionEnabled(c) ? 'enabled' : 'disabled'}`,
        value: c.name,
      })),
    ],
  });
  if (connChoice.connection === BACK_TO_MENU_VALUE || connChoice.connection === '__none__') return;
  const conn = getConnectionByName(connections, connChoice.connection);
  if (!conn) return;
  const webhookUrl = getWebhookUrlForConnection(conn);
  if (!webhookUrl) return;

  const formatChoice = await inquirer.prompt<{ format: string }>({
    type: 'list',
    name: 'format',
    message: 'Output format:',
    choices: [
      { name: 'Back to main menu', value: BACK_TO_MENU_VALUE },
      { name: 'IOC (indicators list)', value: 'ioc' },
      { name: 'Metadata (title, author, category, etc.)', value: 'metadata' },
      { name: 'Report (exec summary)', value: 'report' },
    ],
  });
  if (formatChoice.format === BACK_TO_MENU_VALUE) return;

  const now = new Date();
  const endDate = now.toISOString();
  const jobWindowMs = getWindowMsFromJobForConnection(conn.name);
  let filter: ApiSearchFilter;

  const built = buildFilterFromConnectionQuery(conn, endDate, jobWindowMs);
  if (built) {
    filter = { ...built.rest, startDate: built.startDate, endDate: built.endDate } as ApiSearchFilter;
    console.log('Using connection query filter:', JSON.stringify(built.rest, null, 2));
  } else {
    const mod = getModule(conn.type);
    const configName = mod?.getConfigName?.(conn);
    if (configName) {
      const trussApi = new TrussApi(apiKey);
      console.log('Fetching filter from Truss API config:', configName);
      try {
        const agentData = await trussApi.getAgentData(apiKey, configName);
        const windowMs =
          agentData.runIntervalMinutes > 0
            ? agentData.runIntervalMinutes * 60 * 1000
            : jobWindowMs;
        const startDate = new Date(Date.now() - windowMs).toISOString();
        filter = { ...agentData.filter, startDate, endDate };
      } catch (err) {
        console.error('Failed to get agent data:', err instanceof Error ? err.message : err);
        return;
      }
    } else {
      const startDate = new Date(now.getTime() - jobWindowMs).toISOString();
      filter = { startDate, endDate };
      console.log(`No query on connection; using job/connection timeframe (${Math.round(jobWindowMs / 60000)} min). Add a query when creating the connection to filter results.`);
    }
  }

  console.log('Fetching indicators from Truss API...');
  const trussApi = new TrussApi(apiKey);
  let indicators;
  try {
    indicators = await trussApi.searchIndicators(filter);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status && status >= 500) {
      console.error(`Truss API request failed: ${msg}`);
      console.error('The Truss API (or gateway) returned a server error. Try again in a few minutes or contact the API provider.');
    } else {
      console.error('Truss API request failed:', msg);
    }
    return;
  }
  if (indicators.length === 0) {
    console.log('No indicators returned. Nothing to send.');
    return;
  }

  const filterSummary = formatFiltersUsed(filter);
  const connectionDisplayForMetadata = {
    name: conn.name,
    description: conn.description,
    filterSummary,
  };
  const connectionDisplayForExec = {
    name: conn.name,
    description: conn.description,
    jobName: conn.name,
  };

  if (formatChoice.format === 'metadata') {
    console.log(`\nWill send ${indicators.length} metadata embed(s) (rich cards with title, author, category, source, date, references, tags, IOC types and counts).`);
  } else if (formatChoice.format === 'report') {
    const summary = buildExecSummary(indicators, filter, connectionDisplayForExec);
    console.log('\n--- Report (exec summary) that will be sent ---');
    console.log(summary);
    console.log('--- End payload ---\n');
  } else {
    const text = formatIndicatorsAsIoc(indicators);
    if (!text.trim()) {
      console.log('Formatter produced empty output.');
      return;
    }
    console.log('\n--- Payload that will be sent ---');
    console.log(text);
    console.log('--- End payload ---\n');
  }

  const sendConfirm = await inquirer.prompt<{ send: boolean }>({
    type: 'confirm',
    name: 'send',
    message: 'Send this to the channel?',
    default: true,
  });
  if (!sendConfirm.send) {
    console.log('Not sent.');
    return;
  }
  const module = getModule(conn.type);
  if (!module) return;
  try {
    if (formatChoice.format === 'metadata') {
      await module.sendReport(webhookUrl, indicators, connectionDisplayForMetadata);
    } else if (formatChoice.format === 'report') {
      await module.sendExecSummary(webhookUrl, indicators, filter, connectionDisplayForExec);
    } else {
      await module.sendText(webhookUrl, formatIndicatorsAsIoc(indicators));
    }
    console.log('Sent successfully. Check your channel.');
  } catch (err) {
    console.error('Failed to send:', err instanceof Error ? err.message : err);
  }
}

function maskWebhookUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      return `${u.origin}/.../${pathParts[pathParts.length - 2].slice(0, 8)}.../${pathParts[pathParts.length - 1].slice(0, 8)}...`;
    }
    return `${u.origin}/...`;
  } catch {
    return '***';
  }
}

async function runListConnections(): Promise<void> {
  const connections = getConnections();
  if (connections.length === 0) {
    console.log('No connections configured.');
    return;
  }
  console.log('\nConfigured connections:\n');
  for (const c of connections) {
    const webhook = maskWebhookUrl(c.webhookUrl);
    const status = isConnectionEnabled(c) ? 'enabled' : 'disabled';
    const queryJson =
      c.query != null && typeof c.query === 'object' && Object.keys(c.query).length > 0
        ? JSON.stringify(c.query)
        : '{}';
    console.log(`  ${c.name} (${c.type})  ${status}  webhook: ${webhook}`);
    console.log(`    query: ${queryJson}`);
  }
  console.log('');
}

async function runEnableDisableConnection(): Promise<void> {
  const connections = getConnections();
  if (connections.length === 0) {
    console.log('No connections configured. Create one first.');
    return;
  }
  const proceed = await inquirer.prompt<{ action: string }>({
    type: 'list',
    name: 'action',
    message: 'Enable/Disable connections:',
    choices: [
      { name: 'Toggle enable/disable for connections', value: 'toggle' },
      { name: 'Back to main menu', value: BACK_TO_MENU_VALUE },
    ],
  });
  if (proceed.action === BACK_TO_MENU_VALUE) return;
  const answer = await inquirer.prompt<{ enabledConnections: string[] }>({
    type: 'checkbox',
    name: 'enabledConnections',
    message: 'Toggle connections (space = switch, Enter = continue). Checked = enabled:',
    choices: connections.map((c) => ({
      name: `${c.name} (${c.type})`,
      value: c.name,
      checked: isConnectionEnabled(c),
    })),
  });
  const enabledSet = new Set(answer.enabledConnections);
  const toEnable = connections.filter((c) => !isConnectionEnabled(c) && enabledSet.has(c.name));
  const toDisable = connections.filter((c) => isConnectionEnabled(c) && !enabledSet.has(c.name));
  const changedCount = toEnable.length + toDisable.length;
  if (changedCount === 0) {
    console.log('No changes to save.');
    return;
  }
  const lines: string[] = [];
  if (toEnable.length > 0) {
    lines.push(`Enable: ${toEnable.map((c) => c.name).join(', ')}`);
  }
  if (toDisable.length > 0) {
    lines.push(`Disable: ${toDisable.map((c) => c.name).join(', ')}`);
  }
  const confirm = await inquirer.prompt<{ apply: boolean }>({
    type: 'confirm',
    name: 'apply',
    message: `You are about to:\n  ${lines.join('\n  ')}\n\nJobs in config/jobs.json that use these connections will run when enabled and be skipped when disabled. Apply these changes?`,
    default: true,
  });
  if (!confirm.apply) {
    console.log('Changes not applied.');
    return;
  }
  const next = connections.map((c) => ({
    ...c,
    enabled: enabledSet.has(c.name),
  }));
  saveConnections(CONNECTIONS_FILE, next);
  console.log(`Updated ${changedCount} connection(s): ${toEnable.map((c) => `${c.name} → enabled`).concat(toDisable.map((c) => `${c.name} → disabled`)).join(', ')}.`);
}

async function runDeleteConnection(): Promise<void> {
  const connections = getConnections();
  if (connections.length === 0) {
    console.log('No connections to delete.');
    return;
  }
  const choice = await inquirer.prompt<{ connection: string }>({
    type: 'list',
    name: 'connection',
    message: 'Select connection to delete:',
    choices: [
      { name: 'Back to main menu', value: BACK_TO_MENU_VALUE },
      ...connections.map((c) => ({
        name: `${c.name} (${c.type})`,
        value: c.name,
      })),
    ],
  });
  if (choice.connection === BACK_TO_MENU_VALUE) return;
  const jobs = getJobsFromFile();
  const jobsUsing = jobs.filter((j) => j.connectionName === choice.connection);
  if (jobsUsing.length > 0) {
    const confirm = await inquirer.prompt<{ ok: boolean }>({
      type: 'confirm',
      name: 'ok',
      message: `"${choice.connection}" is used by ${jobsUsing.length} job(s). Delete the connection and remove those jobs from config/jobs.json?`,
      default: false,
    });
    if (!confirm.ok) return;
  } else {
    const confirm = await inquirer.prompt<{ ok: boolean }>({
      type: 'confirm',
      name: 'ok',
      message: `Delete connection "${choice.connection}"?`,
      default: false,
    });
    if (!confirm.ok) return;
  }
  const next = connections.filter((c) => c.name !== choice.connection);
  saveConnections(CONNECTIONS_FILE, next);
  console.log(`Deleted connection "${choice.connection}".`);

  const jobsJson = (config.get('jobs.jobsJson') as string)?.trim();
  if (jobsUsing.length > 0 && !jobsJson && JOBS_FILE?.trim()) {
    const remaining = jobs.filter((j) => j.connectionName !== choice.connection);
    saveJobs(JOBS_FILE, remaining);
    console.log(`Removed ${jobsUsing.length} linked job(s) from jobs config.`);
  } else if (jobsUsing.length > 0 && jobsJson) {
    console.log('JOBS_JSON is set; remove jobs that referenced this connection from your environment manually.');
  }
}

function ensureDockerContext(): boolean {
  const cwd = process.cwd();
  const dockerfile = path.join(cwd, 'Dockerfile');
  if (!fs.existsSync(dockerfile)) {
    console.error('Dockerfile not found in current directory. Run this from the truss-agent project root.');
    return false;
  }
  return true;
}

/** Show enabled/disabled connections and prompt to continue or go back. Returns true to continue, false to go back. */
async function confirmConnectionsBeforeDockerBuild(): Promise<boolean> {
  const connections = getConnections();
  const enabled = connections.filter((c) => isConnectionEnabled(c));
  const disabled = connections.filter((c) => !isConnectionEnabled(c));

  console.log('\n--- Connections summary ---');
  if (enabled.length > 0) {
    console.log('Enabled (will be active in the container):');
    enabled.forEach((c) => {
      console.log(`  • ${c.name} (${c.type})`);
    });
  } else {
    console.log('Enabled (will be active in the container): none');
  }
  if (disabled.length > 0) {
    console.log('Disabled (will not be used by the container):');
    disabled.forEach((c) => {
      console.log(`  • ${c.name} (${c.type})`);
    });
  } else if (connections.length > 0) {
    console.log('Disabled: none');
  }
  if (connections.length === 0) {
    console.log('No connections configured.');
  }
  console.log('---\n');

  const answer = await inquirer.prompt<{ action: string }>({
    type: 'list',
    name: 'action',
    message: 'Continue with build?',
    choices: [
      { name: 'Continue', value: 'continue' },
      { name: 'Back to main menu', value: BACK_TO_MENU_VALUE },
    ],
  });
  return answer.action !== BACK_TO_MENU_VALUE;
}

async function runBuildDocker(): Promise<void> {
  if (!ensureDockerContext()) return;
  if (!(await confirmConnectionsBeforeDockerBuild())) return;
  console.log('Building Docker image (truss-agent:latest)...\n');
  try {
    execSync('docker build -t truss-agent:latest .', {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    console.log('\nBuild complete. Image: truss-agent:latest');
  } catch (err) {
    console.error('Docker build failed:', err instanceof Error ? err.message : err);
  }
}

async function runBuildAndRunDockerCompose(): Promise<void> {
  const cwd = process.cwd();
  const composeFile = path.join(cwd, 'docker-compose.yml');
  if (!fs.existsSync(composeFile)) {
    console.error('docker-compose.yml not found in current directory. Run this from the truss-agent project root.');
    return;
  }
  if (!(await confirmConnectionsBeforeDockerBuild())) return;
  console.log('Building and starting with docker compose (detached/background)...\n');
  try {
    execSync('docker compose up --build -d', {
      stdio: 'inherit',
      cwd,
    });
    console.log('\nContainer is running in the background. Use "docker compose logs -f" to follow logs or "docker compose down" to stop.');
  } catch (err) {
    console.error('Docker compose failed:', err instanceof Error ? err.message : err);
  }
}

async function runResetAll(): Promise<void> {
  const confirm = await inquirer.prompt<{ ok: boolean }>({
    type: 'confirm',
    name: 'ok',
    message:
      'This will reset ALL configuration (agent name, .env, connections, jobs). It is essentially a factory reset and cannot be undone. Are you sure?',
    default: false,
  });
  if (!confirm.ok) return;

  await inquirer.prompt<{ confirmReset: string }>({
    type: 'input',
    name: 'confirmReset',
    message: 'Type "reset" to confirm:',
    validate: (input: string) =>
      input.trim().toLowerCase() === 'reset' ? true : 'Type "reset" to confirm',
  });

  deleteAgentConfigFile(AGENT_FILE);
  clearEnvFile();
  saveConnections(CONNECTIONS_FILE, []);
  if (JOBS_FILE) {
    saveJobs(JOBS_FILE, []);
  }
  console.log('All configuration has been reset (.env cleared, connections and jobs cleared).');
}

export async function runConfigCommand(): Promise<void> {
  console.log('Truss Agent – Connection configuration\n');
  let running = true;
  while (running) {
    const menuChoices = getMainMenuChoices();
    const answer = await inquirer.prompt<{ action: MainMenuChoice }>({
      type: 'list',
      name: 'action',
      message: 'What do you want to do?',
      choices: menuChoices,
      pageSize: menuChoices.length,
      loop: true,
    });
    switch (answer.action) {
      case 'setup':
        await runFirstTimeSetup();
        break;
      case 'create':
        await runCreate();
        break;
      case 'modify':
        await runModify();
        break;
      case 'test':
        await runTest();
        break;
      case 'testTrussToDiscord':
        await runTestTrussToDiscord();
        break;
      case 'list':
        await runListConnections();
        break;
      case 'enableDisable':
        await runEnableDisableConnection();
        break;
      case 'delete':
        await runDeleteConnection();
        break;
      case 'reset':
        await runResetAll();
        break;
      case 'buildDocker':
        await runBuildDocker();
        break;
      case 'buildRunDockerCompose':
        await runBuildAndRunDockerCompose();
        break;
      case 'exit':
        running = false;
        break;
    }
  }
  console.log('Done.');
}
