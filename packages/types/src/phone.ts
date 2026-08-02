/**
 * `@docket/types` — the phone number a person binds to their Docket account so they can call Athena.
 *
 * @remarks
 * A phone number is a **credential**, not a profile field: it is the only thing that turns an
 * anonymous inbound call into "this is Ada's conversation". Three consequences are encoded here
 * rather than left to the API layer:
 *
 * 1. **A number is entered as a dial code plus a national number, never as a free-form string.**
 *    {@link PhoneNumberCreate} has no `e164` field at all, so a client cannot skip the country
 *    choice and submit `5551234` — the ambiguity that makes "+1 555 1234" and "+44 555 1234"
 *    indistinguishable at the switch.
 * 2. **The full number is never returned.** Every read shape carries {@link PhoneNumberOut.masked}
 *    and the dial code, never the national digits. A stolen session token must not become a
 *    directory of its owner's phone numbers.
 * 3. **Format validation is structural, not authoritative.** We check shape (E.164 length bounds,
 *    a leading non-zero country digit) because a malformed number cannot be dialled — but the
 *    real proof of ownership is that a one-time code sent to the number comes back. A number that
 *    passes this regex and cannot receive SMS simply never becomes `verified`.
 *
 * @see {@link ../../../docs/engineering/specs/voice-and-phone.md} for the full flow.
 */
import { z } from 'zod';

/**
 * The E.164 shape: `+`, a country digit 1–9, then 6–14 more digits.
 *
 * @remarks
 * E.164 caps the whole number at 15 digits including the country code. The lower bound is
 * deliberately loose (7 total) — some national numbering plans really are that short — because
 * rejecting a valid number is a worse failure here than accepting one that will never verify.
 */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

/** A phone number in E.164 form (`+14155550123`). */
export const E164 = z.string().regex(E164_PATTERN, 'Enter a valid phone number.');
/** E.164-formatted phone number. */
export type E164 = z.infer<typeof E164>;

/**
 * Where a bound phone number sits in its lifecycle.
 *
 * @remarks
 * `pending` and `verified` are the two states a person creates. `blocked` is staff-applied and is
 * checked on the inbound call path *before* account resolution, so revoking phone access does not
 * depend on the user deleting the row.
 */
export const PhoneNumberStatus = z.enum(['pending', 'verified', 'blocked']);
/** Phone-number lifecycle state. */
export type PhoneNumberStatus = z.infer<typeof PhoneNumberStatus>;

/** One selectable calling country: ISO 3166-1 alpha-2, display name, and E.164 country code. */
export interface DialCodeOption {
  /** ISO 3166-1 alpha-2 code, used as the option's stable key. */
  readonly iso2: string;
  /** Display name shown in the country selector. */
  readonly name: string;
  /** E.164 country calling code, digits only, no `+`. */
  readonly dialCode: string;
}

/**
 * Every ITU country calling code, for the account-settings country selector.
 *
 * @remarks
 * Shipped as data rather than fetched so the selector renders on first paint with no request,
 * and so an offline PWA session can still start a verification. Ordered by display name.
 * Territories that share a parent's calling code (Puerto Rico on +1, Jersey on +44) are listed
 * separately because a person looks for their own country's name, not their parent state's.
 */
