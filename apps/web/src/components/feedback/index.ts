/**
 * `components/feedback` — how the product tells a person something went wrong.
 *
 * @remarks
 * The taxonomy is in `docs/engineering/specs/error-presentation.md`. In short: a failed action
 * becomes a notice ({@link presentFailure}); a region that could not load becomes a
 * {@link LoadFailure}; a partial failure with rows still on screen is an `InlineBanner`; and the
 * one inline error is a `FieldError` under the control it is about. Nothing else in product code
 * paints error state.
 */
export { presentFailure, type PresentFailureOptions } from './failure-toast';
export { LoadFailure, type LoadFailureProps } from './load-failure';
