/** Google OAuth scopes requested incrementally by each Workspace connector. */
export const GOOGLE_CONNECTOR_SCOPES = {
  calendar: [
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  gtasks: ['https://www.googleapis.com/auth/tasks'],
  /**
   * Metadata only, and deliberately not `drive.readonly`.
   *
   * @remarks
   * Both are Google-restricted scopes carrying the same verification and security-assessment
   * burden, so the choice is about what we must justify holding. Metadata-only reads exactly the
   * fields a preview renders and cannot read file contents at all, which makes "Docket never reads
   * your documents" a true sentence. The cost is thumbnails, which need content scope.
   */
  drive: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
  gmail: ['https://www.googleapis.com/auth/gmail.modify'],
} as const;

/** Parse provider scope storage defensively; Better Auth and providers use commas or spaces. */
export function parseOAuthScopes(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/** Return incremental Google scopes for one connector, or none for non-Google connectors. */
export function googleScopesForConnector(provider: string): readonly string[] {
  if (!(provider in GOOGLE_CONNECTOR_SCOPES)) return [];
  return GOOGLE_CONNECTOR_SCOPES[provider as keyof typeof GOOGLE_CONNECTOR_SCOPES];
}
