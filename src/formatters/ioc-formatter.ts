import { SecurityIndicator } from '../models/types';

/**
 * Flatten SecurityIndicator.indicators into lines of "type: value" (one per line).
 * Arrays are expanded to one line per value.
 */
export function formatIndicatorsAsIoc(indicators: SecurityIndicator[]): string {
  const lines: string[] = [];

  for (const item of indicators) {
    if (!item.indicators || typeof item.indicators !== 'object') continue;
    for (const [type, value] of Object.entries(item.indicators)) {
      if (value == null) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v != null && String(v).trim()) {
            lines.push(`${type}: ${String(v).trim()}`);
          }
        }
      } else {
        const s = String(value).trim();
        if (s) lines.push(`${type}: ${s}`);
      }
    }
  }

  return lines.length === 0 ? '' : lines.join('\n');
}
