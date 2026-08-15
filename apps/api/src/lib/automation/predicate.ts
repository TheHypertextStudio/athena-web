/**
 * `@docket/api` — compatibility export for the automation predicate Interpreter.
 *
 * @remarks
 * The portable Automation Rules domain owns predicate evaluation. This legacy API module stays
 * as a direct alias while existing callers migrate to `@docket/automation/evaluation`.
 */

export { evaluatePredicate as evaluate } from '@docket/automation/evaluation';
