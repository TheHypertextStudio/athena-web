'use client';

import { CheckCircle2 } from '@docket/ui/icons';
import { Row, Stack, Surface, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX } from 'react';

import type { AdminMetrics } from '@/lib/types';

/** What kind of attention a signal is asking for, which is what earns it colour. */
type SignalTone = 'work' | 'fault';

/** One thing that may need an operator. */
interface Signal {
  /** What the number counts. */
  readonly label: string;
  /** How many, or `undefined` while the read has not resolved. */
  readonly count: number | undefined;
  /** Where the operator goes to act on it, when there is such a screen. */
  readonly href?: string | undefined;
  /** Whether this is work waiting or something that failed. */
  readonly tone: SignalTone;
}

/** The tonal treatment a signal takes once it is asking for something. */
const RAISED_TONE: Readonly<Record<SignalTone, string>> = {
  work: 'bg-primary-container text-on-primary-container',
  fault: 'bg-error-container text-on-error-container',
};

/**
 * Every signal that can demand an operator's time, read from the metrics response.
 *
 * @param metrics - The platform metrics, or `undefined` before they resolve.
 * @returns the signals in the order an operator should scan them.
 */
function signalsOf(metrics: AdminMetrics | undefined): readonly Signal[] {
  const pendingDeletion = metrics?.orgsByLifecycle.find(
    (bucket) => bucket.lifecycleState === 'pending_deletion',
  )?.count;

  return [
    {
      label: 'Discount reviews',
      count: metrics?.queues.pendingDiscountReviews,
      href: '/discounts',
      tone: 'work',
    },
    { label: 'Awaiting approval', count: metrics?.queues.stuckApprovals, tone: 'work' },
    { label: 'Failed sessions', count: metrics?.queues.agentErrors, tone: 'fault' },
    { label: 'Pending deletion', count: pendingDeletion, href: '/orgs', tone: 'fault' },
    {
      label: 'Retention holds',
      count: metrics?.queues.activeHolds,
      href: '/lifecycle',
      tone: 'work',
    },
  ];
}

/** Props for {@link AttentionBand}. */
export interface AttentionBandProps {
  /** The platform metrics, or `undefined` before they resolve. */
  readonly metrics: AdminMetrics | undefined;
}

/**
 * The first thing on the dashboard: what, if anything, needs a person right now.
 *
 * @remarks
 * The screen used to open with twelve counters of equal weight, so "Sessions run" and "Failed
 * sessions" looked alike and nothing said which mattered. These five are the only numbers that can
 * ask for something, so they lead, and the rest of the page is context beneath them.
 *
 * A signal at zero is deliberately quiet — plain tone, muted numeral. It raises to a tonal
 * container only when it is actually asking, which is what makes a non-zero one findable without
 * reading a single label. Colour is earned twice over here: `work` for a queue waiting on a
 * decision, `error` for something that failed, and nothing else.
 *
 * When every signal is zero the band collapses to one line rather than five zeroes, because "you
 * are clear" is a different message from "here are five numbers that happen to be zero" and an
 * operator should be able to read it at a glance.
 *
 * @param props - See {@link AttentionBandProps}.
 * @returns the attention band.
 */
export function AttentionBand({ metrics }: AttentionBandProps): JSX.Element {
  const signals = signalsOf(metrics);
  const resolved = metrics !== undefined;
  const clear = resolved && signals.every((signal) => (signal.count ?? 0) === 0);

  if (clear) {
    return (
      <Surface tone="card" shape="medium" pad="roomy">
        <Row gap={3} align="center">
          <CheckCircle2 aria-hidden="true" className="text-state-completed size-5 shrink-0" />
          <Text as="p" token="title-medium">
            Nothing needs you
          </Text>
        </Row>
      </Surface>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-5">
      {signals.map((signal) => (
        <SignalTile key={signal.label} signal={signal} />
      ))}
    </div>
  );
}

/** One signal, quiet at zero and raised when it is asking for something. */
function SignalTile({ signal }: { readonly signal: Signal }): JSX.Element {
  const raised = (signal.count ?? 0) > 0;
  const body = (
    <Stack gap={1}>
      <Text as="p" token="display-small" numeric>
        {signal.count === undefined ? '—' : signal.count.toLocaleString()}
      </Text>
      <Text as="p" token="label-medium" className={raised ? undefined : 'text-on-surface-variant'}>
        {signal.label}
      </Text>
    </Stack>
  );

  // A raised signal is the one an operator reaches for, so it carries the tonal container and,
  // where a screen exists to act on it, becomes the link there.
  const className = raised ? RAISED_TONE[signal.tone] : undefined;

  if (raised && signal.href) {
    return (
      <Surface
        tone="card"
        shape="medium"
        pad="roomy"
        className={`${className ?? ''} transition-opacity hover:opacity-90`}
      >
        <Link href={signal.href} className="block">
          {body}
        </Link>
      </Surface>
    );
  }

  return (
    <Surface tone="card" shape="medium" pad="roomy" {...(className ? { className } : {})}>
      {body}
    </Surface>
  );
}
