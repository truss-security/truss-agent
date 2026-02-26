import { z } from 'zod';
import { ConnectionQuerySchema } from '../types';

export const SlackConnectionSchema = z.object({
  name: z.string().min(1),
  type: z.literal('slack'),
  description: z.string().optional(),
  webhookUrl: z.string().url(),
  channelLabel: z.string().optional(),
  enabled: z.boolean().default(false),
  query: ConnectionQuerySchema,
});

export type SlackConnection = z.infer<typeof SlackConnectionSchema>;
