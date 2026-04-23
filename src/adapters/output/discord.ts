import axios from 'axios';
import { logger } from '../../utils/logger';
import type { SecurityIndicator } from '../../models/types';
import {
  formatExecSummaryHeaderLines,
  getExecSummaryData,
  type ExecSummaryData,
} from '../../formatters/exec-summary-formatter';
import type { ConnectionDisplay } from '../../connections/types';
import { chunkTextByMaxLength } from '../../utils/chunk-text';

const DISCORD_CONTENT_MAX_LENGTH = 2000;
/** Discord allows at most 10 embeds per message. */
const DISCORD_EMBEDS_PER_MESSAGE = 10;
/**
 * Discord: sum of characters in title, description, fields, footer, etc. across all embeds in one webhook
 * message must not exceed 6000. Stay under to allow encoding overhead.
 */
const DISCORD_MESSAGE_EMBEDS_CHAR_BUDGET = 5800;
const DISCORD_FIELD_VALUE_MAX = 1024;
const DISCORD_TITLE_MAX = 256;
const DISCORD_FOOTER_MAX = 2048;

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

export type DiscordEmbed = NonNullable<DiscordPayload['embeds']>[number];

/** Character count Discord applies toward the 6000-per-message embed budget (approx. their documented sum). */
function discordEmbedCharCount(embed: DiscordEmbed): number {
  let n = 0;
  if (embed.title) n += embed.title.length;
  if (embed.description) n += embed.description.length;
  if (embed.footer?.text) n += embed.footer.text.length;
  if (embed.timestamp) n += embed.timestamp.length;
  for (const f of embed.fields ?? []) {
    n += f.name.length + f.value.length;
  }
  return n;
}

/**
 * Split embeds into webhook messages: max 10 embeds each, combined character count under Discord's 6000 limit.
 */
export function chunkEmbedsForDiscordMessage(embeds: DiscordEmbed[]): DiscordEmbed[][] {
  const batches: DiscordEmbed[][] = [];
  let batch: DiscordEmbed[] = [];
  let batchChars = 0;

  for (const e of embeds) {
    const sz = discordEmbedCharCount(e);

    if (sz > DISCORD_MESSAGE_EMBEDS_CHAR_BUDGET) {
      if (batch.length > 0) {
        batches.push(batch);
        batch = [];
        batchChars = 0;
      }
      batches.push([e]);
      continue;
    }

    const overCount = batch.length >= DISCORD_EMBEDS_PER_MESSAGE;
    const overSize = batchChars + sz > DISCORD_MESSAGE_EMBEDS_CHAR_BUDGET;
    if ((overCount || overSize) && batch.length > 0) {
      batches.push(batch);
      batch = [];
      batchChars = 0;
    }

    batch.push(e);
    batchChars += sz;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

/**
 * Discord also caps a single embed at 6000 characters total. Shrink longest field values, then footer/description.
 */
function clampDiscordEmbedToMessageBudget(embed: DiscordEmbed): DiscordEmbed {
  if (discordEmbedCharCount(embed) <= DISCORD_MESSAGE_EMBEDS_CHAR_BUDGET) {
    return embed;
  }
  const fields = (embed.fields ?? []).map((f) => ({ ...f }));
  let e: DiscordEmbed = { ...embed, fields };

  for (let guard = 0; guard < 400 && discordEmbedCharCount(e) > DISCORD_MESSAGE_EMBEDS_CHAR_BUDGET; guard++) {
    const over = discordEmbedCharCount(e) - DISCORD_MESSAGE_EMBEDS_CHAR_BUDGET;
    let bestI = -1;
    let bestLen = 0;
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].value.length > bestLen) {
        bestLen = fields[i].value.length;
        bestI = i;
      }
    }
    if (bestI >= 0 && bestLen > 48) {
      const cut = Math.min(bestLen - 48, Math.max(over, 96));
      const newLen = Math.max(32, bestLen - cut);
      fields[bestI] = {
        ...fields[bestI],
        value: fields[bestI].value.slice(0, newLen - 1) + '…',
      };
      e = { ...e, fields: [...fields] };
      continue;
    }
    if (e.footer?.text && e.footer.text.length > 24) {
      const ft = e.footer.text;
      const newLen = Math.max(24, ft.length - Math.max(over, 48));
      e = { ...e, footer: { text: ft.slice(0, newLen - 1) + '…' } };
      continue;
    }
    if (e.description && e.description.length > 50) {
      const d = e.description;
      const newLen = Math.max(50, d.length - Math.max(over, 96));
      e = { ...e, description: d.slice(0, newLen - 1) + '…' };
      continue;
    }
    break;
  }
  return e;
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

