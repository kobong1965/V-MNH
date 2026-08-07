const SECRET_KEY = /(api.?key|token|secret|authorization|password|cookie)/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const QUERY_SECRET = /([?&](?:key|token|signature|sig|authorization)=)[^&\s]+/gi;

export const redactString = (value) => String(value)
  .replace(BEARER, 'Bearer [REDACTED]')
  .replace(QUERY_SECRET, '$1[REDACTED]');

export const redactSecrets = (value, seen = new WeakSet()) => {
  if (typeof value === 'string') return redactString(value);
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SECRET_KEY.test(key) ? '[REDACTED]' : redactSecrets(child, seen)
  ]));
};

export const safeLogJson = (value) => JSON.stringify(redactSecrets(value));
