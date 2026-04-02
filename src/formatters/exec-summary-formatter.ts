import type { SecurityIndicator, ApiSearchFilter } from '../models/types';
import type { ConnectionDisplay } from '../connections/types';

const REPORT_TITLE = 'Executive Summary';

function formatDateRange(start?: string | number, end?: string | number): string {
  if (!start && !end) return '—';
  const fmt = (v: string | number) => {
    if (typeof v === 'number') return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    try {
      return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return String(v);
    }
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  return start ? `From ${fmt(start)}` : `Through ${fmt(end!)}`;
}

const MAX_FILTER_EXPRESSION_LEN = 200;

/** Human-readable filter summary for display in embeds and reports. */
export function formatFiltersUsed(filter: ApiSearchFilter | undefined): string {
  if (!filter) return 'As per job/connection query';
  const parts: string[] = [];
  if (filter.filterExpression?.trim()) {
    const expr = filter.filterExpression.trim();
    parts.push(
      expr.length > MAX_FILTER_EXPRESSION_LEN
        ? `FilterQL: ${expr.slice(0, MAX_FILTER_EXPRESSION_LEN)}…`
        : `FilterQL: ${expr}`
    );
  }
  if (filter.category?.length) parts.push(`Category: ${filter.category.join(', ')}`);
  if (filter.source?.length) parts.push(`Source: ${filter.source.join(', ')}`);
  if (filter.author?.length) parts.push(`Author: ${filter.author.join(', ')}`);
  if (filter.industry?.length) parts.push(`Industry: ${filter.industry.join(', ')}`);
  if (filter.region?.length) parts.push(`Region: ${filter.region.join(', ')}`);
  if (filter.tags?.length) parts.push(`Tags: ${filter.tags.join(', ')}`);
  if (filter.indicators?.length) parts.push(`Indicator types: ${filter.indicators.join(', ')}`);
  return parts.length > 0 ? parts.join(' | ') : 'As per job/connection query';
}

export type ExecSummaryHeaderMarkdown = 'discord' | 'slack' | 'plain';

function execSummaryBoldLabel(label: string, md: ExecSummaryHeaderMarkdown): string {
  if (md === 'discord') return `**${label}**`;
  if (md === 'slack') return `*${label}*`;
  return label;
}

/**
 * Exec summary header lines (Description, Truss Agent Job Name). Omits filter — use data.filtersUsed once below Findings.
 * Uses jobName when set; otherwise connection name for CLI test flows.
 */
export function formatExecSummaryHeaderLines(
  connectionDisplay?: ConnectionDisplay | null,
  md: ExecSummaryHeaderMarkdown = 'discord'
): string[] {
  if (!connectionDisplay) return [];
  const lines: string[] = [];
  const desc = connectionDisplay.description?.trim();
  if (desc) lines.push(`${execSummaryBoldLabel('Description:', md)} ${desc}`);
  const job = connectionDisplay.jobName?.trim() ?? connectionDisplay.name?.trim();
  if (job) lines.push(`${execSummaryBoldLabel('Truss Agent Job Name:', md)} ${job}`);
  return lines;
}

function topN<T>(counts: Map<string, number>, n: number): Array<{ name: string; count: number }> {
  return [...counts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function formatTop5(label: string, items: Array<{ name: string; count: number }>): string {
  if (items.length === 0) return `${label}: —`;
  return `${label}:\n${items.map((r, i) => `  ${i + 1}. ${r.name} (${r.count})`).join('\n')}`;
}

/** Aggregation counts and top-5 lists for Discord embed or text report. */
export interface ExecSummaryData {
  reportTitle: string;
  filtersUsed: string;
  timeframe: string;
  numberOfFindings: number;
  commonality: string;
  top5: {
    categories: Array<{ name: string; count: number }>;
    authors: Array<{ name: string; count: number }>;
    sources: Array<{ name: string; count: number }>;
    tags: Array<{ name: string; count: number }>;
    regions: Array<{ name: string; count: number }>;
    industries: Array<{ name: string; count: number }>;
    indicatorTypes: Array<{ name: string; count: number }>;
  };
}

function aggregateTop5(indicators: SecurityIndicator[]): ExecSummaryData['top5'] & { uniq: ExecSummaryData['commonality'] } {
  const categories = new Map<string, number>();
  const authors = new Map<string, number>();
  const sources = new Map<string, number>();
  const tags = new Map<string, number>();
  const regions = new Map<string, number>();
  const industries = new Map<string, number>();
  const indicatorTypes = new Map<string, number>();

  for (const item of indicators) {
    if (item.category) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
    for (const a of item.author ?? []) {
      if (a?.trim()) authors.set(a.trim(), (authors.get(a.trim()) ?? 0) + 1);
    }
    if (item.source) sources.set(item.source, (sources.get(item.source) ?? 0) + 1);
    for (const t of item.tags ?? []) {
      if (t?.trim()) tags.set(t.trim(), (tags.get(t.trim()) ?? 0) + 1);
    }
    for (const r of item.region ?? []) {
      if (r?.trim()) regions.set(r.trim(), (regions.get(r.trim()) ?? 0) + 1);
    }
    for (const i of item.industry ?? []) {
      if (i?.trim()) industries.set(i.trim(), (industries.get(i.trim()) ?? 0) + 1);
    }
    if (item.indicators && typeof item.indicators === 'object') {
      for (const k of Object.keys(item.indicators)) {
        const v = item.indicators[k];
        if (v != null && (Array.isArray(v) ? v.length > 0 : true)) {
          indicatorTypes.set(k, (indicatorTypes.get(k) ?? 0) + 1);
        }
      }
    }
  }

  const uniq = `Categories ${categories.size} · Authors ${authors.size} · Sources ${sources.size} · Tags ${tags.size} · Regions ${regions.size} · Industries ${industries.size} · IOC types ${indicatorTypes.size}`;
  return {
    categories: topN(categories, 5),
    authors: topN(authors, 5),
    sources: topN(sources, 5),
    tags: topN(tags, 5),
    regions: topN(regions, 5),
    industries: topN(industries, 5),
    indicatorTypes: topN(indicatorTypes, 5),
    uniq,
  };
}

/**
 * Build structured exec summary data for embed or text.
 */
export function getExecSummaryData(
  indicators: SecurityIndicator[],
  filter?: ApiSearchFilter
): ExecSummaryData {
  const { uniq, ...top5 } = aggregateTop5(indicators);
  return {
    reportTitle: REPORT_TITLE,
    filtersUsed: formatFiltersUsed(filter),
    timeframe: formatDateRange(filter?.startDate, filter?.endDate),
    numberOfFindings: indicators.length,
    commonality: uniq,
    top5,
  };
}

/**
 * Build a high-level executive summary of all findings from an API query.
 * Optional header context matches Discord/Slack/Teams exec summary (description + job name, filter once after findings).
 */
export function buildExecSummary(
  indicators: SecurityIndicator[],
  filter?: ApiSearchFilter,
  headerContext?: Pick<ConnectionDisplay, 'name' | 'description' | 'jobName'> | null
): string {
  const data = getExecSummaryData(indicators, filter);
  const lines: string[] = [];

  lines.push(`**${data.reportTitle}**`);
  lines.push('');
  const intro = formatExecSummaryHeaderLines(headerContext ?? null);
  if (intro.length > 0) {
    lines.push(...intro);
    lines.push('');
  }
  lines.push('**Timeframe:** ' + data.timeframe);
  lines.push(`**Findings:** ${data.numberOfFindings}`);
  lines.push('**Filters:** ' + data.filtersUsed);
  lines.push('');
  lines.push('**▸ Commonality**');
  lines.push(data.commonality);
  lines.push('');
  lines.push('**Top 5 findings**');
  lines.push('');
  lines.push(formatTop5('Categories', data.top5.categories));
  lines.push('');
  lines.push(formatTop5('Authors', data.top5.authors));
  lines.push('');
  lines.push(formatTop5('Sources', data.top5.sources));
  lines.push('');
  lines.push(formatTop5('Tags', data.top5.tags));
  lines.push('');
  lines.push(formatTop5('Regions', data.top5.regions));
  lines.push('');
  lines.push(formatTop5('Industries', data.top5.industries));
  lines.push('');
  lines.push(formatTop5('Indicator types', data.top5.indicatorTypes));

  return lines.join('\n');
}
