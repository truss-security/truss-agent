import { formatIndicatorsAsReport } from './metadata-formatter';
import type { SecurityIndicator } from '../models/types';

describe('formatIndicatorsAsReport', () => {
  function indicator(overrides: Partial<SecurityIndicator> = {}): SecurityIndicator {
    return {
      id: '128965',
      title: 'Sample Product',
      category: 'Malware',
      indicators: {},
      timestamp: '2026-10-13T00:00:00.000Z',
      ...overrides,
    };
  }

  it('includes Truss product URL when id is valid', () => {
    const text = formatIndicatorsAsReport([indicator()]);
    expect(text).toContain(
      'Truss: https://dashboard.truss-security.com/dashboard?product=128965'
    );
  });

  it('omits Truss product URL when id is invalid', () => {
    const text = formatIndicatorsAsReport([indicator({ id: '' })]);
    expect(text).not.toContain('Truss:');
  });
});
