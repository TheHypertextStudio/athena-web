/**
 * `@docket/api` — the daily-digest generator (the Sunsama-style hero feature).
 *
 * @remarks
 * {@link sweepDailyDigests} is the "find-who's-due" engine, mirroring
 * {@link sweepConnectorSync}: for every Hub that has opted in (`preferences.digest.enabled`),
 * it computes the user's local date + clock time from their IANA `timezone` and, once the
 * local send time has passed and no digest exists for today, generates one. Generation
 * aggregates the day's {@link observation}s, narrates them via the {@link Summarizer}, renders
 * Markdown → HTML, sends via the {@link Mailer}, and persists a {@link dailyDigest} row.
 *
 * The unique `(user_id, digest_date)` index is the idempotency watermark — a `generating`
 * row is claimed with `onConflictDoNothing`, so a second cron tick (or a crash-retry) never
 * double-sends. A no-activity day records `skipped_empty` and sends nothing (cost control).
 * `now` is always passed in. Cross-org + user-scoped: one digest per person per day.
 */
import { activityDay, activityHighlight, dailyDigest, db, hub, user } from '@docket/db';
import { and, asc, eq, sql } from 'drizzle-orm';

import { localDateOf, zonedParts } from '../lib/activity/local-day';
import { joinLabels, sourceLabel, type SourceSystemKind } from '@docket/types';
import { buildHighlightsDayPayload } from '../services/highlights/read';
import { reconcileDay } from '../services/highlights/reconcile';
import { dispatchSystemUserNotification } from '../services/notifications/system';

/** The default local send time when a Hub enabled digests without choosing one. */
const DEFAULT_SEND_AT = '18:00';
/** The same default as minutes-since-midnight (the fallback for an unparseable send time). */
const DEFAULT_SEND_MINUTES = 18 * 60;

/** The result of one daily-digest sweep. */
export interface DigestSweepResult {
  /** Hubs whose local send time had passed and had no digest yet (selected this run). */
  readonly due: number;
  /** Digests generated and emailed. */
  readonly sent: number;
  /** Due users skipped because the day had no activity (`skipped_empty`). */
  readonly skippedEmpty: number;
  /** Users skipped this run: not yet their local send time, or today's digest already exists. */
  readonly skipped: number;
  /** Generations that errored (recorded on the row). */
  readonly failed: number;
}

/** Parse `"HH:MM"` to minutes-since-midnight, defaulting to {@link DEFAULT_SEND_MINUTES}. */
function sendMinutes(sendAtLocalTime: string | undefined): number {
  const [h, m] = (sendAtLocalTime ?? DEFAULT_SEND_AT).split(':');
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return DEFAULT_SEND_MINUTES;
  return hh * 60 + mm;
}

/**
 * A tiny Markdown → HTML renderer for the digest subset (h1, bullets, bold, paragraphs).
 *
 * @remarks
 * Exported so its line-shape branches (a list closing mid-document vs. at the very end, an
 * empty vs. non-empty trailing paragraph) are directly unit-testable without depending on
 * exactly what the summarizer happens to render for a given day's observations.
 */
export function markdownToHtml(md: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string): string => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const out: string[] = [];
  let inList = false;
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
    if (line.startsWith('# ')) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.length > 0) out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

/**
 * Assemble the delivered Markdown from narrated highlights.
 *
 * @remarks
 * Pure, and assembled at send time rather than stored by the narrator, so what somebody received is
 * frozen at the moment it went out.
 *
 * @param input - The day label, the recipient, and the highlights to include.
 * @returns the digest Markdown.
 */
export function assembleHighlightsMarkdown(input: {
  readonly dateLabel: string;
  readonly recipientName?: string | null;
  readonly highlights: readonly { readonly sentence: string }[];
  /** Sources that could not be read for this day, so the email can say the list is partial. */
  readonly unreadSources?: readonly SourceSystemKind[];
}): string {
  const greeting = input.recipientName
    ? `Hi ${input.recipientName} — here's what you did on ${input.dateLabel}:`
    : `Here's what you did on ${input.dateLabel}:`;
  const body =
    input.highlights.length > 0
      ? input.highlights.map((highlight) => `- ${highlight.sentence}`).join('\n')
      : '_No tracked activity today._';
  // The connector-reliability invariant on this surface. An email is read once and believed, so a day
  // assembled from sources that could not all be reached must say so — otherwise a GitHub outage and
  // a day with no pull requests produce the same message, and the reader has no way to tell that what
  // they are being told they did is incomplete. App-owned copy naming the source, never a provider's
  // diagnostic.
  const unread = input.unreadSources ?? [];
  const caveat =
    unread.length > 0
      ? `\n\n_${joinLabels(unread.map(sourceLabel))} could not be read for this day, so anything from ${unread.length > 1 ? 'those' : 'there'} is missing._`
      : '';
  return `# Your day\n\n${greeting}\n\n${body}${caveat}`;
}