/** Metadata cards: connection name, description, and filter at bottom in footer (Discord renders footer smaller). */
function formatMetadataFooterText(connectionDisplay?: ConnectionDisplay | null): string {
  if (!connectionDisplay?.name?.trim()) return 'Truss Agent';
  const name = connectionDisplay.name.trim();
  const desc = connectionDisplay.description?.trim();
  const filter = connectionDisplay.filterSummary?.trim();
  const parts = [name];
  if (desc) parts.push(desc);
  if (filter) parts.push(`Filter: ${filter}`);
  const text = parts.join(' · ');
  return text.length > DISCORD_FOOTER_MAX ? text.slice(0, DISCORD_FOOTER_MAX - 1) + '…' : text;
}

/** Build Discord embeds from indicators for a rich report (Metadata). Connection name, description, filter at bottom in footer (smaller). */
export function buildReportEmbeds(
  indicators: SecurityIndicator[],
  connectionDisplay?: ConnectionDisplay | null
): DiscordPayload['embeds'] {
  const EMBED_COLOR = 0x5865f2; // Discord blurple
  const footerText = formatMetadataFooterText(connectionDisplay);

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

    return clampDiscordEmbedToMessageBudget({
      title: safeTitle,
      color: EMBED_COLOR,
      fields: fields.length > 0 ? fields : [{ name: '\u200b', value: 'No metadata', inline: false }],
      footer: { text: footerText },
      timestamp: item.pubDate || new Date().toISOString(),
    });
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
  const chunks = chunkTextByMaxLength(text, DISCORD_CONTENT_MAX_LENGTH);
  for (const content of chunks) {
    await postToDiscord(webhookUrl, { content });
  }
}

/**
 * Send indicators as rich Discord embeds (one embed per indicator). Chunks by Discord limits: max 10 embeds
 * and max ~6000 characters combined per message (plus count-based chunking).
 * connectionDisplay is used in embed footer for Metadata and Report operations.
 */
export async function sendReportToDiscord(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  if (!indicators.length) return;
  const embeds = buildReportEmbeds(indicators, connectionDisplay) ?? [];
  const batches = chunkEmbedsForDiscordMessage(embeds);
  for (const slice of batches) {
    await postToDiscord(webhookUrl, { embeds: slice });
  }
}

const EXEC_SUMMARY_COLOR = 0x1e3a5f; // Dark blue, report-style

function formatTop5Value(items: Array<{ name: string; count: number }>): string {
  if (items.length === 0) return '—';
  return items.map((r, i) => `${i + 1}. ${r.name} (${r.count})`).join('\n');
}

/**
 * Build a single Discord embed for the executive summary (Report). Description + job name at top; filter only under **Filters:**.
 */
export function buildExecSummaryEmbed(
  data: ExecSummaryData,
  connectionDisplay?: ConnectionDisplay | null
): DiscordPayload['embeds'] {
  const intro = formatExecSummaryHeaderLines(connectionDisplay ?? null);
  const bodyLines = [
    `**Timeframe:** ${data.timeframe}`,
    `**Findings:** ${data.numberOfFindings}`,
    `**Filters:** ${data.filtersUsed}`,
  ];
  const description = (intro.length > 0 ? [...intro, '', ...bodyLines] : bodyLines).join('\n');

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

  const rawFooter = 'Truss Agent · Threat Intelligence Report';
  const footerText = rawFooter.length > DISCORD_FOOTER_MAX ? rawFooter.slice(0, DISCORD_FOOTER_MAX - 1) + '…' : rawFooter;

  return [
    clampDiscordEmbedToMessageBudget({
      title: 'Executive Summary',
      description: truncateField(description, 4096),
      color: EXEC_SUMMARY_COLOR,
      fields,
      footer: { text: footerText },
      timestamp: new Date().toISOString(),
    }),
  ];
}

/**
 * Send executive summary as a single professional Discord embed.
 * connectionDisplay is used in embed footer for Report operations.
 */
export async function sendExecSummaryToDiscord(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  filter?: import('../../models/types').ApiSearchFilter,
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  if (!indicators.length) return;
  const data = getExecSummaryData(indicators, filter);
  const embeds = buildExecSummaryEmbed(data, connectionDisplay) ?? [];
  await postToDiscord(webhookUrl, { embeds });
}

function chunkPayload(payload: DiscordPayload): DiscordPayload[] {
  const out: DiscordPayload[] = [];
  if (payload.content && payload.content.length > DISCORD_CONTENT_MAX_LENGTH) {
    const textChunks = chunkTextByMaxLength(payload.content, DISCORD_CONTENT_MAX_LENGTH);
    textChunks.forEach((content) => out.push({ content }));
  } else {
    out.push(payload);
  }
  return out;
}
