import { buildTrussProductUrl } from './truss-product-url';

describe('buildTrussProductUrl', () => {
  it('builds dashboard URL for numeric string id', () => {
    expect(buildTrussProductUrl('128965')).toBe(
      'https://dashboard.truss-security.com/dashboard?product=128965'
    );
  });

  it('builds dashboard URL for numeric id', () => {
    expect(buildTrussProductUrl(128965)).toBe(
      'https://dashboard.truss-security.com/dashboard?product=128965'
    );
  });

  it('returns undefined for missing or invalid ids', () => {
    expect(buildTrussProductUrl(undefined)).toBeUndefined();
    expect(buildTrussProductUrl(null)).toBeUndefined();
    expect(buildTrussProductUrl('')).toBeUndefined();
    expect(buildTrussProductUrl('  ')).toBeUndefined();
    expect(buildTrussProductUrl('0')).toBeUndefined();
    expect(buildTrussProductUrl(-1)).toBeUndefined();
    expect(buildTrussProductUrl('abc')).toBeUndefined();
    expect(buildTrussProductUrl('12.3')).toBeUndefined();
  });
});
