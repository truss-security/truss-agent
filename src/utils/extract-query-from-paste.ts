import type { ApiSearchFilter } from '../models/types';
import { LEGACY_ARRAY_FILTER_KEYS } from '../adapters/input/build-product-search-payload';

const ORDER_BY_VALUES = ['pub_date', 'downloads', 'rating', 'timestamp'] as const;

function parseCommaList(input: string): string[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function ensureStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : String(v))).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return parseCommaList(value);
  }
  return [];
}

/**
 * Extract a balanced `{ ... }` from s starting at startIndex, respecting strings and escapes.
 */
export function extractBracedObject(s: string, startIndex: number): string | null {
  if (s[startIndex] !== '{') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = '';
  for (let i = startIndex; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if ((c === '"' || c === "'") && !inString) {
      inString = true;
      quote = c;
      continue;
    }
    if (c === quote && inString) {
      inString = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(startIndex, i + 1);
    }
  }
  return null;
}

function skipWhitespace(s: string, start: number): number {
  let i = start;
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
}

/**
 * Curl samples from Truss dashboard use a heredoc: -d @- <<'EOF' ... EOF
 */
function extractHeredocJsonBody(s: string): string | null {
  const patterns = [
    /<<\s*-?\s*'(\w+)'\s*\r?\n/,
    /<<\s*-?\s*"(\w+)"\s*\r?\n/,
    /<<\s*-?\s*(\w+)\s*\r?\n/,
    /** Optional space/tab between << and - (shell allows `<< -'EOF'`) */
    /<<\s+-\s*'(\w+)'\s*\r?\n/,
    /<<\s+-\s*"(\w+)"\s*\r?\n/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (!m) continue;
    const marker = m[1];
    const contentStart = m.index + m[0].length;
    const tail = s.slice(contentStart);
    const endRe = new RegExp(`\\r?\\n${marker}\\b\\s*(?:\\r?\\n|$)`);
    const em = endRe.exec(tail);
    if (em) {
      return tail.slice(0, em.index).trim();
    }
  }
  return null;
}

/** Dashboard JavaScript tab: body: JSON.stringify({ ... }) */
function extractJsonAfterJsonStringify(s: string): string | null {
  const re = /JSON\.stringify\s*\(\s*\{/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(s)) !== null) {
    last = m;
  }
  if (!last) return null;
  const braceStart = last.index + last[0].length - 1;
  return extractBracedObject(s, braceStart);
}

/** Python tab: json= then newline and { ... } */
function extractJsonAfterPythonJsonKw(s: string): string | null {
  const m = s.match(/\bjson\s*=/i);
  if (!m || m.index == null) return null;
  const pos = skipWhitespace(s, m.index + m[0].length);
  if (pos >= s.length || s[pos] !== '{') return null;
  return extractBracedObject(s, pos);
}

/**
 * Bash tab: data='{ ... }' then curl. JSON may contain single quotes in string values;
 * extractBracedObject must find the real `{`/`}` payload (string-aware).
 */
