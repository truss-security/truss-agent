import { SecurityIndicator } from '../models/types';

/**
 * Format SecurityIndicators as report / awareness lines: title, author, category, source, pubDate, references.
 * Optionally include a short summary of indicator types/counts per item.
 */
export function formatIndicatorsAsReport(indicators: SecurityIndicator[]): string {
  const blocks: string[] = [];

  for (const item of indicators) {
    const parts: string[] = [];
    if (item.title) parts.push(`**${item.title}**`);
    if (item.author?.length) parts.push(`Author: ${item.author.join(', ')}`);
    if (item.category) parts.push(`Category: ${item.category}`);
    if (item.source) parts.push(`Source: ${item.source}`);
    if (item.pubDate) parts.push(`Date: ${item.pubDate}`);
    if (item.reference?.length) {
      const refs = item.reference.slice(0, 3).join(', ');
      parts.push(`Refs: ${refs}${item.reference.length > 3 ? '…' : ''}`);
    }
    const indicatorTypes = item.indicators
      ? Object.keys(item.indicators).filter((k) => {
          const v = item.indicators[k];
          return v != null && (Array.isArray(v) ? v.length > 0 : true);
        })
      : [];
    if (indicatorTypes.length > 0) {
      parts.push(`IOC types: ${indicatorTypes.join(', ')}`);
    }
    if (parts.length > 0) {
      blocks.push(parts.join(' | '));
    }
  }

  return blocks.length === 0 ? '' : blocks.join('\n\n');
}
