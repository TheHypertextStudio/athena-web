/**
 * SCR-12/SCR-14: every permission Docket's authorization server can grant has plain-English
 * consent copy, and nothing in that copy is machine vocabulary.
 *
 * @remarks
 * The consent screen is where a person decides whether to trust an outside app with their work.
 * Before this suite existed nothing connected the set of grantable permissions to the words shown
 * for them: the screen fell back to `info?.label ?? scope`, so a sixth permission added to the
 * server would have rendered its raw identifier — `some:future` — at someone with no way to know
 * what that meant, and no test would have noticed.
 *
 * The enumeration below is the check that makes that impossible. It walks `OAUTH_ISSUABLE_SCOPES`
 * (the array `oauthProvider({ scopes })` in `packages/auth` is literally configured from) rather
 * than the copy map's own keys, so a permission added to the server and not to the copy fails
 * here — which is the direction the failure actually travels.
 */
import { OAUTH_ISSUABLE_SCOPES } from '@docket/types';
import { describe, expect, it } from 'vitest';

import type { OAuthScopeCopy } from '@/lib/oauth-scope-copy';
import {
  describeScope,
  isIssuableScope,
  OAUTH_SCOPE_ACCESS_LABEL,
  OAUTH_SCOPE_COPY,
} from '@/lib/oauth-scope-copy';

/**
 * Words a non-technical reader has no reason to know, matched whole-word and case-insensitively.
 *
 * @remarks
 * Verbatim from SCR-14's acceptance criteria. `API` is matched case-sensitively as an acronym
 * inside the same alternation so ordinary words containing that letter run ("capital", "rapid")
 * are not false positives — `\b` alone would not save us, but the acronym only appears uppercase.
 */
const BANNED_TERMS = [
  /\bOAuth\b/i,
  /\btokens?\b/i,
  /\bclient_id\b/i,
  /\bredirect_uri\b/i,
  /\bscopes?\b/i,
  /\bAPI\b/,
  /\bendpoints?\b/i,
];

/**
 * A permission identifier's two distinguishing characters.
 *
 * @remarks
 * Every issuable permission is either `a:b` or `a_b`. Copy containing either is almost certainly
 * an identifier that leaked into prose, which is the exact failure SCR-12 names.
 */
const IDENTIFIER_FRAGMENT = /[:_]/;

/** Every user-visible string this module can put on the consent screen. */
function everyVisibleString(): { where: string; text: string }[] {
  const strings: { where: string; text: string }[] = [];
  for (const [scope, copy] of Object.entries(OAUTH_SCOPE_COPY)) {
    strings.push({ where: `OAUTH_SCOPE_COPY['${scope}'].label`, text: copy.label });
    strings.push({ where: `OAUTH_SCOPE_COPY['${scope}'].detail`, text: copy.detail });
  }
  for (const [access, label] of Object.entries(OAUTH_SCOPE_ACCESS_LABEL)) {
    strings.push({ where: `OAUTH_SCOPE_ACCESS_LABEL.${access}`, text: label });
  }
  const fallback = describeScope('some:future');
  strings.push({ where: 'describeScope fallback label', text: fallback.label });
  strings.push({ where: 'describeScope fallback detail', text: fallback.detail });
  return strings;
}

