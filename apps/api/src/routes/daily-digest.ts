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
import { dailyDigest, db, event, hub, user } from '@docket/db';
import type { ActorRef, DigestStats, EntityRef } from '@docket/db';
import type { NarrationEpisode } from '@docket/agent-runtime';
import type { CanonicalEntityKind, EventDetail, EventKind, SourceSystemKind } from '@docket/types';
import { groupSubjectDayEpisodes } from '@docket/types';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';

import { getContainer } from '../container';
import { dispatchSystemUserNotification } from '../services/notifications/system';

/** The default local send time when a Hub enabled digests without choosing one. */
const DEFAULT_SEND_AT = '18:00';
/** The same default as minutes-since-midnight (the fallback for an unparseable send time). */
const DEFAULT_SEND_MINUTES = 18 * 60;

/**
 * The event columns the digest reads.
 *
 * @remarks
 * Wider than it once was because grouping needs identity: an episode is defined by its *subject*, so
 * the entity and actor references and the resolved Docket id all have to be present before the day
 * can be divided into stories.
 */
interface DigestRow {
  readonly id: string;
  readonly organizationId: string;
  readonly sourceSystem: SourceSystemKind;
  readonly kind: EventKind;
  readonly occurredAt: Date;
  readonly title: string;
  readonly summary: string | null;
  readonly actor: ActorRef | null;
  readonly entity: EntityRef | null;
  readonly entityKind: CanonicalEntityKind | null;
  readonly docketEntityId: string | null;
  readonly detail: EventDetail | null;
}

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

/** The wall-clock parts of an instant in a timezone. */
interface ZonedParts {
  readonly y: number;
  readonly mo: number;
  readonly d: number;
  readonly h: number;
  readonly mi: number;
}

/**
 * Cached `Intl.DateTimeFormat` per timezone.
 *
 * @remarks
 * Formatter construction loads locale/tz data and is relatively expensive; the digest sweep
 * calls {@link zonedParts} several times per user (and once per not-yet-due user), with users
 * heavily sharing timezones — so one formatter per tz is reused across the whole sweep.
 */
const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let fmt = PARTS_FORMATTERS.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    PARTS_FORMATTERS.set(tz, fmt);
  }
  return fmt;
}

/** The wall-clock parts of an instant in a timezone (`hourCycle: h23`). */
function zonedParts(instant: Date, tz: string): ZonedParts {
  const parts = partsFormatter(tz).formatToParts(instant);
  const pick = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  return {
    y: pick('year'),
    mo: pick('month'),
    d: pick('day'),
    h: pick('hour'),
    mi: pick('minute'),
  };
}

/** The tz's UTC offset (ms) at `instant`: the wall-clock-as-UTC minus the instant. */
function tzOffsetMs(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - instant.getTime();
}

