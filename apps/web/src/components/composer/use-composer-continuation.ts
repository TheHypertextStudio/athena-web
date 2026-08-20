'use client';

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** Inputs shared by every create-and-continue composer. */
export interface UseComposerContinuationOptions {
  /** Whether the current mutation still disables the title field. */
  creating: boolean;
  /** Application-owned copy announced after a successful continued create. */
  successMessage: string;
}

/** State and lifecycle controls shared by every create-and-continue composer. */
export interface ComposerContinuationState {
  /** Whether ordinary submission should leave the composer open. */
  createMore: boolean;
  /** Change whether ordinary submission should leave the composer open. */
  setCreateMore: (checked: boolean) => void;
  /** Ref attached to the title so continued creation can restore focus. */
  titleInputRef: RefObject<HTMLInputElement | null>;
  /** Generation passed to the rich editor when its document must be cleared. */
  bodyResetGeneration: number;
  /** Polite announcement shown after a successful continued create. */
  statusMessage: string | null;
  /** Claim the current draft for submission, or reject a duplicate submission. */
  beginSubmission: () => boolean;
  /** Release the duplicate-submission guard after the mutation settles. */
  finishSubmission: () => void;
  /** Reset entity-specific text while preserving retained fields and queue title focus. */
  completeContinuation: (resetDraft: () => void) => void;
}

/**
 * Own the lifecycle that every create-and-continue composer shares.
 *
 * @param options - Mutation state and entity-specific success copy.
 * @returns continuation state, reset generation, focus ref, and submission guard.
 */
export function useComposerContinuation({
  creating,
  successMessage,
}: UseComposerContinuationOptions): ComposerContinuationState {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const focusTitleAfterContinuation = useRef(false);
  const [createMore, setCreateMore] = useState(false);
  const [bodyResetGeneration, setBodyResetGeneration] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (creating || !focusTitleAfterContinuation.current) return;
    // Picker popovers restore focus to their trigger when they finish closing. Defer one task so
    // that cleanup cannot steal focus back after a fast mutation resolves in the same turn.
    const focusTimer = window.setTimeout(() => {
      focusTitleAfterContinuation.current = false;
      titleInputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [bodyResetGeneration, creating]);

  const beginSubmission = useCallback((): boolean => {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    return true;
  }, []);

  const finishSubmission = useCallback((): void => {
    submittingRef.current = false;
  }, []);

  const completeContinuation = useCallback(
    (resetDraft: () => void): void => {
      focusTitleAfterContinuation.current = true;
      resetDraft();
      setBodyResetGeneration((current) => current + 1);
      setStatusMessage(successMessage);
    },
    [successMessage],
  );

  return {
    createMore,
    setCreateMore,
    titleInputRef,
    bodyResetGeneration,
    statusMessage,
    beginSubmission,
    finishSubmission,
    completeContinuation,
  };
}
