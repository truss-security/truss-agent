import { chunkTextForTeamsWebhook, teamsOutgoingWebhookPayloadByteLength } from './ms-teams';

describe('chunkTextForTeamsWebhook', () => {
  it('returns one chunk for short text', () => {
    expect(chunkTextForTeamsWebhook('Hello Teams')).toEqual(['Hello Teams']);
  });

  it('splits large payloads so each part is under Teams 28 KB webhook limit', () => {
    const big = `${'x'.repeat(500)}\n`.repeat(400);
    const chunks = chunkTextForTeamsWebhook(big);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(teamsOutgoingWebhookPayloadByteLength(c)).toBeLessThanOrEqual(28 * 1024);
    }
  });
});