/** The UTC instant of the local midnight that begins the day described by `parts` in `tz`. */
function localDayStartUtc(parts: ZonedParts, tz: string): Date {
  const midnightGuess = Date.UTC(parts.y, parts.mo - 1, parts.d, 0, 0);
  return new Date(midnightGuess - tzOffsetMs(new Date(midnightGuess), tz));
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
 * Group a day's events into the episodes narration works on.
 *
 * @remarks
 * Uses the shared grouping from `@docket/types`, the same function the client renders with, so the
 * server cannot narrate a different set of stories than the app shows. Keyed by
 * `(subject, local date)`, which is stable under the late and out-of-order arrivals a poll produces.
 */
function toNarrationEpisodes(rows: readonly DigestRow[], localDate: string): NarrationEpisode[] {
  const episodes = groupSubjectDayEpisodes(
    rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      system: row.sourceSystem,
      kind: row.kind,
      occurredAt: row.occurredAt.toISOString(),
      entityKind: row.entityKind,
      entityExternalId: row.entity?.externalId ?? null,
      entityDocketId: row.docketEntityId,
      actorDocketId: row.actor?.docketActorId ?? null,
      actorSource: row.actor?.source ?? null,
      actorExternalId: row.actor?.externalId ?? null,
      actorName: row.actor?.displayName ?? null,
      detail: row.detail,
      // Carried through so the narration prompt can read them without a second lookup.
      title: row.title,
      summary: row.summary,
      entityTitle: row.entity?.title ?? null,
    })),
    localDate,
  );

  return episodes.map((episode) => {
    const anchor = episode.allEvents[0];
    return {
      key: episode.key,
      /* v8 ignore next -- an episode always has at least one event */
      provider: anchor?.system ?? 'docket',
      ...(anchor?.entityTitle ? { subject: anchor.entityTitle } : {}),
      /* v8 ignore next 2 -- as above */
      startedAt: anchor?.occurredAt ?? localDate,
      endedAt:
        episode.allEvents[episode.allEvents.length - 1]?.occurredAt ??
        anchor?.occurredAt ??
        localDate,
      // Only the substantive events are narrated; minor ones stay in the record and out of the
      // prompt, so a burst of reactions cannot dominate the sentence about real work.
      events: (episode.visibleEvents.length > 0 ? episode.visibleEvents : episode.allEvents).map(
        (event) => ({
          kind: event.kind,
          occurredAt: event.occurredAt,
          title: event.title,
          ...(event.summary ? { summary: event.summary } : {}),
          ...(event.actorName ? { actor: event.actorName } : {}),
        }),
      ),
    };
  });
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
}): string {
  const greeting = input.recipientName
    ? `Hi ${input.recipientName} — here's what you did on ${input.dateLabel}:`
    : `Here's what you did on ${input.dateLabel}:`;
  const body =
    input.highlights.length > 0
      ? input.highlights.map((highlight) => `- ${highlight.sentence}`).join('\n')
      : '_No tracked activity today._';
  return `# Your day\n\n${greeting}\n\n${body}`;
}

/** Build the per-source / per-kind stat counts for a day's events. */
function buildStats(rows: readonly DigestRow[]): DigestStats {
  const bySource: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const row of rows) {
    bySource[row.sourceSystem] = (bySource[row.sourceSystem] ?? 0) + 1;
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  }
  return { total: rows.length, bySource, byKind };
}

/** Generate, send, and persist one user's digest for their local day. Returns the outcome. */
async function generateForUser(
  candidate: { userId: string; email: string; name: string | null; tz: string; sendAt: string },
  now: Date,
): Promise<'sent' | 'empty' | 'skipped' | 'failed'> {
  const parts = zonedParts(now, candidate.tz);
  const localDate = `${String(parts.y)}-${String(parts.mo).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
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
  if (!claimed) return 'skipped';

  try {
    const dayStart = localDayStartUtc(parts, candidate.tz);
    const rows = await db
      .select({
        id: event.id,
        organizationId: event.organizationId,
        sourceSystem: event.sourceSystem,
        kind: event.kind,
        occurredAt: event.occurredAt,
        title: event.title,
        summary: event.summary,
        actor: event.actor,
        entity: event.entity,
        entityKind: event.entityKind,
        docketEntityId: event.docketEntityId,
        detail: event.detail,
      })
      .from(event)
      .where(
        and(
          eq(event.userId, candidate.userId),
          gte(event.occurredAt, dayStart),
          lte(event.occurredAt, now),
        ),
      )
      .orderBy(asc(event.occurredAt));

    if (rows.length === 0) {
      await db
        .update(dailyDigest)
        .set({ status: 'skipped_empty', eventCount: 0, generatedAt: now })
        .where(eq(dailyDigest.id, claimed.id));
      return 'empty';
    }

    const dateLabel = new Intl.DateTimeFormat('en-US', {
      timeZone: candidate.tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(now);

    const { summarizer } = getContainer();
    const { highlights } = await summarizer.narrateDay({
      dateLabel,
      ...(candidate.name ? { recipientName: candidate.name } : {}),
      episodes: toNarrationEpisodes(rows, localDate),
    });
    const markdown = assembleHighlightsMarkdown({
      dateLabel,
      recipientName: candidate.name,
      highlights,
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
        summaryMarkdown: markdown,
        summaryHtml: html,
        stats: buildStats(rows),
        eventCount: rows.length,
        generatedAt: now,
        sentAt: now,
      })
      .where(eq(dailyDigest.id, claimed.id));
    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'digest generation error';
    await db
      .update(dailyDigest)
      .set({ status: 'failed', lastError: message })
      .where(eq(dailyDigest.id, claimed.id));
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
