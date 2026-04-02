import { chunkTextByMaxLength } from './chunk-text';

describe('chunkTextByMaxLength', () => {
  it('returns single chunk when under limit', () => {
    expect(chunkTextByMaxLength('hello', 10)).toEqual(['hello']);
  });

  it('splits preferring newlines', () => {
    const s = 'a\n' + 'b'.repeat(20);
    const chunks = chunkTextByMaxLength(s, 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(s);
  });
});
