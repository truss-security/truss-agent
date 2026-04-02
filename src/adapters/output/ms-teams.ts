import axios from 'axios';
import { logger } from '../../utils/logger';
import type { SecurityIndicator } from '../../models/types';
import { formatExecSummaryHeaderLines, getExecSummaryData } from '../../formatters/exec-summary-formatter';
import { formatIndicatorsAsReport } from '../../formatters/metadata-formatter';
import type { ConnectionDisplay } from '../../connections/types';
import type { ApiSearchFilter } from '../../models/types';

/**
 * Microsoft Learn: incoming webhook **entire JSON body** must be ≤ 28 KB or the request fails.
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
 * Connectors are also throttled (e.g. max 4 requests per second); use backoff on 429.
 */
const TEAMS_WEBHOOK_PAYLOAD_MAX_BYTES = 28 * 1024;
/** Headroom below {@link TEAMS_WEBHOOK_PAYLOAD_MAX_BYTES} for JSON escaping and UTF-8 expansion. */
const TEAMS_WEBHOOK_SAFE_MAX_BYTES = TEAMS_WEBHOOK_PAYLOAD_MAX_BYTES - 2 * 1024;

/** Build MS Teams Adaptive Card message payload (incoming webhook shape). */
function buildTeamsMessage(text: string): object {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.2',
          body: [
            {
              type: 'TextBlock',
              text,
              wrap: true,
            },
          ],
        },
      },
    ],
  };
}

/** UTF-8 size of the JSON body Teams receives for this text (for tests / diagnostics). */
export function teamsOutgoingWebhookPayloadByteLength(text: string): number {
  return Buffer.byteLength(JSON.stringify(buildTeamsMessage(text)), 'utf8');
}

/** Split text so each part’s full webhook JSON stays under Teams’ 28 KB limit. */
export function chunkTextForTeamsWebhook(text: string): string[] {
  if (teamsOutgoingWebhookPayloadByteLength(text) <= TEAMS_WEBHOOK_SAFE_MAX_BYTES) {
    return [text];
  }
  const lines = text.split('\n');
  const out: string[] = [];
  let cur = '';
  const fits = (s: string) => teamsOutgoingWebhookPayloadByteLength(s) <= TEAMS_WEBHOOK_SAFE_MAX_BYTES;

  for (const line of lines) {
    const next = cur ? `${cur}\n${line}` : line;
    if (fits(next)) {
      cur = next;
      continue;
    }
    if (cur) {
      out.push(cur);
      cur = '';
    }
    if (fits(line)) {
      cur = line;
    } else {
      out.push(...splitLongLineForTeamsWebhook(line, fits));
    }
  }
  if (cur) out.push(cur);
  return out;
}

function splitLongLineForTeamsWebhook(line: string, fits: (s: string) => boolean): string[] {
  const parts: string[] = [];
  let i = 0;
  while (i < line.length) {
    let low = i + 1;
    let high = line.length;
    let best = i;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const sub = line.slice(i, mid);
      if (fits(sub)) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (best <= i) {
      parts.push(line.slice(i, i + 1));
      i += 1;
    } else {
      parts.push(line.slice(i, best));
      i = best;
    }
  }
  return parts;
}

/** Send plain text to MS Teams via incoming webhook (multiple posts if payload would exceed 28 KB). */
export async function sendTextToTeams(webhookUrl: string, text: string): Promise<void> {
  if (!text || !text.trim()) return;
  const chunks = chunkTextForTeamsWebhook(text.trim());
  for (const chunk of chunks) {
    const payload = buildTeamsMessage(chunk);
    try {
      await axios.post(webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (status: number) => status === 200,
      });
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        logger.error(
          { status: error.response?.status, data: error.response?.data, webhookUrl },
          'MS Teams webhook request failed'
        );
      } else {
        logger.error({ err: error, webhookUrl }, 'MS Teams webhook failed');
      }
      throw error;
    }
  }
}

/** Send metadata/report as text to MS Teams. */
export async function sendReportToTeams(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  if (!indicators.length) return;
  const header =
    connectionDisplay?.name?.trim() &&
    [
      connectionDisplay.description?.trim()
        ? `${connectionDisplay.name.trim()} — ${connectionDisplay.description.trim()}`
        : connectionDisplay.name.trim(),
      connectionDisplay.filterSummary?.trim() ? `Filter: ${connectionDisplay.filterSummary.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  const body = formatIndicatorsAsReport(indicators);
  const text = header ? `${header}\n\n${body}` : body;
  await sendTextToTeams(webhookUrl, text);
}

/** Send executive summary as text to MS Teams. */
export async function sendExecSummaryToTeams(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  filter?: ApiSearchFilter,
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  if (!indicators.length) return;
  const intro = formatExecSummaryHeaderLines(connectionDisplay ?? null, 'plain');
  const data = getExecSummaryData(indicators, filter);
  const body = [
    data.reportTitle,
    '',
    ...(intro.length > 0 ? [...intro, ''] : []),
    `Timeframe: ${data.timeframe}`,
    `Findings: ${data.numberOfFindings}`,
    `Filters: ${data.filtersUsed}`,
    '',
    `▸ Commonality`,
    data.commonality,
    '',
    ...data.top5.categories.map((r, i) => `${i + 1}. ${r.name} (${r.count})`),
  ].join('\n');
  await sendTextToTeams(webhookUrl, body);
}
