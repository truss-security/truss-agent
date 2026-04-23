import { z } from 'zod';
import type { IConnectionModule } from '../types';
import type { SlackConnection } from './schema';
import { SlackConnectionSchema } from './schema';
import { promptCreateSlack, promptModifySlack } from './prompts';
import * as adapter from './adapter';

export type { SlackConnection } from './schema';
export { SlackConnectionSchema } from './schema';

const slackModule: IConnectionModule<SlackConnection> = {
  typeId: 'slack',
  label: 'Slack',
  schema: SlackConnectionSchema as z.ZodType<SlackConnection>,

  getWebhookUrl(connection: SlackConnection): string {
    return connection.webhookUrl;
  },

  async promptCreate(getConnections) {
    return promptCreateSlack(getConnections);
  },

  async promptModify(existing) {
    return promptModifySlack(existing);
  },

  sendText: adapter.sendText,
  sendReport: adapter.sendReport,
  sendExecSummary: adapter.sendExecSummary,
};

export const slackConnectionModule = slackModule;
