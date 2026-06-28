/**
 * App password route serializers.
 *
 * @packageDocumentation
 */

interface AppPasswordFields {
  id: string;
  name: string;
  scopes: string[];
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export function toAppPassword(password: AppPasswordFields) {
  return {
    id: password.id,
    name: password.name,
    scopes: password.scopes,
    lastUsedAt: password.lastUsedAt,
    lastUsedIp: password.lastUsedIp,
    expiresAt: password.expiresAt,
    createdAt: password.createdAt,
  };
}
