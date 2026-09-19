/**
 * `components/feedback` — how the product tells a person something went wrong.
 *
 * @remarks
 * The taxonomy is in `docs/engineering/specs/error-presentation.md`. In short: a failed action
 * becomes a notice ({@link presentFailure}); a region that could not load becomes a
 * {@link LoadFailure} (or {@link QueryLoadFailure} when one query fed it); a partial failure with
 * rows still on screen is a {@link PartialLoadBanner}; and the one inline error is a `FieldError`
 * under the control it is about. Nothing else in product code paints error state.
 */
export {
  presentFailure,
  presentRejectedResponse,
  type PresentFailureOptions,
} from './failure-toast';
export { LoadFailure, type LoadFailureProps } from './load-failure';
export { PartialLoadBanner, type PartialLoadBannerProps } from './partial-load-banner';
export {
  QueryLoadFailure,
  type QueryFailureSource,
  type QueryLoadFailureProps,
} from './query-load-failure';
export { RegionFrame, type RegionFrameProps } from './region-frame';