function extractBashDataJson(s: string): string | null {
  const m = s.match(/\bdata\s*=\s*'/);
  if (!m || m.index == null) return null;
  const brace = s.indexOf('{', m.index + m[0].length);
  if (brace < 0) return null;
  return extractBracedObject(s, brace);
}

function extractJsonAfterKeywordPrefix(s: string, prefix: RegExp): string | null {
  const m = s.match(prefix);
  if (!m || m.index == null) return null;
  const pos = skipWhitespace(s, m.index + m[0].length);
  if (pos >= s.length || s[pos] !== '{') return null;
  return extractBracedObject(s, pos);
}

function extractJsonObjectFromPaste(trimmed: string): string | null {
  if (trimmed.startsWith('{')) {
    return extractBracedObject(trimmed, 0);
  }

  const heredoc = extractHeredocJsonBody(trimmed);
  if (heredoc) {
    const t = heredoc.trim();
    if (t.startsWith('{')) {
      return extractBracedObject(t, 0) ?? t;
    }
  }

  const fromStringify = extractJsonAfterJsonStringify(trimmed);
  if (fromStringify) return fromStringify;

  const fromPython = extractJsonAfterPythonJsonKw(trimmed);
  if (fromPython) return fromPython;

  const fromBash = extractBashDataJson(trimmed);
  if (fromBash) return fromBash;

  const fromGo = extractJsonAfterKeywordPrefix(trimmed, /\bpayload\s*:=\s*/);
  if (fromGo) return fromGo;

  const fromRust = extractJsonAfterKeywordPrefix(trimmed, /\blet\s+payload\s*=\s*/i);
  if (fromRust) return fromRust;

  const fromRuby = extractJsonAfterKeywordPrefix(trimmed, /\bpayload\s*=\s*/);
  if (fromRuby) return fromRuby;

  const bodyMatch = trimmed.match(/\bbody\s*:\s*(\{)/i);
  if (bodyMatch && bodyMatch.index != null) {
    const start = bodyMatch.index + bodyMatch[0].length - 1;
    const ex = extractBracedObject(trimmed, start);
    if (ex) return ex;
  }

  const firstBrace = trimmed.indexOf('{');
  if (firstBrace >= 0) return extractBracedObject(trimmed, firstBrace);
  return null;
}

export type ExtractQueryFromPasteResult = {
  filter: ApiSearchFilter | null;
  hint?: string;
};

/**
 * Extract POST /product/search body fields from pasted Truss dashboard samples
 * (see ApiCodeSamples: curl, javascript, python, bash, go, rust, ruby): raw JSON,
 * heredoc, JSON.stringify(...), json=..., data='...', payload := / let payload = / payload =.
 *
 * Real values in `x-api-key` or other headers (JWTs, sk_… tokens, etc.) are ignored for parsing;
 * only the JSON body is used. Keys are not validated or redacted here.
 *
 * Inside the JSON object, **property order does not matter** (JSON has no key order). Extra fields
 * such as `apiKey`, `page`, `limit`, etc. are ignored; only supported search fields are copied into
 * the returned filter. Dashboard samples often show `filterExpression` first for readability—that is
 * not required.
 */
function normalizePastedSample(s: string): string {
  return s.replace(/^\ufeff/, '').trim();
}

export function extractQueryFromPaste(pasted: string): ExtractQueryFromPasteResult {
  const trimmed = normalizePastedSample(pasted);
  if (!trimmed) return { filter: null };

  const jsonStr = extractJsonObjectFromPaste(trimmed);
  if (!jsonStr) return { filter: null };
  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    const filter: ApiSearchFilter = {};

    if (typeof data.filterExpression === 'string' && data.filterExpression.trim()) {
      filter.filterExpression = data.filterExpression.trim();
    }
    if (typeof data.days === 'number' && Number.isInteger(data.days) && data.days >= 0) {
      filter.days = data.days;
    }
    const ob = data.order_by;
    if (typeof ob === 'string' && (ORDER_BY_VALUES as readonly string[]).includes(ob)) {
      filter.order_by = ob as ApiSearchFilter['order_by'];
    }
    const od = data.order_direction;
    if (od === 'asc' || od === 'desc') {
      filter.order_direction = od;
    }

    for (const key of LEGACY_ARRAY_FILTER_KEYS) {
      const arr = ensureStringArray(data[key]);
      if (arr.length > 0) (filter as Record<string, string[]>)[key] = arr;
    }
    if (typeof data.startDate === 'string' || typeof data.startDate === 'number') {
      filter.startDate = data.startDate;
    }
    if (typeof data.endDate === 'string' || typeof data.endDate === 'number') {
      filter.endDate = data.endDate;
    }

    const hasFilterAst = data.filterAst != null && typeof data.filterAst === 'object';
    const hasLegacyArrays = LEGACY_ARRAY_FILTER_KEYS.some((k) => {
      const arr = ensureStringArray(data[k]);
      return arr.length > 0;
    });
    const hasAnyProductSearchFields =
      Boolean(filter.filterExpression) ||
      hasLegacyArrays ||
      filter.startDate != null ||
      filter.endDate != null ||
      filter.days != null ||
      filter.order_by != null ||
      filter.order_direction != null;
    if (hasFilterAst && !hasAnyProductSearchFields) {
      return {
        filter: null,
        hint:
          'This body includes filterAst; POST /product/search expects filterExpression (FilterQL). Copy the product search JSON from the Truss UI or paste a filterExpression string.',
      };
    }

    if (Object.keys(filter).length === 0) return { filter: null };
    return { filter };
  } catch {
    return { filter: null };
  }
}
