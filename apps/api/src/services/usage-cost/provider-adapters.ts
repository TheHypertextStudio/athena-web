/** Construct direct Messages adapters with capture before output parsing. */
import { defaultMessageCreator as narrationCreator, RealSummarizer } from '@docket/athena/digest';
import {
  defaultMessageCreator as synthesisCreator,
  RealTaskSynthesizer,
} from '@docket/athena/task-drafting/adapters/anthropic';
import { meterMessageCreator } from './direct-calls';

/** Build the day narrator without coupling the domain adapter to database persistence. */
export function meteredSummarizer(
  config: ConstructorParameters<typeof RealSummarizer>[0],
): RealSummarizer {
  return new RealSummarizer(config, meterMessageCreator(narrationCreator(config)));
}
/** Build the task adapter shared by email synthesis and task expansion. */
export function meteredTaskSynthesizer(
  config: ConstructorParameters<typeof RealTaskSynthesizer>[0],
): RealTaskSynthesizer {
  return new RealTaskSynthesizer(config, meterMessageCreator(synthesisCreator(config)));
}
