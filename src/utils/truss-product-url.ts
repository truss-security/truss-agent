const TRUSS_DASHBOARD_PRODUCT_BASE = 'https://dashboard.truss-security.com/dashboard';

/**
 * Build the Truss dashboard URL for a product (numeric id).
 * Returns undefined when the id is missing or not a positive integer.
 */
export function buildTrussProductUrl(productId: string | number | undefined | null): string | undefined {
  if (productId == null) return undefined;
  const raw = String(productId).trim();
  if (!/^\d+$/.test(raw)) return undefined;
  // Reject leading-zero padding quirks except plain "0"; product ids are positive.
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return `${TRUSS_DASHBOARD_PRODUCT_BASE}?product=${raw}`;
}