/** Generate, send, and persist one user's digest for their local day. Returns the outcome. */
async function generateForUser(
  candidate: { userId: string; email: string; name: string | null; tz: string; sendAt: string },
  now: Date,
): Promise<'sent' | 'empty' | 'skipped' | 'failed'> {
  const parts = zonedParts(now, candidate.tz);
  const localDate = localDateOf(parts);
  const localMinutes = parts.h * 60 + parts.mi;
  if (localMinutes < sendMinutes(candidate.sendAt)) return 'skipped'; // not yet send time today

  // Claim today's digest atomically — the unique (user_id, digest_date, cadence) index dedups
  // ticks. (Cadence defaults to 'eod'; the multi-cadence lunch/eow fan-out is a later milestone.)
  const [claimed] = await db
    .insert(dailyDigest)
    .values({
      userId: candidate.userId,
      digestDate: localDate,
      cadence: 'eod',
      status: 'generating',
    })
    .onConflictDoNothing({
      target: [dailyDigest.userId, dailyDigest.digestDate, dailyDigest.cadence],
    })
    .returning({ id: dailyDigest.id });

  // A row already exists. Usually that means this day was handled and there is nothing to do — but a
  // `failed` row means an earlier tick could not deliver it, and without a way back that day's email
  // is lost permanently to one transient error. The events and highlights are intact, and narration
  // retries on its own, so taking the row back and trying again is almost always the right answer.
  //
  // The status predicate is the concurrency control: two ticks racing means one `UPDATE` matches and
  // the other returns nothing, exactly as the insert's conflict clause behaves. Retries are naturally
  // bounded — the sweep only runs a day after its local send time, and tomorrow is a different
  // `digestDate`.
  const claim =
    claimed ??
    (
      await db
        .update(dailyDigest)
        .set({ status: 'generating', lastError: null })
        .where(
          and(
            eq(dailyDigest.userId, candidate.userId),
            eq(dailyDigest.digestDate, localDate),
            eq(dailyDigest.cadence, 'eod'),
            eq(dailyDigest.status, 'failed'),
          ),
        )
        .returning({ id: dailyDigest.id })
    )[0];
  if (!claim) return 'skipped';

  try {
    // Make the day current, then deliver it. The digest does not narrate: `reconcileDay` owns that,
    // so opening the review early and receiving the email later cannot produce two different days,
    // and a day already narrated by an early open costs no second model call here.
    await reconcileDay(candidate.userId, localDate, now);

    const [day] = await db
      .select({
        id: activityDay.id,
        status: activityDay.status,
        eventCount: activityDay.eventCount,
        stats: activityDay.stats,
      })
      .from(activityDay)
      .where(and(eq(activityDay.userId, candidate.userId), eq(activityDay.localDate, localDate)))
      .limit(1);

    if (!day || day.status === 'empty') {
      await db
        .update(dailyDigest)
        .set({ status: 'skipped_empty', eventCount: 0, generatedAt: now })
        .where(eq(dailyDigest.id, claim.id));
      return 'empty';
    }

    // Only what the person kept. Assembling here rather than storing it at narration time is what
    // makes the delivered artifact reflect their curation, and freezes it once it has gone out.
    const kept = await db
      .select({
        narration: activityHighlight.narration,
        editedNarration: activityHighlight.editedNarration,
      })
      .from(activityHighlight)
      .where(and(eq(activityHighlight.activityDayId, day.id), eq(activityHighlight.kept, true)))
      .orderBy(asc(activityHighlight.sort));

    const dateLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: candidate.tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now);

    // Curated to nothing: the person dropped every line, so there is nothing they want said. That
    // is a decision, not a failure, and the right response is silence.
    if (kept.length === 0) {
      await db
        .update(dailyDigest)
        .set({
          status: 'skipped_empty',
          activityDayId: day.id,
          eventCount: day.eventCount,
          generatedAt: now,
        })
        .where(eq(dailyDigest.id, claim.id));
      return 'empty';
    }

    const highlights = kept.flatMap((row) => {
      const sentence = row.editedNarration ?? row.narration;
      // A line with no sentence is left out rather than delivered blank; it is still in the record,
      // and the review surface shows it and offers a rewrite.
      return sentence === null ? [] : [{ sentence }];
    });

    // The day happened but has no prose — narration failed for all of it. An email is a one-shot
    // artifact, so neither option here is acceptable: saying nothing happened would be false, and
    // sending an empty list says nothing at all. Record the delivery as failed and leave the record
    // standing; the in-app review still shows the whole day.
    if (highlights.length === 0) {
      await db
        .update(dailyDigest)
        .set({
          status: 'failed',
          activityDayId: day.id,
          eventCount: day.eventCount,
          lastError: 'the day has no narrated highlights to deliver',
        })
        .where(eq(dailyDigest.id, claim.id));
      return 'failed';
    }
    // Read through the same builder the app and the agent use, so the email's account of which
    // sources were reachable is the account the panel gives — not a second opinion assembled here.
    const { sources } = await buildHighlightsDayPayload(candidate.userId, localDate, now);
    const unreadSources = sources
      .filter((source) => source.state === 'failed' || source.state === 'disconnected')
      .map((source) => source.system);

    const markdown = assembleHighlightsMarkdown({
      dateLabel,
      recipientName: candidate.name,
      highlights,
      unreadSources,
    });
    const html = markdownToHtml(markdown);

    const subject = `Your Docket digest — ${dateLabel}`;
    const delivery = await dispatchSystemUserNotification(db, {
      userId: candidate.userId,
      email: candidate.email,
      category: 'digest',
      priority: 'normal',
      channels: ['email'],
      subject,
      body: {
        html,
        text: markdown,
      },
      preferenceMode: 'skip_user_preferences',
    });
    if (delivery.status !== 'sent') {
      throw new Error('digest notification delivery failed');
    }

    await db
      .update(dailyDigest)
      .set({
        status: 'sent',
        activityDayId: day.id,
        summaryMarkdown: markdown,
        summaryHtml: html,
        stats: day.stats,
        eventCount: day.eventCount,
        generatedAt: now,
        sentAt: now,
      })
      .where(eq(dailyDigest.id, claim.id));
    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'digest generation error';
    await db
      .update(dailyDigest)
      .set({ status: 'failed', lastError: message })
      .where(eq(dailyDigest.id, claim.id));
    return 'failed';
  }
}