export const DIAL_CODES: readonly DialCodeOption[] = [
  { iso2: 'AF', name: 'Afghanistan', dialCode: '93' },
  { iso2: 'AL', name: 'Albania', dialCode: '355' },
  { iso2: 'DZ', name: 'Algeria', dialCode: '213' },
  { iso2: 'AD', name: 'Andorra', dialCode: '376' },
  { iso2: 'AO', name: 'Angola', dialCode: '244' },
  { iso2: 'AG', name: 'Antigua and Barbuda', dialCode: '1268' },
  { iso2: 'AR', name: 'Argentina', dialCode: '54' },
  { iso2: 'AM', name: 'Armenia', dialCode: '374' },
  { iso2: 'AW', name: 'Aruba', dialCode: '297' },
  { iso2: 'AU', name: 'Australia', dialCode: '61' },
  { iso2: 'AT', name: 'Austria', dialCode: '43' },
  { iso2: 'AZ', name: 'Azerbaijan', dialCode: '994' },
  { iso2: 'BS', name: 'Bahamas', dialCode: '1242' },
  { iso2: 'BH', name: 'Bahrain', dialCode: '973' },
  { iso2: 'BD', name: 'Bangladesh', dialCode: '880' },
  { iso2: 'BB', name: 'Barbados', dialCode: '1246' },
  { iso2: 'BY', name: 'Belarus', dialCode: '375' },
  { iso2: 'BE', name: 'Belgium', dialCode: '32' },
  { iso2: 'BZ', name: 'Belize', dialCode: '501' },
  { iso2: 'BJ', name: 'Benin', dialCode: '229' },
  { iso2: 'BM', name: 'Bermuda', dialCode: '1441' },
  { iso2: 'BT', name: 'Bhutan', dialCode: '975' },
  { iso2: 'BO', name: 'Bolivia', dialCode: '591' },
  { iso2: 'BA', name: 'Bosnia and Herzegovina', dialCode: '387' },
  { iso2: 'BW', name: 'Botswana', dialCode: '267' },
  { iso2: 'BR', name: 'Brazil', dialCode: '55' },
  { iso2: 'BN', name: 'Brunei', dialCode: '673' },
  { iso2: 'BG', name: 'Bulgaria', dialCode: '359' },
  { iso2: 'BF', name: 'Burkina Faso', dialCode: '226' },
  { iso2: 'BI', name: 'Burundi', dialCode: '257' },
  { iso2: 'KH', name: 'Cambodia', dialCode: '855' },
  { iso2: 'CM', name: 'Cameroon', dialCode: '237' },
  { iso2: 'CA', name: 'Canada', dialCode: '1' },
  { iso2: 'CV', name: 'Cape Verde', dialCode: '238' },
  { iso2: 'KY', name: 'Cayman Islands', dialCode: '1345' },
  { iso2: 'CF', name: 'Central African Republic', dialCode: '236' },
  { iso2: 'TD', name: 'Chad', dialCode: '235' },
  { iso2: 'CL', name: 'Chile', dialCode: '56' },
  { iso2: 'CN', name: 'China', dialCode: '86' },
  { iso2: 'CO', name: 'Colombia', dialCode: '57' },
  { iso2: 'KM', name: 'Comoros', dialCode: '269' },
  { iso2: 'CG', name: 'Congo', dialCode: '242' },
  { iso2: 'CD', name: 'Congo (DRC)', dialCode: '243' },
  { iso2: 'CR', name: 'Costa Rica', dialCode: '506' },
  { iso2: 'CI', name: "Côte d'Ivoire", dialCode: '225' },
  { iso2: 'HR', name: 'Croatia', dialCode: '385' },
  { iso2: 'CU', name: 'Cuba', dialCode: '53' },
  { iso2: 'CW', name: 'Curaçao', dialCode: '599' },
  { iso2: 'CY', name: 'Cyprus', dialCode: '357' },
  { iso2: 'CZ', name: 'Czechia', dialCode: '420' },
  { iso2: 'DK', name: 'Denmark', dialCode: '45' },
  { iso2: 'DJ', name: 'Djibouti', dialCode: '253' },
  { iso2: 'DM', name: 'Dominica', dialCode: '1767' },
  { iso2: 'DO', name: 'Dominican Republic', dialCode: '1809' },
  { iso2: 'EC', name: 'Ecuador', dialCode: '593' },
  { iso2: 'EG', name: 'Egypt', dialCode: '20' },
  { iso2: 'SV', name: 'El Salvador', dialCode: '503' },
  { iso2: 'GQ', name: 'Equatorial Guinea', dialCode: '240' },
  { iso2: 'ER', name: 'Eritrea', dialCode: '291' },
  { iso2: 'EE', name: 'Estonia', dialCode: '372' },
  { iso2: 'SZ', name: 'Eswatini', dialCode: '268' },
  { iso2: 'ET', name: 'Ethiopia', dialCode: '251' },
  { iso2: 'FJ', name: 'Fiji', dialCode: '679' },
  { iso2: 'FI', name: 'Finland', dialCode: '358' },
  { iso2: 'FR', name: 'France', dialCode: '33' },
  { iso2: 'GF', name: 'French Guiana', dialCode: '594' },
  { iso2: 'PF', name: 'French Polynesia', dialCode: '689' },
  { iso2: 'GA', name: 'Gabon', dialCode: '241' },
  { iso2: 'GM', name: 'Gambia', dialCode: '220' },
  { iso2: 'GE', name: 'Georgia', dialCode: '995' },
  { iso2: 'DE', name: 'Germany', dialCode: '49' },
  { iso2: 'GH', name: 'Ghana', dialCode: '233' },
  { iso2: 'GI', name: 'Gibraltar', dialCode: '350' },
  { iso2: 'GR', name: 'Greece', dialCode: '30' },
  { iso2: 'GL', name: 'Greenland', dialCode: '299' },
  { iso2: 'GD', name: 'Grenada', dialCode: '1473' },
  { iso2: 'GP', name: 'Guadeloupe', dialCode: '590' },
  { iso2: 'GU', name: 'Guam', dialCode: '1671' },
  { iso2: 'GT', name: 'Guatemala', dialCode: '502' },
  { iso2: 'GG', name: 'Guernsey', dialCode: '44' },
  { iso2: 'GN', name: 'Guinea', dialCode: '224' },
  { iso2: 'GW', name: 'Guinea-Bissau', dialCode: '245' },
  { iso2: 'GY', name: 'Guyana', dialCode: '592' },
  { iso2: 'HT', name: 'Haiti', dialCode: '509' },
  { iso2: 'HN', name: 'Honduras', dialCode: '504' },
  { iso2: 'HK', name: 'Hong Kong', dialCode: '852' },
  { iso2: 'HU', name: 'Hungary', dialCode: '36' },
  { iso2: 'IS', name: 'Iceland', dialCode: '354' },
  { iso2: 'IN', name: 'India', dialCode: '91' },
  { iso2: 'ID', name: 'Indonesia', dialCode: '62' },
  { iso2: 'IR', name: 'Iran', dialCode: '98' },
  { iso2: 'IQ', name: 'Iraq', dialCode: '964' },
  { iso2: 'IE', name: 'Ireland', dialCode: '353' },
  { iso2: 'IM', name: 'Isle of Man', dialCode: '44' },
  { iso2: 'IL', name: 'Israel', dialCode: '972' },
  { iso2: 'IT', name: 'Italy', dialCode: '39' },
  { iso2: 'JM', name: 'Jamaica', dialCode: '1876' },
  { iso2: 'JP', name: 'Japan', dialCode: '81' },
  { iso2: 'JE', name: 'Jersey', dialCode: '44' },
  { iso2: 'JO', name: 'Jordan', dialCode: '962' },
  { iso2: 'KZ', name: 'Kazakhstan', dialCode: '7' },
  { iso2: 'KE', name: 'Kenya', dialCode: '254' },
  { iso2: 'KI', name: 'Kiribati', dialCode: '686' },
  { iso2: 'KW', name: 'Kuwait', dialCode: '965' },
  { iso2: 'KG', name: 'Kyrgyzstan', dialCode: '996' },
  { iso2: 'LA', name: 'Laos', dialCode: '856' },
  { iso2: 'LV', name: 'Latvia', dialCode: '371' },
  { iso2: 'LB', name: 'Lebanon', dialCode: '961' },
  { iso2: 'LS', name: 'Lesotho', dialCode: '266' },
  { iso2: 'LR', name: 'Liberia', dialCode: '231' },
  { iso2: 'LY', name: 'Libya', dialCode: '218' },
  { iso2: 'LI', name: 'Liechtenstein', dialCode: '423' },
  { iso2: 'LT', name: 'Lithuania', dialCode: '370' },
  { iso2: 'LU', name: 'Luxembourg', dialCode: '352' },
  { iso2: 'MO', name: 'Macao', dialCode: '853' },
  { iso2: 'MG', name: 'Madagascar', dialCode: '261' },
  { iso2: 'MW', name: 'Malawi', dialCode: '265' },
  { iso2: 'MY', name: 'Malaysia', dialCode: '60' },
  { iso2: 'MV', name: 'Maldives', dialCode: '960' },
  { iso2: 'ML', name: 'Mali', dialCode: '223' },
  { iso2: 'MT', name: 'Malta', dialCode: '356' },
  { iso2: 'MH', name: 'Marshall Islands', dialCode: '692' },
  { iso2: 'MQ', name: 'Martinique', dialCode: '596' },
  { iso2: 'MR', name: 'Mauritania', dialCode: '222' },
  { iso2: 'MU', name: 'Mauritius', dialCode: '230' },
  { iso2: 'MX', name: 'Mexico', dialCode: '52' },
  { iso2: 'FM', name: 'Micronesia', dialCode: '691' },
  { iso2: 'MD', name: 'Moldova', dialCode: '373' },
  { iso2: 'MC', name: 'Monaco', dialCode: '377' },
  { iso2: 'MN', name: 'Mongolia', dialCode: '976' },
  { iso2: 'ME', name: 'Montenegro', dialCode: '382' },
  { iso2: 'MA', name: 'Morocco', dialCode: '212' },
  { iso2: 'MZ', name: 'Mozambique', dialCode: '258' },
  { iso2: 'MM', name: 'Myanmar', dialCode: '95' },
  { iso2: 'NA', name: 'Namibia', dialCode: '264' },
  { iso2: 'NP', name: 'Nepal', dialCode: '977' },
  { iso2: 'NL', name: 'Netherlands', dialCode: '31' },
  { iso2: 'NC', name: 'New Caledonia', dialCode: '687' },
  { iso2: 'NZ', name: 'New Zealand', dialCode: '64' },
  { iso2: 'NI', name: 'Nicaragua', dialCode: '505' },
  { iso2: 'NE', name: 'Niger', dialCode: '227' },
  { iso2: 'NG', name: 'Nigeria', dialCode: '234' },
  { iso2: 'MK', name: 'North Macedonia', dialCode: '389' },
  { iso2: 'NO', name: 'Norway', dialCode: '47' },
  { iso2: 'OM', name: 'Oman', dialCode: '968' },
  { iso2: 'PK', name: 'Pakistan', dialCode: '92' },
  { iso2: 'PW', name: 'Palau', dialCode: '680' },
  { iso2: 'PS', name: 'Palestine', dialCode: '970' },
  { iso2: 'PA', name: 'Panama', dialCode: '507' },
  { iso2: 'PG', name: 'Papua New Guinea', dialCode: '675' },
  { iso2: 'PY', name: 'Paraguay', dialCode: '595' },
  { iso2: 'PE', name: 'Peru', dialCode: '51' },
  { iso2: 'PH', name: 'Philippines', dialCode: '63' },
  { iso2: 'PL', name: 'Poland', dialCode: '48' },
  { iso2: 'PT', name: 'Portugal', dialCode: '351' },
  { iso2: 'PR', name: 'Puerto Rico', dialCode: '1787' },
  { iso2: 'QA', name: 'Qatar', dialCode: '974' },
  { iso2: 'RE', name: 'Réunion', dialCode: '262' },
  { iso2: 'RO', name: 'Romania', dialCode: '40' },
  { iso2: 'RU', name: 'Russia', dialCode: '7' },
  { iso2: 'RW', name: 'Rwanda', dialCode: '250' },
  { iso2: 'WS', name: 'Samoa', dialCode: '685' },
  { iso2: 'SM', name: 'San Marino', dialCode: '378' },
  { iso2: 'SA', name: 'Saudi Arabia', dialCode: '966' },
  { iso2: 'SN', name: 'Senegal', dialCode: '221' },
  { iso2: 'RS', name: 'Serbia', dialCode: '381' },
  { iso2: 'SC', name: 'Seychelles', dialCode: '248' },
  { iso2: 'SL', name: 'Sierra Leone', dialCode: '232' },
  { iso2: 'SG', name: 'Singapore', dialCode: '65' },
  { iso2: 'SK', name: 'Slovakia', dialCode: '421' },
  { iso2: 'SI', name: 'Slovenia', dialCode: '386' },
  { iso2: 'SB', name: 'Solomon Islands', dialCode: '677' },
  { iso2: 'SO', name: 'Somalia', dialCode: '252' },
  { iso2: 'ZA', name: 'South Africa', dialCode: '27' },
  { iso2: 'KR', name: 'South Korea', dialCode: '82' },
  { iso2: 'SS', name: 'South Sudan', dialCode: '211' },
  { iso2: 'ES', name: 'Spain', dialCode: '34' },
  { iso2: 'LK', name: 'Sri Lanka', dialCode: '94' },
  { iso2: 'SD', name: 'Sudan', dialCode: '249' },
  { iso2: 'SR', name: 'Suriname', dialCode: '597' },
  { iso2: 'SE', name: 'Sweden', dialCode: '46' },
  { iso2: 'CH', name: 'Switzerland', dialCode: '41' },
  { iso2: 'SY', name: 'Syria', dialCode: '963' },
  { iso2: 'TW', name: 'Taiwan', dialCode: '886' },
  { iso2: 'TJ', name: 'Tajikistan', dialCode: '992' },
  { iso2: 'TZ', name: 'Tanzania', dialCode: '255' },
  { iso2: 'TH', name: 'Thailand', dialCode: '66' },
  { iso2: 'TL', name: 'Timor-Leste', dialCode: '670' },
  { iso2: 'TG', name: 'Togo', dialCode: '228' },
  { iso2: 'TO', name: 'Tonga', dialCode: '676' },
  { iso2: 'TT', name: 'Trinidad and Tobago', dialCode: '1868' },
  { iso2: 'TN', name: 'Tunisia', dialCode: '216' },
  { iso2: 'TR', name: 'Türkiye', dialCode: '90' },
  { iso2: 'TM', name: 'Turkmenistan', dialCode: '993' },
  { iso2: 'TV', name: 'Tuvalu', dialCode: '688' },
  { iso2: 'UG', name: 'Uganda', dialCode: '256' },
  { iso2: 'UA', name: 'Ukraine', dialCode: '380' },
  { iso2: 'AE', name: 'United Arab Emirates', dialCode: '971' },
  { iso2: 'GB', name: 'United Kingdom', dialCode: '44' },
  { iso2: 'US', name: 'United States', dialCode: '1' },
  { iso2: 'UY', name: 'Uruguay', dialCode: '598' },
  { iso2: 'UZ', name: 'Uzbekistan', dialCode: '998' },
  { iso2: 'VU', name: 'Vanuatu', dialCode: '678' },
  { iso2: 'VA', name: 'Vatican City', dialCode: '379' },
  { iso2: 'VE', name: 'Venezuela', dialCode: '58' },
  { iso2: 'VN', name: 'Vietnam', dialCode: '84' },
  { iso2: 'YE', name: 'Yemen', dialCode: '967' },
  { iso2: 'ZM', name: 'Zambia', dialCode: '260' },
  { iso2: 'ZW', name: 'Zimbabwe', dialCode: '263' },
];

