import axios from 'axios';
import { logger } from '../../utils/logger';
import type { SecurityIndicator } from '../../models/types';
import { getExecSummaryData, type ExecSummaryData } from '../../formatters/exec-summary-formatter';

const DISCORD_CONTENT_MAX_LENGTH = 2000;
const DISCORD_EMBEDS_PER_MESSAGE = 10;
const DISCORD_FIELD_VALUE_MAX = 1024;
const DISCORD_TITLE_MAX = 256;

export interface DiscordPayload {
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    url?: string;
    color?: number;
    fields?: Array< { name: string; value: string; inline?: boolean } >;
    footer?: { text: string };
    timestamp?: string;
  }>;
}

/** Format ISO date for display (e.g. "Feb 16, 2026"). */
function formatDisplayDate(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/** Truncate and escape for Discord (field value limit 1024). */
function truncateField(value: string, max: number = DISCORD_FIELD_VALUE_MAX): string {
  const s = value.trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + '…';
}

/** Build Discord embeds from indicators for a rich report. */
export function buildReportEmbeds(indicators: SecurityIndicator[]): DiscordPayload['embeds'] {
  const EMBED_COLOR = 0x5865f2; // Discord blurple

  return indicators.map((item) => {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

    if (item.author?.length) {
      fields.push({ name: 'Author', value: item.author.join(', '), inline: true });
    }
    if (item.category) {
      fields.push({ name: 'Category', value: item.category, inline: true });
    }
    if (item.source) {
      fields.push({ name: 'Source', value: item.source, inline: true });
    }
    fields.push({ name: 'Date', value: formatDisplayDate(item.pubDate), inline: true });

    if (item.reference?.length) {
      const reversed = [...item.reference].reverse();
      const url = reversed[0];
      fields.push({ name: 'References', value: truncateField(url), inline: false });
    }

    if (item.tags?.length) {
      fields.push({
        name: 'Tags',
        value: truncateField(item.tags.join(', ')),
        inline: false,
      });
    }

    const indicatorTypes = item.indicators
      ? Object.keys(item.indicators).filter((k) => {
          const v = item.indicators[k];
          return v != null && (Array.isArray(v) ? v.length > 0 : true);
        })
      : [];
    const indicatorCount = item.indicators
      ? Object.values(item.indicators).reduce(
          (sum, v) => sum + (Array.isArray(v) ? v.length : v != null ? 1 : 0),
          0
        )
      : 0;
    if (indicatorTypes.length > 0 || indicatorCount > 0) {
      const typeList = indicatorTypes.join(', ');
      const countText =
        indicatorTypes.length > 0 && indicatorCount > 0
          ? `${typeList} — ${indicatorTypes.length} type(s), ${indicatorCount} indicator(s)`
          : indicatorTypes.length > 0
            ? `${typeList} — ${indicatorTypes.length} type(s)`
            : `${indicatorCount} indicator(s)`;
      fields.push({
        name: 'IOC types',
        value: truncateField(countText),
        inline: true,
      });
    }

    const title = (item.title || 'Threat intelligence report').trim();
    const safeTitle = title.length > DISCORD_TITLE_MAX ? title.slice(0, DISCORD_TITLE_MAX - 1) + '…' : title;

    return {
      title: safeTitle,
      color: EMBED_COLOR,
      fields: fields.length > 0 ? fields : [{ name: '\u200b', value: 'No metadata', inline: false }],
      footer: { text: 'Truss Agent' },
      timestamp: item.pubDate || new Date().toISOString(),
    };
  });
}

/**
 * Post a payload to a Discord webhook URL.
 * If content exceeds Discord's 2000-char limit, sends multiple messages.
 */
export async function postToDiscord(webhookUrl: string, payload: DiscordPayload): Promise<void> {
  const messages = chunkPayload(payload);

  for (let i = 0; i < messages.length; i++) {
    const body = messages[i];
    try {
      const response = await axios.post(webhookUrl, body, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (status: number) => status >= 200 && status < 300,
      });
      if (response.status !== 200 && response.status !== 204) {
        logger.warn({ status: response.status, webhookUrl }, 'Discord webhook returned non-OK');
      }
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        logger.error(
          {
            status: error.response?.status,
            data: error.response?.data,
            webhookUrl,
          },
          'Discord webhook request failed'
        );
      } else {
        logger.error({ err: error, webhookUrl }, 'Discord webhook failed');
      }
      throw error;
    }
  }
}

