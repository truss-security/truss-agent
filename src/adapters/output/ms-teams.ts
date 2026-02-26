import axios from 'axios';
import { logger } from '../../utils/logger';
import type { SecurityIndicator } from '../../models/types';
import { getExecSummaryData } from '../../formatters/exec-summary-formatter';
import { formatIndicatorsAsReport } from '../../formatters/metadata-formatter';
import type { ConnectionDisplay } from '../../connections/types';
import type { ApiSearchFilter } from '../../models/types';

const TEAMS_TEXT_MAX = 40000;

/** Build MS Teams Adaptive Card message payload. */
function buildTeamsMessage(text: string): object {
  const safe = text.length > TEAMS_TEXT_MAX ? text.slice(0, TEAMS_TEXT_MAX - 3) + '…' : text;
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
              text: safe,
              wrap: true,
            },
          ],
        },
      },
    ],
  };
}

/** Send plain text to MS Teams via incoming webhook (Adaptive Card). */
export async function sendTextToTeams(webhookUrl: string, text: string): Promise<void> {
  if (!text || !text.trim()) return;
  const payload = buildTeamsMessage(text);
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
  const header =
    connectionDisplay?.name?.trim() &&
    [
      connectionDisplay.description?.trim()
        ? `${connectionDisplay.name.trim()} — ${connectionDisplay.description.trim()}`
        : connectionDisplay.name.trim(),
      connectionDisplay.filterSummary?.trim()
        ? `Filter: ${connectionDisplay.filterSummary.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  const data = getExecSummaryData(indicators, filter);
  const body = [
    data.reportTitle,
    '',
    `Timeframe: ${data.timeframe}`,
    `Findings: ${data.numberOfFindings}`,
    `Filters: ${data.filtersUsed}`,
    '',
    `Commonality: ${data.commonality}`,
    '',
    ...data.top5.categories.map((r, i) => `${i + 1}. ${r.name} (${r.count})`),
  ].join('\n');
  const text = header ? `${header}\n\n${body}` : body;
  await sendTextToTeams(webhookUrl, text);
}
