import { buildReportEmbeds, chunkEmbedsForDiscordMessage, type DiscordEmbed } from './discord';
import type { SecurityIndicator } from '../../models/types';

describe('chunkEmbedsForDiscordMessage', () => {
  function tinyEmbed(i: number): DiscordEmbed {
    return {
      title: `T${i}`,
      fields: [{ name: 'a', value: 'b', inline: true }],
      footer: { text: 'f' },
    };
  }

  it('never puts more than 10 embeds in one batch', () => {
    const embeds = Array.from({ length: 22 }, (_, i) => tinyEmbed(i));
    const batches = chunkEmbedsForDiscordMessage(embeds);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((b) => b.length <= 10)).toBe(true);
    expect(batches.reduce((n, b) => n + b.length, 0)).toBe(22);
  });

  it('splits batches when combined character count would exceed budget', () => {
    const bigValue = 'x'.repeat(1600);
    const embeds: DiscordEmbed[] = Array.from({ length: 5 }, () => ({
      title: 'Title',
      fields: [{ name: 'Tags', value: bigValue, inline: false }],
      footer: { text: 'footer' },
    }));
    const batches = chunkEmbedsForDiscordMessage(embeds);
    expect(batches.length).toBeGreaterThan(1);
  });
});

describe('buildReportEmbeds', () => {
  function indicator(overrides: Partial<SecurityIndicator> = {}): SecurityIndicator {
    return {
      id: '128965',
      title: 'Sample Product',
      indicators: {},
      timestamp: '2026-10-13T00:00:00.000Z',
      ...overrides,
    };
  }

  it('sets embed.url to the Truss dashboard product link when id is valid', () => {
    const embeds = buildReportEmbeds([indicator()]) ?? [];
    expect(embeds).toHaveLength(1);
    expect(embeds[0].url).toBe(
      'https://dashboard.truss-security.com/dashboard?product=128965'
    );
  });

  it('omits embed.url when product id is missing or invalid', () => {
    const embeds = buildReportEmbeds([indicator({ id: '' })]) ?? [];
    expect(embeds).toHaveLength(1);
    expect(embeds[0].url).toBeUndefined();
  });
});