/**
 * Send plain text to Discord. Chunks by 2000 chars and sends multiple messages if needed.
 */
export async function sendTextToDiscord(webhookUrl: string, text: string): Promise<void> {
  if (!text || !text.trim()) {
    return;
  }
  const chunks = chunkText(text, DISCORD_CONTENT_MAX_LENGTH);
  for (const content of chunks) {
    await postToDiscord(webhookUrl, { content });
  }
}

/**
 * Send indicators as rich Discord embeds (one embed per indicator). Chunks into messages of 10 embeds each.
 */
export async function sendReportToDiscord(
  webhookUrl: string,
  indicators: SecurityIndicator[]
): Promise<void> {
  if (!indicators.length) return;
  const embeds = buildReportEmbeds(indicators) ?? [];
  for (let i = 0; i < embeds.length; i += DISCORD_EMBEDS_PER_MESSAGE) {
    const slice = embeds.slice(i, i + DISCORD_EMBEDS_PER_MESSAGE);
    await postToDiscord(webhookUrl, { embeds: slice });
  }
}

const EXEC_SUMMARY_COLOR = 0x1e3a5f; // Dark blue, report-style

function formatTop5Value(items: Array<{ name: string; count: number }>): string {
  if (items.length === 0) return '—';
  return items.map((r, i) => `${i + 1}. ${r.name} (${r.count})`).join('\n');
}

/**
 * Build a single Discord embed for the executive summary (official report style).
 */
export function buildExecSummaryEmbed(data: ExecSummaryData): DiscordPayload['embeds'] {
  const description = [
    `**Timeframe:** ${data.timeframe}`,
    `**Findings:** ${data.numberOfFindings}`,
    `**Filters:** ${data.filtersUsed}`,
  ].join('\n');

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: '▸ Commonality', value: data.commonality, inline: false },
    { name: 'Categories', value: formatTop5Value(data.top5.categories), inline: true },
    { name: 'Authors', value: formatTop5Value(data.top5.authors), inline: true },
    { name: 'Sources', value: formatTop5Value(data.top5.sources), inline: true },
    { name: 'Tags', value: formatTop5Value(data.top5.tags), inline: true },
    { name: 'Regions', value: formatTop5Value(data.top5.regions), inline: true },
    { name: 'Industries', value: formatTop5Value(data.top5.industries), inline: true },
    { name: 'Indicator types', value: formatTop5Value(data.top5.indicatorTypes), inline: true },
  ].map((f) => ({ ...f, value: truncateField(f.value) }));

  return [
    {
      title: 'Executive Summary',
      description: truncateField(description, 4096),
      color: EXEC_SUMMARY_COLOR,
      fields,
      footer: { text: 'Truss Agent · Threat Intelligence Report' },
      timestamp: new Date().toISOString(),
    },
  ];
}

/**
 * Send executive summary as a single professional Discord embed.
 */
export async function sendExecSummaryToDiscord(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  filter?: import('../../models/types').ApiSearchFilter
): Promise<void> {
  if (!indicators.length) return;
  const data = getExecSummaryData(indicators, filter);
  const embeds = buildExecSummaryEmbed(data) ?? [];
  await postToDiscord(webhookUrl, { embeds });
}

function chunkText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf('\n');
    const splitAt = lastNewline > maxLen / 2 ? lastNewline + 1 : maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}

function chunkPayload(payload: DiscordPayload): DiscordPayload[] {
  const out: DiscordPayload[] = [];
  if (payload.content && payload.content.length > DISCORD_CONTENT_MAX_LENGTH) {
    const textChunks = chunkText(payload.content, DISCORD_CONTENT_MAX_LENGTH);
    textChunks.forEach((content) => out.push({ content }));
  } else {
    out.push(payload);
  }
  return out;
}
