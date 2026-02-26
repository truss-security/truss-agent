import { z } from 'zod';
import { ConnectionQuerySchema } from '../types';

export const DiscordConnectionSchema = z.object({
  name: z.string().min(1),
  type: z.literal('discord'),
  description: z.string().optional(),
  webhookUrl: z.string().url(),
  channelLabel: z.string().optional(),
  enabled: z.boolean().default(false),
  query: ConnectionQuerySchema,
});

export type DiscordConnection = z.infer<typeof DiscordConnectionSchema>;
