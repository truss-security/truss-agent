import { describe, expect, it } from '@jest/globals';
import { extractQueryFromPaste, extractBracedObject } from './extract-query-from-paste';

describe('extractBracedObject', () => {
  it('balances braces inside double-quoted strings', () => {
    const s = `{ "filterExpression": "a { b } c", "page": 1 }`;
    expect(extractBracedObject(s, 0)).toBe(s);
  });
});

describe('extractQueryFromPaste', () => {
  const filterExpr = "category = 'A' OR tags = 'B'";

  it('parses Truss dashboard curl heredoc sample', () => {
    const pasted = `
curl -sS -X POST "https://api.truss-security.com/product/search" \\
  -H "x-api-key: YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{
  "filterExpression": "${filterExpr}",
  "page": 1,
  "limit": 100,
  "startDate": "2026-03-26T20:27:00.000Z",
  "endDate": "2026-04-02T20:27:59.999Z"
}
EOF
`;
    const { filter, hint } = extractQueryFromPaste(pasted);
    expect(hint).toBeUndefined();
    expect(filter).not.toBeNull();
    expect(filter!.filterExpression).toContain("category = 'A'");
    expect(filter!.startDate).toBe('2026-03-26T20:27:00.000Z');
    expect(filter!.endDate).toBe('2026-04-02T20:27:59.999Z');
  });

  it('parses Truss dashboard JavaScript fetch sample (JSON.stringify object)', () => {
    const pasted = `const response = await fetch("https://api.truss-security.com/product/search", {
  method: "POST",
  headers: {
    "x-api-key": "secret",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
  "filterExpression": "${filterExpr}",
  "page": 1,
  "limit": 100
})
});
const data = await response.json();`;
    const { filter, hint } = extractQueryFromPaste(pasted);
    expect(hint).toBeUndefined();
    expect(filter).not.toBeNull();
    expect(filter!.filterExpression).toContain("category = 'A'");
  });

  it('parses Python requests json= multiline', () => {
    const pasted = `import requests
response = requests.post(
  "https://api.truss-security.com/product/search",
  headers={"x-api-key": "k"},
  json={
  "filterExpression": "source = \\"x\\"",
  "days": 3
}
)`;
    const { filter } = extractQueryFromPaste(pasted);
    expect(filter?.filterExpression).toBe('source = "x"');
    expect(filter?.days).toBe(3);
  });

  it('parses raw JSON object', () => {
    const { filter } = extractQueryFromPaste(`{
      "filterExpression": "category = \\"Malware\\"",
      "order_by": "timestamp",
      "order_direction": "desc"
    }`);
    expect(filter?.filterExpression).toContain('Malware');
    expect(filter?.order_by).toBe('timestamp');
    expect(filter?.order_direction).toBe('desc');
  });

  it('ignores apiKey (or similar) in the JSON body and does not require filterExpression first', () => {
    const { filter, hint } = extractQueryFromPaste(`{
  "apiKey": "sk_live_my_real_key_value_abc123",
  "page": 1,
  "limit": 100,
  "filterExpression": "category = \\"Phishing\\"",
  "days": 14
}`);
    expect(hint).toBeUndefined();
    expect(filter?.filterExpression).toContain('Phishing');
    expect(filter?.days).toBe(14);
  });

  it('extracts filterExpression when it is not the first property', () => {
    const { filter } = extractQueryFromPaste(`{
  "limit": 100,
  "page": 1,
  "order_by": "timestamp",
  "order_direction": "desc",
  "filterExpression": "tags = \\"ransomware\\""
}`);
    expect(filter?.filterExpression).toContain('ransomware');
    expect(filter?.order_by).toBe('timestamp');
  });

  it('parses Truss dashboard bash tab (data= single-quoted JSON)', () => {
    const pasted = `
data='{
  "filterExpression": "tags = \\"x\\"",
  "page": 1
}'
curl -s -X POST "https://api.truss-security.com/product/search" \\
  -H "Content-Type: application/json" \\
  -d "$data"`;
    const { filter } = extractQueryFromPaste(pasted);
    expect(filter?.filterExpression).toBe('tags = "x"');
  });

  it('parses Truss dashboard go tab', () => {
    const pasted = `
payload := {
  "filterExpression": "source = \\"y\\"",
  "limit": 50
}
// POST payload`;
    const { filter } = extractQueryFromPaste(pasted);
    expect(filter?.filterExpression).toBe('source = "y"');
  });

  it('parses Truss dashboard rust tab', () => {
    const pasted = `
let payload = {
  "filterExpression": "category = \\"z\\""
};
// POST`;
    const { filter } = extractQueryFromPaste(pasted);
    expect(filter?.filterExpression).toBe('category = "z"');
  });

  it('parses Truss dashboard ruby tab', () => {
    const pasted = `
payload = {
  "filterExpression": "industry = \\"Banking\\"",
  "days": 1
}
# POST`;
    const { filter } = extractQueryFromPaste(pasted);
    expect(filter?.filterExpression).toContain('Banking');
    expect(filter?.days).toBe(1);
  });

  it('parses curl heredoc when filterExpression uses single quotes inside FilterQL (dashboard style)', () => {
    const pasted = `
curl -sS -X POST "https://api.truss-security.com/product/search" \\
  -H "x-api-key: sk_test_abc" \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{
  "filterExpression": "tags = 'Ransomware' OR tags = 'LockBit' OR tags = 'Cl0p'",
  "page": 1,
  "limit": 100,
  "startDate": "2026-03-26T20:39:00.000Z",
  "endDate": "2026-04-02T20:39:59.999Z"
}
EOF
`;
    const { filter, hint } = extractQueryFromPaste(pasted);
    expect(hint).toBeUndefined();
    expect(filter?.filterExpression).toContain("tags = 'Ransomware'");
    expect(filter?.filterExpression).toContain('LockBit');
    expect(filter?.startDate).toBe('2026-03-26T20:39:00.000Z');
    expect(filter?.endDate).toBe('2026-04-02T20:39:59.999Z');
  });

  it('parses curl heredoc when x-api-key is a real token (not a YOUR_KEY placeholder)', () => {
    const pasted = `
curl -sS -X POST "https://api.truss-security.com/product/search" \\
  -H "x-api-key: truss_sk_7a8b9c0d1e2f3g4h5i6j7k8l9m0n1o2p" \\
  -H "Content-Type: application/json" \\
  -d @- <<'EOF'
{
  "filterExpression": "category = \\"Malware\\"",
  "days": 7
}
EOF
`;
    const { filter, hint } = extractQueryFromPaste(pasted);
    expect(hint).toBeUndefined();
    expect(filter?.filterExpression).toContain('Malware');
    expect(filter?.days).toBe(7);
  });

  it('parses JavaScript sample when x-api-key is JWT-shaped', () => {
    const pasted = `const response = await fetch("https://api.truss-security.com/product/search", {
  method: "POST",
  headers: {
    "x-api-key": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    "filterExpression": "tags = \\"phishing\\"",
    "limit": 50
  })
});`;
    const { filter, hint } = extractQueryFromPaste(pasted);
    expect(hint).toBeUndefined();
    expect(filter?.filterExpression).toContain('phishing');
  });

  it('strips UTF-8 BOM so pasted JSON still parses', () => {
    const raw = `{
  "filterExpression": "category = \\"x\\""
}`;
    const { filter } = extractQueryFromPaste(`\ufeff${raw}`);
    expect(filter?.filterExpression).toContain('x');
  });
});