describe('OAuth consent copy', () => {
  it('has a written description for every permission the server can issue', () => {
    // Read through a widened view on purpose. `OAUTH_SCOPE_COPY` is keyed by `OAuthIssuableScope`,
    // so TypeScript already refuses a missing entry — but that guarantee evaporates the moment
    // someone loosens the annotation to `Record<string, …>` to make a build pass, and this is the
    // test that is supposed to survive that. Widening here keeps the runtime check real.
    const byScope: Readonly<Record<string, OAuthScopeCopy | undefined>> = OAUTH_SCOPE_COPY;
    const missing = OAUTH_ISSUABLE_SCOPES.filter((scope) => {
      const copy = byScope[scope];
      return copy === undefined || copy.label.trim() === '' || copy.detail.trim() === '';
    });

    expect(
      missing,
      [
        'Every permission the authorization server can grant needs consent copy, or the screen',
        'shows a person a permission it has no words for. Add an entry to OAUTH_SCOPE_COPY in',
        'apps/web/src/lib/oauth-scope-copy.ts for:',
        ...missing,
      ].join('\n'),
    ).toEqual([]);
  });

  it('describes exactly the issuable permissions and nothing else', () => {
    // Extras are as bad as omissions in the other direction: copy for a permission the server
    // cannot grant is copy nobody will ever read, kept current by nobody.
    expect(Object.keys(OAUTH_SCOPE_COPY).sort()).toEqual([...OAUTH_ISSUABLE_SCOPES].sort());
  });

  it('says whether each permission looks at things or changes them', () => {
    // The "whether access is read or write" half of SCR-12. Every entry resolves to a phrase; the
    // bare category word is never what the screen prints.
    for (const scope of OAUTH_ISSUABLE_SCOPES) {
      const { access } = OAUTH_SCOPE_COPY[scope];
      expect(access, `${scope} has no access category`).not.toBe('none');
      expect(OAUTH_SCOPE_ACCESS_LABEL[access], `${scope} has no access phrase`).toBeTruthy();
    }
    // The four capability permissions split read/write; `offline_access` grants neither — it keeps
    // the connection alive — so it gets its own phrase rather than being called a write.
    expect(OAUTH_SCOPE_COPY['work:read'].access).toBe('read');
    expect(OAUTH_SCOPE_COPY['work:write'].access).toBe('write');
    expect(OAUTH_SCOPE_COPY['agents:run'].access).toBe('write');
    expect(OAUTH_SCOPE_COPY['connectors:link'].access).toBe('write');
    expect(OAUTH_SCOPE_COPY.offline_access.access).toBe('connection');
  });

  it('never puts a permission identifier or machine vocabulary in front of a reader', () => {
    const violations: string[] = [];
    for (const { where, text } of everyVisibleString()) {
      if (IDENTIFIER_FRAGMENT.test(text)) {
        violations.push(`${where}: reads like an identifier — "${text}"`);
      }
      for (const term of BANNED_TERMS) {
        if (term.test(text)) violations.push(`${where}: contains ${String(term)} — "${text}"`);
      }
    }

    expect(violations, `Consent copy must be plain language:\n${violations.join('\n')}`).toEqual(
      [],
    );
  });

  describe('a permission Docket does not offer', () => {
    it('is described in plain English rather than echoed back', () => {
      const described = describeScope('some:future');

      expect(described.label).not.toContain('some:future');
      expect(described.detail).not.toContain('some:future');
      // "Unknown scope" was the other obvious fallback and is barely better than the identifier:
      // it tells the reader the app is confused without telling them what happens if they approve.
      expect(`${described.label} ${described.detail}`).not.toContain('Unknown scope');
      expect(described.label.trim()).not.toBe('');
      expect(described.detail.trim()).not.toBe('');
    });

    it('tells the reader plainly that approving grants nothing', () => {
      // True by construction, not reassurance: `oauthProvider({ scopes })` is configured from
      // OAUTH_ISSUABLE_SCOPES and that array is the hard ceiling for both /oauth2/authorize and
      // the token exchange, so a permission outside it cannot be granted at all.
      const described = describeScope('some:future');
      expect(described.access).toBe('none');
      expect(OAUTH_SCOPE_ACCESS_LABEL[described.access]).toBe('Grants nothing');
      expect(described.detail).toMatch(/will not grant/i);
    });

    it('is not mistaken for one the server can issue', () => {
      expect(isIssuableScope('some:future')).toBe(false);
      expect(isIssuableScope('')).toBe(false);
      for (const scope of OAUTH_ISSUABLE_SCOPES) expect(isIssuableScope(scope)).toBe(true);
    });
  });

  it('returns the real entry for every permission the server can issue', () => {
    for (const scope of OAUTH_ISSUABLE_SCOPES) {
      expect(describeScope(scope)).toEqual(OAUTH_SCOPE_COPY[scope]);
    }
  });
});
