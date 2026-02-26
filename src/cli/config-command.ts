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
import { loadJobs, saveJobs, type Job } from '../config/jobs';
import {
  loadAgentConfig,
  saveAgentConfig,
  updateEnvFile,
  clearEnvFile,
  deleteAgentConfigFile,
} from '../config/agent';
import type { ApiSearchFilter } from '../models/types';
import TrussApi from '../adapters/input/truss-api';
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

function parseCommaList(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const FILTER_KEYS = [
  'category',
  'source',
  'author',
  'industry',
  'region',
  'reference',
  'tags',
  'indicators',
] as const;

function ensureStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : String(v))).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return parseCommaList(value);
  }
  return [];
}

/**
 * Extract the request body (filter object) from pasted Truss API code or raw JSON.
 * Handles: raw JSON, Python requests.post(..., json={...}), JS fetch(..., body: ...), etc.
 */
function extractQueryFromPaste(pasted: string): ApiSearchFilter | null {
  const trimmed = pasted.trim();
  if (!trimmed) return null;

  let jsonStr: string | null = null;

  if (trimmed.startsWith('{')) {
    jsonStr = extractBracedObject(trimmed, 0);
  } else {
    const jsonMatch = trimmed.match(/\bjson\s*=\s*(\{)/i) ?? trimmed.match(/\bbody\s*:\s*(\{)/i);
    if (jsonMatch && jsonMatch.index != null) {
      const start = jsonMatch.index + jsonMatch[1].length - 1;
      jsonStr = extractBracedObject(trimmed, start);
    } else {
      const firstBrace = trimmed.indexOf('{');
      if (firstBrace >= 0) jsonStr = extractBracedObject(trimmed, firstBrace);
    }
  }

  if (!jsonStr) return null;
  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    const filter: ApiSearchFilter = {};
    for (const key of FILTER_KEYS) {
      const arr = ensureStringArray(data[key]);
      if (arr.length > 0) (filter as Record<string, string[]>)[key] = arr;
    }
    if (typeof data.startDate === 'string' || typeof data.startDate === 'number') {
      filter.startDate = data.startDate;
    }
    if (typeof data.endDate === 'string' || typeof data.endDate === 'number') {
      filter.endDate = data.endDate;
    }
    if (Object.keys(filter).length === 0) return null;
    return filter;
  } catch {
    return null;
  }
}

function extractBracedObject(s: string, startIndex: number): string | null {
  if (s[startIndex] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = '';
  for (let i = startIndex; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if ((c === '"' || c === "'") && !inString) {
      inString = true;
      quote = c;
      continue;
    }
    if (c === quote && inString) {
      inString = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(startIndex, i + 1);
    }
  }
  return null;
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

async function promptTrussQueryAndSchedule(_connectionName: string): Promise<{
  configName?: string;
  filter?: ApiSearchFilter;
  windowDays?: number;
  windowMinutes?: number;
  schedule: string | number;
  outputFormat: 'ioc' | 'report' | 'summary';
} | null> {
  const add = await inquirer.prompt<{ add: boolean }>({
    type: 'confirm',
    name: 'add',
    message: 'Add a Truss query and pull frequency for this connection?',
    default: true,
  });
  if (!add.add) return null;

  const querySource = await inquirer.prompt<{ source: 'configName' | 'filter' }>({
    type: 'list',
    name: 'source',
    message: 'How do you want to define what the agent pulls from Truss?',
    choices: [
      {
        name: 'Use a Truss API config name (saved in Truss dashboard/integration)',
        value: 'configName',
      },
      {
        name: 'Define filter here (category, source, time window)',
        value: 'filter',
      },
    ],
  });

  let configName: string | undefined;
  let filter: ApiSearchFilter | undefined;
  let windowDays: number | undefined;

  if (querySource.source === 'configName') {
    const a = await inquirer.prompt<{ configName: string }>({
      type: 'input',
      name: 'configName',
      message: 'Truss API config name:',
      validate: (input: string) => (input.trim() ? true : 'Config name is required'),
    });
    configName = a.configName.trim();
  } else {
    const editorChoice = await inquirer.prompt<{ editor: 'vim' | 'nano' }>({
      type: 'list',
      name: 'editor',
      message: 'Which editor do you want to use to paste the query?',
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
          'Paste Truss API query (full JSON or code snippet). Press Enter to open editor, then paste your query, save and close:',
        default: '',
      },
    ]);
    if (previousEditor !== undefined) process.env.EDITOR = previousEditor;
    else delete process.env.EDITOR;
    const pasted = (pasteAnswer.pasted ?? '').trim();
    let extracted: ApiSearchFilter | null = null;
    if (pasted) {
      extracted = extractQueryFromPaste(pasted);
      if (extracted) {
        const count = Object.keys(extracted).filter((k) => FILTER_KEYS.includes(k as (typeof FILTER_KEYS)[number])).length;
        console.log(`Extracted filter with ${count} field(s).`);
      } else {
        console.log('Could not parse query from paste; you can enter filters manually.');
      }
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
        message: 'Pull data from the last N days (e.g. 1, 7, 30). For interval schedule (e.g. 10 min), query window = run interval to avoid duplicates:',
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
        message: 'Industry (comma-separated; e.g. Cryptocurrency, Financial Services, Banking, Web3, Blockchain; optional):',
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
    windowDays = parseInt(a.lastDays.trim(), 10) || 7;
    filter = {
      ...(parseCommaList(a.category).length > 0 && { category: parseCommaList(a.category) }),
      ...(parseCommaList(a.source).length > 0 && { source: parseCommaList(a.source) }),
      ...(parseCommaList(a.author).length > 0 && { author: parseCommaList(a.author) }),
      ...(parseCommaList(a.region).length > 0 && { region: parseCommaList(a.region) }),
      ...(parseCommaList(a.industry).length > 0 && { industry: parseCommaList(a.industry) }),
      ...(parseCommaList(a.reference).length > 0 && { reference: parseCommaList(a.reference) }),
      ...(parseCommaList(a.tags).length > 0 && { tags: parseCommaList(a.tags) }),
      ...(parseCommaList(a.indicators).length > 0 && { indicators: parseCommaList(a.indicators) }),
    };
    }
  }

  const answers = await inquirer.prompt<{
    scheduleInput: string;
    outputFormat: 'ioc' | 'report' | 'summary';
  }>([
    {
      type: 'input',
      name: 'scheduleInput',
      message:
        'Pull frequency (how often + how far back): e.g. 5m, 45m, 1h, 24h, 7d, 1day (any number + m/min/h/hour/d/day), plain minutes, or cron (e.g. "0 */6 * * *"):',
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
    {
      type: 'list',
      name: 'outputFormat',
      message: 'Output format:',
      choices: [
        { name: 'IOC only', value: 'ioc' },
        { name: 'Metadata (awareness)', value: 'report' },
        { name: 'Report (exec summary)', value: 'summary' },
      ],
    },
  ]);

  const schedule = parseSchedule(answers.scheduleInput);
  let windowMinutes: number | undefined;
  let finalWindowDays: number | undefined = windowDays;

  if (typeof schedule === 'number') {
    windowMinutes = schedule;
    finalWindowDays = undefined;
    console.log(`Using interval: every ${schedule} min(s), pulling last ${schedule} min(s).`);
  } else {
    const w = await inquirer.prompt<{ windowMinutes: string }>({
      type: 'input',
      name: 'windowMinutes',
      message: `For each run, how far back to pull? Minutes (e.g. 360) or leave blank for ${windowDays ?? 7} day(s):`,
      default: '',
    });
    const parsed = parseInt(w.windowMinutes.trim(), 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      windowMinutes = parsed;
      finalWindowDays = undefined;
    }
  }

  return {
    configName,
    filter,
    windowDays: finalWindowDays,
    windowMinutes,
    schedule,
    outputFormat: answers.outputFormat,
  };
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
  let conn = await module.promptCreate(getConnections);
  const connections = getConnections();
  connections.push(conn);
  saveConnections(CONNECTIONS_FILE, connections);
  console.log(`Saved connection "${conn.name}".`);

  const queryAndSchedule = await promptTrussQueryAndSchedule(conn.name);
  if (queryAndSchedule) {
    const query: ConnectionQuery = {
      ...(queryAndSchedule.configName ? { configName: queryAndSchedule.configName } : {}),
      ...(queryAndSchedule.filter ? { filter: queryAndSchedule.filter as Record<string, string | number | string[]> } : {}),
      ...(queryAndSchedule.windowDays != null ? { windowDays: queryAndSchedule.windowDays } : {}),
      ...(queryAndSchedule.windowMinutes != null ? { windowMinutes: queryAndSchedule.windowMinutes } : {}),
    };
    conn = { ...conn, query };
    const updatedConnections = getConnections().map((c) => (c.name === conn.name ? conn : c));
    saveConnections(CONNECTIONS_FILE, updatedConnections);
    console.log('Connection query saved to config/connections.json.');

    const jobsJson = (config.get('jobs.jobsJson') as string)?.trim();
    if (jobsJson) {
      console.log('Jobs are set via JOBS_JSON; add a job manually that uses connectionName:', conn.name);
    } else if (JOBS_FILE) {
      const existingJobs = getJobsFromFile();
      const jobName = conn.name;
      const newJob: Job = {
        name: jobName,
        connectionName: conn.name,
        schedule: queryAndSchedule.schedule,
        outputFormat: queryAndSchedule.outputFormat,
        ...(queryAndSchedule.configName ? { configName: queryAndSchedule.configName } : {}),
        ...(queryAndSchedule.filter ? { filter: queryAndSchedule.filter } : {}),
        ...(queryAndSchedule.windowDays != null ? { windowDays: queryAndSchedule.windowDays } : {}),
        ...(queryAndSchedule.windowMinutes != null ? { windowMinutes: queryAndSchedule.windowMinutes } : {}),
      };
      saveJobs(JOBS_FILE, [...existingJobs, newJob]);
      console.log(`Added job "${jobName}" with the given query and frequency.`);
    }
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
        name: `${c.name} (${c.type}${c.channelLabel ? ` ${c.channelLabel}` : ''})`,
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
  const updated = await module.promptModify(existing);
  const next = connections.map((c) => (c.name === existing.name ? updated : c));
  saveConnections(CONNECTIONS_FILE, next);
  console.log(`Updated connection "${updated.name}".`);
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
        name: `${c.name} (${c.type}${c.channelLabel ? ` ${c.channelLabel}` : ''}) – ${isConnectionEnabled(c) ? 'enabled' : 'disabled'}`,
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
      { name: 'Metadata (title, author, category, etc.)', value: 'report' },
      { name: 'Report (exec summary)', value: 'summary' },
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

  if (formatChoice.format === 'report') {
    console.log(`\nWill send ${indicators.length} metadata embed(s) (rich cards with title, author, category, source, date, references, tags, IOC types and counts).`);
  } else if (formatChoice.format === 'summary') {
    const summary = buildExecSummary(indicators, filter);
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
  const connectionDisplay = {
    name: conn.name,
    description: conn.description,
    filterSummary: formatFiltersUsed(filter),
  };
  const module = getModule(conn.type);
  if (!module) return;
  try {
    if (formatChoice.format === 'report') {
      await module.sendReport(webhookUrl, indicators, connectionDisplay);
    } else if (formatChoice.format === 'summary') {
      await module.sendExecSummary(webhookUrl, indicators, filter, connectionDisplay);
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
    const channel = c.channelLabel ? ` ${c.channelLabel}` : '';
    const webhook = maskWebhookUrl(c.webhookUrl);
    const status = isConnectionEnabled(c) ? 'enabled' : 'disabled';
    const queryJson =
      c.query != null && typeof c.query === 'object' && Object.keys(c.query).length > 0
        ? JSON.stringify(c.query)
        : '{}';
    console.log(`  ${c.name} (${c.type}${channel})  ${status}  webhook: ${webhook}`);
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
      name: `${c.name} (${c.type}) ${c.channelLabel ? ` – ${c.channelLabel}` : ''}`,
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
        name: `${c.name} (${c.type}${c.channelLabel ? ` ${c.channelLabel}` : ''})`,
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
      message: `"${choice.connection}" is used by ${jobsUsing.length} job(s). Remove connection anyway? (You will need to update or remove those jobs.)`,
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
      const channel = c.channelLabel ? ` ${c.channelLabel}` : '';
      console.log(`  • ${c.name} (${c.type}${channel})`);
    });
  } else {
    console.log('Enabled (will be active in the container): none');
  }
  if (disabled.length > 0) {
    console.log('Disabled (will not be used by the container):');
    disabled.forEach((c) => {
      const channel = c.channelLabel ? ` ${c.channelLabel}` : '';
      console.log(`  • ${c.name} (${c.type}${channel})`);
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
  console.log('Building and starting with docker compose (Ctrl+C to stop)...\n');
  try {
    execSync('docker compose up --build', {
      stdio: 'inherit',
      cwd,
    });
  } catch (err) {
    if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 130) {
      console.log('\nStopped by user.');
    } else {
      console.error('Docker compose failed:', err instanceof Error ? err.message : err);
    }
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
      loop: false,
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
