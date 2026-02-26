import { z } from 'zod';
import type { IConnectionModule } from '../types';
import type { MSTeamsConnection } from './schema';
import { MSTeamsConnectionSchema } from './schema';
import { promptCreateMSTeams, promptModifyMSTeams } from './prompts';
import * as adapter from './adapter';

export type { MSTeamsConnection } from './schema';
export { MSTeamsConnectionSchema } from './schema';

const msTeamsModule: IConnectionModule<MSTeamsConnection> = {
  typeId: 'ms-teams',
  label: 'MS Teams',
  schema: MSTeamsConnectionSchema as z.ZodType<MSTeamsConnection>,

  getWebhookUrl(connection: MSTeamsConnection): string {
    return connection.webhookUrl;
  },

  async promptCreate(getConnections) {
    return promptCreateMSTeams(getConnections);
  },

  async promptModify(existing) {
    return promptModifyMSTeams(existing);
  },

  sendText: adapter.sendText,
  sendReport: adapter.sendReport,
  sendExecSummary: adapter.sendExecSummary,
};

export const msTeamsConnectionModule = msTeamsModule;
