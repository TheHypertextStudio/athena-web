import { describe, expect, it } from 'vitest';

import { verificationCodeEmail } from '../src/emails';

describe('verificationCodeEmail', () => {
  it('carries the code in the subject and both bodies', () => {
    const email = verificationCodeEmail({ name: 'Ada', code: '482913' });
    expect(email.subject).toContain('482913');
    expect(email.text).toContain('482913');
    expect(email.html).toContain('482913');
  });

  it('greets by name when provided', () => {
    const email = verificationCodeEmail({ name: 'Ada', code: '000000' });
    expect(email.text.startsWith('Hi Ada,')).toBe(true);
    expect(email.html).toContain('Hi Ada,');
  });

  it('falls back to a generic greeting when the name is null or blank', () => {
    expect(verificationCodeEmail({ name: null, code: '000000' }).text.startsWith('Hi,')).toBe(true);
    expect(verificationCodeEmail({ name: '   ', code: '000000' }).text.startsWith('Hi,')).toBe(
      true,
    );
  });

  it('states the anti-abuse reassurance and expiry', () => {
    const email = verificationCodeEmail({ name: 'Ada', code: '482913' });
    expect(email.text).toContain('ignore this email');
    expect(email.text).toContain('expires in 10 minutes');
  });
});
