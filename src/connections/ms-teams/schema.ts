import { z } from 'zod';
import { ConnectionQuerySchema } from '../types';

export const MSTeamsConnectionSchema = z.object({
  name: z.string().min(1),
  type: z.literal('ms-teams'),
  description: z.string().optional(),
  webhookUrl: z.string().url(),
  enabled: z.boolean().default(false),
  query: ConnectionQuerySchema,
});

export type MSTeamsConnection = z.infer<typeof MSTeamsConnectionSchema>;
