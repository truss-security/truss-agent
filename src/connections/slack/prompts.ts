import inquirer from 'inquirer';
import type { SlackConnection } from './schema';

export async function promptCreateSlack(getConnections: () => unknown[]): Promise<SlackConnection> {
  const connections = getConnections() as { name: string }[];
  const answers = await inquirer.prompt<{
    name: string;
    description: string;
    webhookUrl: string;
    channelLabel: string;
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Connection name (e.g. slack-alerts):',
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
      message: 'Slack incoming webhook URL (Slack app > Incoming Webhooks):',
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
      type: 'input',
      name: 'channelLabel',
      message: 'Channel label for display (optional):',
      default: '',
    },
  ]);
  return {
    name: answers.name.trim(),
    type: 'slack',
    description: answers.description.trim() || undefined,
    webhookUrl: answers.webhookUrl.trim(),
    channelLabel: answers.channelLabel.trim() || undefined,
    enabled: false,
  };
}

export async function promptModifySlack(existing: SlackConnection): Promise<SlackConnection> {
  const answers = await inquirer.prompt<{
    name: string;
    description: string;
    webhookUrl: string;
    channelLabel: string;
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
      message: 'Slack webhook URL:',
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
      type: 'input',
      name: 'channelLabel',
      message: 'Channel label for display (optional):',
      default: existing.channelLabel ?? '',
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
    type: 'slack',
    description: answers.description.trim() || undefined,
    webhookUrl: answers.webhookUrl.trim(),
    channelLabel: answers.channelLabel.trim() || undefined,
    enabled: answers.enabled,
    query: existing.query,
  };
}
