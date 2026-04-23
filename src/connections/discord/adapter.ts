import type { SecurityIndicator, ApiSearchFilter } from '../../models/types';
import type { ConnectionDisplay } from '../types';
import {
  sendTextToDiscord,
  sendReportToDiscord,
  sendExecSummaryToDiscord,
} from '../../adapters/output/discord';

export async function sendText(webhookUrl: string, text: string): Promise<void> {
  await sendTextToDiscord(webhookUrl, text);
}

export async function sendReport(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  await sendReportToDiscord(webhookUrl, indicators, connectionDisplay);
}

export async function sendExecSummary(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  filter?: ApiSearchFilter,
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  await sendExecSummaryToDiscord(webhookUrl, indicators, filter, connectionDisplay);
}
