import inquirer from 'inquirer';
import type { MSTeamsConnection } from './schema';

export async function promptCreateMSTeams(getConnections: () => unknown[]): Promise<MSTeamsConnection> {
  const connections = getConnections() as { name: string }[];
  const answers = await inquirer.prompt<{
    name: string;
    description: string;
    webhookUrl: string;
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Connection name (e.g. teams-alerts):',
      validate: (input: string) => {
        if (!input.trim()) return 'Name is required';
        if (connections.some((c) => c.name === input.trim())) {
          return 'A connection with this name already exists';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description (used in Metadata and Report sends, optional):',
      default: '',
    },
    {
      type: 'input',
      name: 'webhookUrl',
      message: 'MS Teams incoming webhook URL (Connector settings for the channel):',
      validate: (input: string) => {
        if (!input.trim()) return 'Webhook URL is required';
        try {
          new URL(input.trim());
          return true;
        } catch {
          return 'Enter a valid URL';
        }
      },
    },
  ]);
  return {
    name: answers.name.trim(),
    type: 'ms-teams',
    description: answers.description.trim() || undefined,
    webhookUrl: answers.webhookUrl.trim(),
    enabled: false,
  };
}

export async function promptModifyMSTeams(existing: MSTeamsConnection): Promise<MSTeamsConnection> {
  const answers = await inquirer.prompt<{
    name: string;
    description: string;
    webhookUrl: string;
    enabled: boolean;
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Connection name:',
      default: existing.name,
      validate: (input: string) => (input.trim() ? true : 'Name is required'),
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description (optional):',
      default: existing.description ?? '',
    },
    {
      type: 'input',
      name: 'webhookUrl',
      message: 'MS Teams webhook URL:',
      default: existing.webhookUrl,
      validate: (input: string) => {
        if (!input.trim()) return 'Webhook URL is required';
        try {
          new URL(input.trim());
          return true;
        } catch {
          return 'Enter a valid URL';
        }
      },
    },
    {
      type: 'confirm',
      name: 'enabled',
      message: 'Enabled (jobs will send to this connection)?',
      default: existing.enabled !== false,
    },
  ]);
  return {
    name: answers.name.trim(),
    type: 'ms-teams',
    description: answers.description.trim() || undefined,
    webhookUrl: answers.webhookUrl.trim(),
    enabled: answers.enabled,
    query: existing.query,
  };
}