/** The dial code preselected when a person has never bound a number. */
export const DEFAULT_DIAL_CODE = '1';

/** Every dial code the selector offers, deduplicated — the server's allowlist. */
export const ALLOWED_DIAL_CODES: ReadonlySet<string> = new Set(DIAL_CODES.map((d) => d.dialCode));

/**
 * Compose a dial code and a nationally-formatted number into E.164.
 *
 * @remarks
 * Strips every separator a person actually types — spaces, dashes, parentheses, dots — and drops
 * a single leading trunk zero, which most of Europe writes and no international dial string may
 * contain. Returns `null` rather than throwing when the result is not a plausible E.164 number,
 * because the caller always has a user-facing sentence to show and never wants an exception's text.
 *
 * @param dialCode - The E.164 country calling code, digits only.
 * @param nationalNumber - The number as typed, in national form.
 * @returns the E.164 string, or `null` when the pieces cannot compose a valid number.
 *
 * @example
 * ```typescript
 * composeE164('44', '(0)20 7946 0958'); // '+442079460958'
 * ```
 */
export function composeE164(dialCode: string, nationalNumber: string): E164 | null {
  const code = dialCode.replace(/\D/g, '');
  if (!code || !ALLOWED_DIAL_CODES.has(code)) return null;
  const national = nationalNumber.replace(/\D/g, '').replace(/^0+/, '');
  if (!national) return null;
  const candidate = `+${code}${national}`;
  return E164_PATTERN.test(candidate) ? candidate : null;
}

