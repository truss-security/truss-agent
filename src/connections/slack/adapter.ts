import type { SecurityIndicator, ApiSearchFilter } from '../../models/types';
import type { ConnectionDisplay } from '../types';
import {
  sendTextToSlack,
  sendReportToSlack,
  sendExecSummaryToSlack,
} from '../../adapters/output/slack';

export async function sendText(webhookUrl: string, text: string): Promise<void> {
  await sendTextToSlack(webhookUrl, text);
}

export async function sendReport(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  await sendReportToSlack(webhookUrl, indicators, connectionDisplay);
}

export async function sendExecSummary(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  filter?: ApiSearchFilter,
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  await sendExecSummaryToSlack(webhookUrl, indicators, filter, connectionDisplay);
}
