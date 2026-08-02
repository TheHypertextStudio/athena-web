/**
 * `@docket/api` — one sample question of each response type, for local development only.
 *
 * @remarks
 * The elicitation surface can only be built, reviewed, or screenshotted against real questions, and
 * a real question is raised by a model deciding it is blocked. Locally there is no model — the
 * deterministic turn runtime replays a fixed script — so without this the surface would be
 * unreachable in exactly the environment it is developed in.
 *
 * Two properties keep this from being a fake: the questions it raises go through
 * {@link raiseElicitation} like any other, so they carry real tasks, real deadlines and real
 * timeout policies; and the route that calls it refuses outside a local stack, so nothing here can
 * reach a person's production workspace.
 */
import { actor, db } from '@docket/db';
import type { ElicitationRequest } from '@docket/types';
import { and, eq } from 'drizzle-orm';

import { ownerActorIn, resolveCanonicalConversation } from '../routes/agent-dispatch';

import {
  listElicitationsFor,
  raiseElicitation,
  type ElicitationWithTask,
} from './elicitation-service';

/** One question per response type the product promises, each with a real action to authorize. */
const SAMPLES: readonly ElicitationRequest[] = [
  {
    question: 'Should I post it now, or hold until the standup?',
    actionSummary: 'Post the sprint update to the Acme project channel',
    spec: { kind: 'confirm', confirmLabel: 'Post it now', declineLabel: 'Hold until standup' },
    timeoutPolicy: 'ambiguous',
    autoResolveValue: null,
    autoResolveReason: null,
    timeSensitive: true,
  },
  {
    question: 'Which channel should the update go to?',
    actionSummary: 'Send the weekly summary to one project channel',
    spec: {
      kind: 'select',
      multiple: false,
      options: [
        { value: 'acme', label: 'Acme project', description: 'Where the last four updates went' },
        { value: 'ops', label: 'Operations', description: 'Wider audience, slower replies' },
        { value: 'leads', label: 'Leads only', description: 'Three people' },
      ],
    },
    timeoutPolicy: 'derivable',
    autoResolveValue: 'acme',
    autoResolveReason: 'Every previous update in this project went to the Acme channel.',
    timeSensitive: false,
  },
  {
    question: 'What should the opening line say?',
    actionSummary: 'Open the newsletter with a line in your own words',
    spec: {
      kind: 'text',
      multiline: true,
      minLength: 10,
      maxLength: 280,
      placeholder: 'This week we shipped…',
    },
    timeoutPolicy: 'ambiguous',
    autoResolveValue: null,
    autoResolveReason: null,
    timeSensitive: false,
  },
  {
    question: 'When should it go out?',
    actionSummary: 'Schedule the newsletter send',
    spec: {
      kind: 'datetime',
      precision: 'datetime',
      timeZone: 'America/Chicago',
      min: null,
      max: null,
    },
    timeoutPolicy: 'ambiguous',
    autoResolveValue: null,
    autoResolveReason: null,
    timeSensitive: false,
  },
  {
    question: 'Which file is the signed version?',
    actionSummary: 'Attach the signed contractor agreement to the vendor thread',
    spec: {
      kind: 'file',
      accept: ['application/pdf'],
      maxBytes: 10 * 1024 * 1024,
      multiple: false,
    },
    timeoutPolicy: 'destructive',
    autoResolveValue: null,
    autoResolveReason: null,
    timeSensitive: false,
  },
  {
    question: 'How should I set up the offsite booking?',
    actionSummary: 'Book the offsite venue and send the invitations',
    spec: {
      kind: 'form',
      fields: [
        {
          key: 'venue',
          label: 'Venue',
          description: 'Where the offsite happens.',
          required: true,
          control: {
            kind: 'text',
            multiline: false,
            minLength: 3,
            maxLength: 80,
            placeholder: 'The Foundry',
          },
        },
        {
          key: 'headcount',
          label: 'Headcount',
          description: null,
          required: true,
          control: { kind: 'number', integer: true, min: 1, max: 200 },
        },
        {
          key: 'day',
          label: 'Day',
          description: null,
          required: true,
          control: {
            kind: 'datetime',
            precision: 'date',
            timeZone: 'America/Chicago',
            min: null,
            max: null,
          },
        },
        {
          key: 'catering',
          label: 'Catering',
          description: null,
          required: true,
          control: {
            kind: 'select',
            multiple: false,
            options: [
              { value: 'none', label: 'None', description: null },
              { value: 'lunch', label: 'Lunch only', description: null },
              { value: 'full', label: 'Full day', description: null },
            ],
          },
        },
        {
          key: 'notes',
          label: 'Notes for the venue',
          description: 'Anything they should know in advance.',
          required: false,
          control: {
            kind: 'text',
            multiline: true,
            minLength: null,
            maxLength: 500,
            placeholder: null,
          },
        },
      ],
    },
    timeoutPolicy: 'ambiguous',
    autoResolveValue: null,
    autoResolveReason: null,
    timeSensitive: false,
  },
];

/**
 * Raise one sample question of each response type against the caller's conversation.
 *
 * @param ownerUserId - The person to ask.
 * @returns Every question now addressed to them, newest first.
 * @throws {ConflictError} When the caller has no Athena conversation to raise them against.
 */
export async function raiseSampleElicitations(
  ownerUserId: string,
): Promise<readonly ElicitationWithTask[]> {
  // The same door every other entry point uses, so the samples land in the one conversation the
  // person actually has rather than in a parallel thread built for the demo.
  const organizationId = await personalWorkspaceOf(ownerUserId);
  const initiatorActorId = organizationId ? await ownerActorIn(ownerUserId, organizationId) : null;
  const session = await resolveCanonicalConversation(ownerUserId, organizationId, initiatorActorId);

  for (const request of SAMPLES) {
    await raiseElicitation({ sessionId: session.id, request });
  }
  return listElicitationsFor(ownerUserId);
}

/** The workspace this person belongs to, so a sample question has somewhere to file its task. */
async function personalWorkspaceOf(ownerUserId: string): Promise<string | null> {
  const rows = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(and(eq(actor.userId, ownerUserId), eq(actor.kind, 'human'), eq(actor.status, 'active')))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}