/**
 * Mask an E.164 number for display and logging: country code, then the last two digits.
 *
 * @remarks
 * The masked form is what every read shape and every log line carries. Keeping the country code
 * visible lets a person tell two of their own numbers apart; keeping only two trailing digits
 * means the masked value is not itself dialable.
 *
 * The dial code is passed in rather than parsed back out of the number, because it cannot be
 * parsed: country codes are 1–4 digits and are not self-delimiting, so `+14155550171` is
 * indistinguishable from a `+1415` country code by inspection. The binding stored the country the
 * person chose; that is the authority.
 *
 * @param e164 - The full number.
 * @param dialCode - The country calling code the number was entered under, digits only.
 * @returns e.g. `+1 ••• ••• ••23`.
 */
export function maskE164(e164: string, dialCode?: string): string {
  if (!/^\+\d+$/.test(e164)) return '•••';
  const digits = e164.slice(1);
  // `slice` on a non-empty string always yields a string, so the fallback is the leading digit
  // itself — enough to keep two of the caller's own numbers apart when no dial code was recorded.
  const code = dialCode && digits.startsWith(dialCode) ? dialCode : digits.slice(0, 1);
  const tail = digits.slice(-2);
  return `+${code} ••• ••• ••${tail}`;
}

/** A phone number bound to the caller's account, as the caller sees it. */
export const PhoneNumberOut = z
  .object({
    id: z.string(),
    /** Redacted display form — the full national number is never returned. */
    masked: z.string(),
    /** E.164 country calling code, digits only. */
    dialCode: z.string(),
    /** ISO 3166-1 alpha-2 country the number was entered under. */
    country: z.string(),
    status: PhoneNumberStatus,
    /** True when Athena will answer calls from this number. */
    callingEnabled: z.boolean(),
    verifiedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({
    id: 'PhoneNumberOut',
    description: 'A phone number bound to the account, always redacted.',
  });
/** Phone-number-out value. */
export type PhoneNumberOut = z.infer<typeof PhoneNumberOut>;

/** The caller's bound phone numbers. */
export const PhoneNumberListOut = z
  .object({ items: z.array(PhoneNumberOut) })
  .meta({ id: 'PhoneNumberListOut', description: 'Phone numbers bound to the account.' });
/** Phone-number-list-out value. */
export type PhoneNumberListOut = z.infer<typeof PhoneNumberListOut>;

/**
 * Bind a new phone number: a country choice plus the number as typed nationally.
 *
 * @remarks
 * There is deliberately no `e164` field. The country selector is the only way to supply a
 * calling code, which is what makes {@link composeE164} the single normalization site.
 */
export const PhoneNumberCreate = z
  .object({
    /** ISO 3166-1 alpha-2 country from the selector. */
    country: z.string().length(2),
    /** E.164 country calling code the selector carries alongside the country. */
    dialCode: z.string().min(1).max(4),
    /** The number as typed, in national form; separators are stripped server-side. */
    nationalNumber: z.string().min(1).max(24),
  })
  .meta({
    id: 'PhoneNumberCreate',
    description: 'Bind a phone number by country and national number.',
  });
/** Phone-number-create value. */
export type PhoneNumberCreate = z.infer<typeof PhoneNumberCreate>;

/** The 6-digit one-time code sent to the number. */
export const PhoneVerifyBody = z
  .object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') })
  .meta({ id: 'PhoneVerifyBody', description: 'The one-time code sent by SMS.' });
/** Phone-verify body value. */
export type PhoneVerifyBody = z.infer<typeof PhoneVerifyBody>;

/**
 * The live state of an outstanding verification challenge.
 *
 * @remarks
 * `attemptsRemaining` and `resendAvailableAt` are returned so the UI can render the real limits
 * instead of guessing them, and so a person is never left pressing a button that silently no-ops.
 * The code itself is never in this shape, in any environment.
 */
export const PhoneChallengeOut = z
  .object({
    phoneNumber: PhoneNumberOut,
    /** When the outstanding code stops being accepted. */
    expiresAt: z.string(),
    /** Wrong-code submissions still allowed before the challenge is destroyed. */
    attemptsRemaining: z.number().int(),
    /** When another code may be requested for this number. */
    resendAvailableAt: z.string(),
    /** True when the challenge could not be delivered and the number cannot be verified yet. */
    deliveryFailed: z.boolean(),
  })
  .meta({
    id: 'PhoneChallengeOut',
    description: 'The outstanding one-time-code challenge for a phone number.',
  });
/** Phone-challenge-out value. */
export type PhoneChallengeOut = z.infer<typeof PhoneChallengeOut>;

/** How many wrong codes a single challenge tolerates before it is destroyed. */
export const PHONE_VERIFICATION_MAX_ATTEMPTS = 5;
/** How long a one-time code stays valid. */
export const PHONE_VERIFICATION_TTL_MS = 10 * 60 * 1000;
/** Minimum gap between two code sends to the same number. */
export const PHONE_VERIFICATION_RESEND_INTERVAL_MS = 60 * 1000;
/** How many codes may be sent to one number within {@link PHONE_VERIFICATION_SEND_WINDOW_MS}. */
export const PHONE_VERIFICATION_MAX_SENDS = 5;
/** The rolling window the send cap applies over. */
export const PHONE_VERIFICATION_SEND_WINDOW_MS = 60 * 60 * 1000;
