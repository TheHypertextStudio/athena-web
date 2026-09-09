/**
 * Run one interactive Twilio Verify canary without placing the destination or code in arguments.
 */
import { cancel, isCancel, outro, password, text } from '@clack/prompts';

import { TwilioVerifyProvider } from '../apps/api/src/routes/phone-verification-provider';

/** Validate the trial-safe US E.164 destination accepted by this release. */
export function parseCanaryDestination(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  if (!/^\+1[2-9]\d{9}$/.test(normalized)) {
    throw new Error('Enter one US number in E.164 form, such as +14155550123.');
  }
  return normalized;
}

/** Validate the six-digit code accepted by Twilio Verify. */
export function parseCanaryCode(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  if (!/^\d{6}$/.test(normalized)) {
    throw new Error('Enter the 6-digit code.');
  }
  return normalized;
}

/** Redact a destination before writing canary progress. */
export function maskCanaryDestination(value: string): string {
  return `${value.slice(0, 2)}••••••••${value.slice(-2)}`;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const destination = await text({
    message: 'Verified US handset in E.164 form',
    validate: (value) => {
      try {
        parseCanaryDestination(value);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : 'Enter a valid US number.';
      }
    },
  });
  if (isCancel(destination)) {
    cancel('Twilio Verify canary canceled.');
    return;
  }

  const to = parseCanaryDestination(destination);
  const provider = new TwilioVerifyProvider({
    apiKeySid: requiredEnv('TWILIO_VERIFY_API_KEY_SID'),
    apiKeySecret: requiredEnv('TWILIO_VERIFY_API_KEY_SECRET'),
    serviceSid: requiredEnv('TWILIO_VERIFY_SERVICE_SID'),
  });
  const started = await provider.start(to);
  if (started.status !== 'pending') {
    throw new Error(`Twilio returned terminal status ${started.status} before code entry.`);
  }

  const code = await password({
    message: `Verification code sent to ${maskCanaryDestination(to)}`,
    mask: '•',
    validate: (value) => {
      try {
        parseCanaryCode(value);
        return undefined;
      } catch (error) {
        return error instanceof Error ? error.message : 'Enter the 6-digit code.';
      }
    },
  });
  if (isCancel(code)) {
    cancel('Twilio Verify canary canceled.');
    return;
  }

  const checked = await provider.check(to, parseCanaryCode(code));
  if (checked.status !== 'approved') {
    throw new Error(`Twilio Verify did not approve the code. Status: ${checked.status}.`);
  }
  outro(`Twilio Verify approved ${maskCanaryDestination(to)}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Twilio Verify canary failed.');
    process.exitCode = 1;
  });
}
