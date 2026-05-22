// src/modules/transactions/state-machine/pii-sanitiser.ts

// Fields that must never be stored in audit logs (Section A2.3)
// PCI-DSS requirement — card data must not appear in application logs
const PII_FIELDS = new Set([
  'card_number',
  'card_num',
  'cvv',
  'cvc',
  'expiry',
  'expiry_date',
  'exp_month',
  'exp_year',
  'account_number',
  'account_num',
  'ifsc',
  'vpa',
  'upi_id',
  'phone',
  'mobile',
  'email',
  'name',
  'card_holder',
  'billing_address',
]);

export function sanitisePII(response: Record<string, unknown>, depth = 0): Record<string, unknown> {
  // Limit recursion depth — gateway responses are not deeply nested
  if (depth > 3) return { _truncated: true };

  const sanitised: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(response)) {
    if (PII_FIELDS.has(key.toLowerCase())) {
      sanitised[key] = '[REDACTED]';
      continue;
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      sanitised[key] = sanitisePII(value as Record<string, unknown>, depth + 1);
      continue;
    }

    sanitised[key] = value;
  }

  return sanitised;
}
