import axios from 'axios';
import { logger } from '../../utils/logger';
import type { SecurityIndicator } from '../../models/types';
import { formatExecSummaryHeaderLines, getExecSummaryData } from '../../formatters/exec-summary-formatter';
import { formatIndicatorsAsReport } from '../../formatters/metadata-formatter';
import type { ConnectionDisplay } from '../../connections/types';
import type { ApiSearchFilter } from '../../models/types';
import { chunkTextByMaxLength } from '../../utils/chunk-text';

/**
 * Slack: max 40,000 characters per message `text` (incoming webhooks use the same cap).
 * @see https://api.slack.com/changelog/2018-04-truncating-really-long-messages
 * Incoming webhooks are also rate-limited (~1/s with short bursts).
 */
const SLACK_TEXT_MAX = 40000;

/** Send plain text to Slack via incoming webhook (multiple posts if over {@link SLACK_TEXT_MAX} chars). */
export async function sendTextToSlack(webhookUrl: string, text: string): Promise<void> {
  if (!text || !text.trim()) return;
  const chunks = chunkTextByMaxLength(text.trim(), SLACK_TEXT_MAX);
  for (const chunk of chunks) {
    try {
      await axios.post(webhookUrl, { text: chunk }, {
        headers: { 'Content-Type': 'application/json' },
        validateStatus: (status: number) => status === 200,
      });
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        logger.error(
          { status: error.response?.status, data: error.response?.data, webhookUrl },
          'Slack webhook request failed'
        );
      } else {
        logger.error({ err: error, webhookUrl }, 'Slack webhook failed');
      }
      throw error;
    }
  }
}

/** Send metadata/report as text to Slack. */
export async function sendReportToSlack(
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
  await sendTextToSlack(webhookUrl, text);
}

/** Send executive summary as text to Slack. */
export async function sendExecSummaryToSlack(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  filter?: ApiSearchFilter,
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  if (!indicators.length) return;
  const intro = formatExecSummaryHeaderLines(connectionDisplay ?? null, 'slack');
  const data = getExecSummaryData(indicators, filter);
  const body = [
    `*${data.reportTitle}*`,
    '',
    ...(intro.length > 0 ? [...intro, ''] : []),
    `*Timeframe:* ${data.timeframe}`,
    `*Findings:* ${data.numberOfFindings}`,
    `*Filters:* ${data.filtersUsed}`,
    '',
    `*▸ Commonality*`,
    data.commonality,
    '',
    ...data.top5.categories.map((r, i) => `${i + 1}. ${r.name} (${r.count})`),
  ].join('\n');
  await sendTextToSlack(webhookUrl, body);
}
