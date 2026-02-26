import { z } from 'zod';
import type { IConnectionModule } from '../types';
import type { DiscordConnection } from './schema';
import { DiscordConnectionSchema } from './schema';
import { promptCreateDiscord, promptModifyDiscord } from './prompts';
import * as adapter from './adapter';

export type { DiscordConnection } from './schema';
export { DiscordConnectionSchema } from './schema';

const discordModule: IConnectionModule<DiscordConnection> = {
  typeId: 'discord',
  label: 'Discord',
  schema: DiscordConnectionSchema as z.ZodType<DiscordConnection>,

  getWebhookUrl(connection: DiscordConnection): string {
    return connection.webhookUrl;
  },

  async promptCreate(getConnections) {
    return promptCreateDiscord(getConnections);
  },

  async promptModify(existing) {
    return promptModifyDiscord(existing);
  },

  sendText: adapter.sendText,
  sendReport: adapter.sendReport,
  sendExecSummary: adapter.sendExecSummary,

  getConfigName(connection: DiscordConnection): string | undefined {
    return connection.query?.configName;
  },
};

export const discordConnectionModule = discordModule;
