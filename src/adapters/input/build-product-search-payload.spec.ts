import {
  buildProductSearchPayload,
  legacyArraysToFilterExpression,
} from './build-product-search-payload';
import type { ApiSearchFilter } from '../../models/types';

describe('buildProductSearchPayload', () => {
  it('uses only whitelisted keys and adds page/limit', () => {
    const filter: ApiSearchFilter = {
      category: ['Malware'],
      startDate: '2024-01-01',
      endDate: '2024-01-31',
    };
    const p = buildProductSearchPayload(filter, 2, 500);
    expect(p).toEqual({
      filterExpression: 'category = "Malware"',
      startDate: '2024-01-01',
      endDate: '2024-01-31',
      page: 2,
      limit: 500,
    });
    expect(p).not.toHaveProperty('category');
    expect(p).not.toHaveProperty('days');
  });

  it('prefers filterExpression over legacy arrays', () => {
    const p = buildProductSearchPayload(
      {
        filterExpression: 'source = "Test"',
        category: ['Ignored'],
      },
      1,
      100
    );
    expect(p.filterExpression).toBe('source = "Test"');
  });

  it('strips days when startDate is set', () => {
    const p = buildProductSearchPayload(
      { days: 7, startDate: '2024-06-01T00:00:00Z', endDate: '2024-06-02T00:00:00Z' },
      1,
      1000
    );
    expect(p).not.toHaveProperty('days');
    expect(p.startDate).toBe('2024-06-01T00:00:00Z');
  });

  it('passes days when startDate is absent', () => {
    const p = buildProductSearchPayload({ days: 14 }, 1, 100);
    expect(p.days).toBe(14);
    expect(p).not.toHaveProperty('startDate');
  });

  it('escapes quotes and backslashes in legacy values', () => {
    const p = buildProductSearchPayload({ source: ['a"b', 'x\\y'] }, 1, 50);
    expect(p.filterExpression).toBe('(source = "a\\\"b" OR source = "x\\\\y")');
  });

  it('combines multiple attributes with AND', () => {
    const p = buildProductSearchPayload(
      { category: ['A'], tags: ['t1', 't2'] },
      1,
      10
    );
    expect(p.filterExpression).toBe(
      'category = "A" AND (tags = "t1" OR tags = "t2")'
    );
  });

  it('passes sort fields', () => {
    const p = buildProductSearchPayload(
      { order_by: 'pub_date', order_direction: 'asc' },
      3,
      25
    );
    expect(p.order_by).toBe('pub_date');
    expect(p.order_direction).toBe('asc');
    expect(p.page).toBe(3);
    expect(p.limit).toBe(25);
  });
});

describe('legacyArraysToFilterExpression', () => {
  it('returns undefined when no constraints', () => {
    expect(legacyArraysToFilterExpression({})).toBeUndefined();
  });
});
