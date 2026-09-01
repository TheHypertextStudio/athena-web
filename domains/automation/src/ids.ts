import { z } from 'zod';

const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ownedId = z.string().regex(ulid);

/** Automation Rule identifier. */
export const AutomationRuleId = ownedId
  .brand<'AutomationRuleId'>()
  .describe(
    'ULID id of an AutomationRule — a configured rule that triggers actions when matching events occur.',
  );
/** Automation Rule identifier value. */
export type AutomationRuleId = z.infer<typeof AutomationRuleId>;
