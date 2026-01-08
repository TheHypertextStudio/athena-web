/**
 * Type declarations for google-auth-library.
 * These types are used when the package is dynamically imported.
 */

declare module 'google-auth-library' {
  export class GoogleAuth {
    constructor(options: { scopes: string[] });
    getClient(): Promise<{
      getAccessToken(): Promise<{ token?: string | null }>;
    }>;
  }
}
