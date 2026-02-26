import type { DiscordConnection } from './discord';
import type { SlackConnection } from './slack';
import type { MSTeamsConnection } from './ms-teams';
import { discordConnectionModule } from './discord';
import { slackConnectionModule } from './slack';
import { msTeamsConnectionModule } from './ms-teams';
import { ConnectionRegistry } from './registry';

export type { ConnectionDisplay, ConnectionQuery, ConnectionBase, IConnectionModule } from './types';
export { ConnectionQuerySchema } from './types';

export type Connection = DiscordConnection | SlackConnection | MSTeamsConnection;

const connectionRegistry = new ConnectionRegistry<Connection>();
connectionRegistry.register(discordConnectionModule);
connectionRegistry.register(slackConnectionModule);
connectionRegistry.register(msTeamsConnectionModule);

export const ConnectionSchema = connectionRegistry.getConnectionSchema();
export const getConnectionTypes = connectionRegistry.getConnectionTypes.bind(connectionRegistry);
export const getModule = connectionRegistry.getModule.bind(connectionRegistry);
export const getWebhookUrl = connectionRegistry.getWebhookUrl.bind(connectionRegistry);

export { connectionRegistry };