/**
 * Run the daily-digest sweep: for every opted-in Hub past its local send time with no digest
 * yet, generate and email one. Idempotent + safe to retry (the unique watermark dedups).
 *
 * @param now - The sweep's reference time (read at request time, never module scope).
 */
export async function sweepDailyDigests(now: Date): Promise<DigestSweepResult> {
  const candidates = await db
    .select({
      userId: hub.userId,
      preferences: hub.preferences,
      email: user.email,
      name: user.name,
    })
    .from(hub)
    .innerJoin(user, eq(user.id, hub.userId))
    .where(sql`${hub.preferences}->'digest'->>'enabled' = 'true'`);

  let sent = 0;
  let skippedEmpty = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of candidates) {
    const tz = row.preferences.timezone ?? 'UTC';
    const outcome = await generateForUser(
      {
        userId: row.userId,
        email: row.email,
        name: row.name,
        tz,
        sendAt: row.preferences.digest?.sendAtLocalTime ?? DEFAULT_SEND_AT,
      },
      now,
    );
    if (outcome === 'skipped') skipped += 1;
    else if (outcome === 'sent') sent += 1;
    else if (outcome === 'empty') skippedEmpty += 1;
    else failed += 1;
  }

  // `due` = users that passed the send-time gate and weren't already done this run.
  return { due: sent + skippedEmpty + failed, sent, skippedEmpty, skipped, failed };
}
