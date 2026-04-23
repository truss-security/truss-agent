import type { SecurityIndicator, ApiSearchFilter } from '../../models/types';
import type { ConnectionDisplay } from '../types';
import {
  sendTextToTeams,
  sendReportToTeams,
  sendExecSummaryToTeams,
} from '../../adapters/output/ms-teams';

export async function sendText(webhookUrl: string, text: string): Promise<void> {
  await sendTextToTeams(webhookUrl, text);
}

export async function sendReport(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  await sendReportToTeams(webhookUrl, indicators, connectionDisplay);
}

export async function sendExecSummary(
  webhookUrl: string,
  indicators: SecurityIndicator[],
  filter?: ApiSearchFilter,
  connectionDisplay?: ConnectionDisplay | null
): Promise<void> {
  await sendExecSummaryToTeams(webhookUrl, indicators, filter, connectionDisplay);
}
