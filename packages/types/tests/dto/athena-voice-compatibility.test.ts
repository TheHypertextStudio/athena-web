import {
  DEFAULT_DIAL_CODE as DomainDefaultDialCode,
  PhoneNumberOut as DomainPhoneNumberOut,
} from '@docket/athena/phone';
import {
  VoiceEventsBody as DomainVoiceEventsBodyFromVoice,
  VoiceInboundEvent as DomainVoiceInboundEventFromVoice,
} from '@docket/athena/voice';
import {
  DEFAULT_DIAL_CODE as LegacyDefaultDialCode,
  PhoneNumberOut as LegacyPhoneNumberOut,
  VoiceEventsBody as LegacyVoiceEventsBody,
  VoiceInboundEvent as LegacyVoiceInboundEvent,
} from '@docket/types';
import { describe, expect, it } from 'vitest';

describe('Athena voice compatibility', () => {
  it('re-exports the domain-owned voice schemas without making a second grammar', () => {
    expect(LegacyVoiceEventsBody).toBe(DomainVoiceEventsBodyFromVoice);
    expect(LegacyVoiceInboundEvent).toBe(DomainVoiceInboundEventFromVoice);
  });

  it('re-exports the domain-owned caller-phone schema and data without copying them', () => {
    expect(LegacyPhoneNumberOut).toBe(DomainPhoneNumberOut);
    expect(LegacyDefaultDialCode).toBe(DomainDefaultDialCode);
  });
});
