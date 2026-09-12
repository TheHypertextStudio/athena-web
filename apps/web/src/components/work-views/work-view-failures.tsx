'use client';

/**
 * The chrome-level failure states a work view can show alongside working content.
 *
 * @remarks
 * Separated from `work-view-page.tsx` so the page reads as its layout rather than as its error
 * handling, and so each state's suppression rule lives with the state it suppresses.
 */
import { RefreshCw } from '@docket/ui/icons';
import {
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

/**
 * Recovery for saved views that failed to load, sized to what the viewer actually lost.
 *
 * Saved views are an optional layer over a surface that still works without them, so this degrades
 * to absence rather than announcing itself: the built-in tabs render as usual and the row ends with
 * one quiet glyph. A red sentence wedged between the tabs broke the row's rhythm and claimed the
 * same weight as a failure that empties the page.
 */
export function SavedViewsRetry({
  error,
  contentFailed,
  onRetry,
}: {
  readonly error: unknown;
  /** Silent while the content itself has failed: the recovery state below already owns it. */
  readonly contentFailed: boolean;
  readonly onRetry?: (() => void) | undefined;
}): JSX.Element | null {
  if (contentFailed || !error || !onRetry) return null;
  const label = 'Saved views could not load. Retry.';
  return (
    <>
      {/* Polite, not assertive: nothing here interrupts what the viewer is already doing. */}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {label}
      </span>
      {/*
        Provided locally rather than inherited: Radix throws without an ancestor provider, so a
        hint about a minor failure could otherwise take down the whole surface. Nesting inside the
        app-wide provider is supported and keeps this control safe wherever it is rendered.
      */}
      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              iconOnly
              controlSize="sm"
              className="shrink-0"
              aria-label={label}
              onClick={onRetry}
            >
              <RefreshCw aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </>
  );
}

/** Report a saved-view create or update that the server refused, beside the dialog that tried it. */
export function SaveViewFailure({ error }: { readonly error: unknown }): JSX.Element | null {
  if (!error) return null;
  return (
    <p role="alert" className="text-error text-body-medium">
      Could not save this view. Check the details and try again.
    </p>
  );
}

/**
 * The failures of operations layered over working content: pagination, preferences, the default.
 *
 * @remarks
 * Each row owns its own retry, because each is a different operation with a different recovery. All
 * of them go quiet while the content itself has failed — see `contentFailed`.
 */
export function WorkViewOperationFailures({
  title,
  contentFailed,
  rootContinuationError,
  onRetryRoot,
  preferencesError,
  preferencesUnavailable,
  onRetryPreferences,
  defaultError,
  onRetryDefault,
}: {
  readonly title: string;
  /**
   * A lower altitude never speaks while a higher one has failed. With the content gone, none of
   * these operations is available to act on, so their rows would be noise stacked above a recovery
   * state that already explains the situation and offers the only useful action.
   */
  readonly contentFailed: boolean;
  readonly rootContinuationError: unknown;
  readonly onRetryRoot: () => void;
  readonly preferencesError: unknown;
  /** Stored view settings could not be read, so presentation changes are not being saved. */
  readonly preferencesUnavailable: boolean;
  readonly onRetryPreferences: () => void;
  readonly defaultError: unknown;
  readonly onRetryDefault: () => void;
}): JSX.Element {
  if (contentFailed) return <></>;
  return (
    <>
      {rootContinuationError ? (
        <p role="alert" className="text-error text-body-medium flex items-center gap-2 px-3 py-2">
          Could not load more {title.toLowerCase()}.
          <Button variant="ghost" controlSize="sm" onClick={onRetryRoot}>
            Retry
          </Button>
        </p>
      ) : null}
      {preferencesError ? (
        <p role="alert" className="text-error text-body-medium flex items-center gap-2 px-3 py-2">
          Could not save your view preferences.
          <Button variant="ghost" controlSize="sm" onClick={onRetryPreferences}>
            Retry
          </Button>
        </p>
      ) : null}
      {/*
        Not cosmetic. Presentation changes are refused while the stored settings are unknown,
        because sending a list built on a failed read replaces the stored one and erases every
        other view's settings. Saying so is the difference between that and changes that appear
        to work and quietly do not.
      */}
      {preferencesUnavailable ? (
        <p role="alert" className="text-error text-body-medium flex items-center gap-2 px-3 py-2">
          Your view settings could not be loaded, so changes to this view are not being saved.
          <Button variant="ghost" controlSize="sm" onClick={onRetryPreferences}>
            Retry
          </Button>
        </p>
      ) : null}
      {defaultError ? (
        <p role="alert" className="text-error text-body-medium flex items-center gap-2 px-3 py-2">
          Could not set the workspace view default.
          <Button variant="ghost" controlSize="sm" onClick={onRetryDefault}>
            Retry
          </Button>
        </p>
      ) : null}
    </>
  );
}
