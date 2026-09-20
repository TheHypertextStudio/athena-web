import {
  PUBLIC_TAG_CONSOLIDATIONS,
  type LegacyPublicTagId,
  type PublicTagId,
} from './public-api-tags';

type TagSlug<T extends string> = T extends `${infer Head} ${infer Tail}`
  ? `${Lowercase<Head>}-${TagSlug<Tail>}`
  : Lowercase<T>;

/** Scalar hashes based on stable public tag IDs rather than display labels. */
export type PublicTagHash = `#tag/${TagSlug<PublicTagId>}`;

/** Scalar hashes retained for the seven consolidated legacy tag names. */
export type LegacyPublicTagHash = `#tag/${TagSlug<LegacyPublicTagId>}`;

/** Exact redirect targets for each legacy tag hash. */
export type PublicTagHashRedirects = {
  readonly [
    Legacy in LegacyPublicTagId as `#tag/${TagSlug<Legacy>}`
  ]: `#tag/${TagSlug<(typeof PUBLIC_TAG_CONSOLIDATIONS)[Legacy]>}`;
};

function tagHash<T extends string>(tag: T): `#tag/${TagSlug<T>}` {
  return `#tag/${tag.toLowerCase().replaceAll(' ', '-')}` as `#tag/${TagSlug<T>}`;
}

/** Create a Scalar section hash from a stable public tag ID. */
export function publicTagHash<T extends PublicTagId>(tag: T): `#tag/${TagSlug<T>}` {
  return tagHash(tag);
}

/** Legacy-to-current section redirects derived from the canonical consolidation map. */
export const PUBLIC_TAG_HASH_REDIRECTS = Object.fromEntries(
  Object.entries(PUBLIC_TAG_CONSOLIDATIONS).map(([legacy, current]) => [
    tagHash(legacy),
    publicTagHash(current),
  ]),
) as PublicTagHashRedirects;

/** Redirect legacy section hashes while preserving any Scalar operation suffix. */
export function redirectPublicTagHash(hash: string): string {
  const match = /^#tag\/([^/]+)(.*)$/.exec(hash);
  if (!match) return hash;
  let decoded: string;
  try {
    decoded = decodeURIComponent(match[1] ?? '');
  } catch {
    return hash;
  }
  const normalized = decoded.replaceAll('-', ' ').toLowerCase();
  const legacy = Object.keys(PUBLIC_TAG_CONSOLIDATIONS).find(
    (candidate) => candidate.toLowerCase() === normalized,
  ) as LegacyPublicTagId | undefined;
  if (legacy) {
    return `${publicTagHash(PUBLIC_TAG_CONSOLIDATIONS[legacy])}${match[2] ?? ''}`;
  }
  return hash;
}
