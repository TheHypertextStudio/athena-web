/** Existing frontend response security policy, shared by Next rewrites and Worker gateway. */
export const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(self)' },
];

/** Framing CSP remains excluded from delegated docs, preserving the upstream docs CSP. */
export const cspHeader = [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }];
