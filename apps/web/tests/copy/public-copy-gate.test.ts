import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
const PUBLIC_COPY_FILES = [
  'app/(marketing)/page.tsx',
  'app/(marketing)/pricing/page.tsx',
  'app/(marketing)/about/page.tsx',
  'app/(marketing)/privacy/page.tsx',
  'app/(marketing)/terms/page.tsx',
  'app/(marketing)/problems/page.tsx',
  'app/(marketing)/problems/[code]/page.tsx',
  'app/(auth)/sign-in/sign-in-client.tsx',
  'app/(auth)/sign-up/sign-up-client.tsx',
  'app/(auth)/recover/page.tsx',
  'app/(auth)/oauth/authorize/page.tsx',
  'app/onboarding/page.tsx',
  'app/(app)/billing/return/page.tsx',
  'components/settings/billing-settings.tsx',
  'components/marketing/hero.tsx',
  'components/marketing/agents-strip.tsx',
  'components/marketing/closing-section.tsx',
  'components/marketing/marketing-cta.tsx',
  'components/marketing/pricing-products.tsx',
  'components/onboarding/onboarding-copy.ts',
  'components/onboarding/step-connect.tsx',
  'components/onboarding/step-intent.tsx',
  'components/onboarding/step-passkey.tsx',
] as const;

/** Remove source comments so the gate covers interface copy rather than engineering notes. */
function interfaceSource(relativePath: string): string {
  return readFileSync(resolve(SRC, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const publicCopy = PUBLIC_COPY_FILES.map(interfaceSource).join('\n');

describe('public copy gate', () => {
  it('uses the approved position exactly once', () => {
    const position =
      'Docket is one tool for planning, scheduling, and tracking every kind of work.';
    expect(publicCopy.split(position)).toHaveLength(2);
    expect(publicCopy).toContain(
      'Each task carries its estimate, its place on the calendar, and the hours it took.',
    );
  });

  it.each([
    'command center',
    'calm home',
    'launchpad',
    'mission-driven',
    'nothing slips through the cracks',
    'You’re already signed in.',
    "You're already signed in.",
    'Pick up where you left off.',
    'Priority Support',
    'nonprofit pricing',
    'pricing tier',
    'plan tier',
    'Approved AI clients',
  ])('does not contain the generated-copy phrase %s', (phrase) => {
    expect(publicCopy.toLowerCase()).not.toContain(phrase.toLowerCase());
  });

  it('does not restore the removed personal welcome step', () => {
    expect(publicCopy).not.toContain('personal-welcome');
    expect(publicCopy).not.toContain('Create your space');
  });
});
