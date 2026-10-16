import { galleryOutline, galleryContainer } from './builders';
/** Events use target-relative preparation; undated records remain deliberately undated. */
export const EVENTS_GALLERY = [
  galleryOutline({
    slug: 'meeting',
    purpose:
      'Run a focused meeting with useful preparation, clear decisions and an accessible record.',
    actions: [
      [
        'agenda',
        'Prepare agenda',
        'Name the decisions and discussion outcomes the meeting should produce.',
        -3,
      ],
      [
        'materials',
        'Prepare meeting materials',
        'Provide the relevant records early enough for participants to prepare.',
        -1,
      ],
      [
        'run',
        'Run meeting',
        'Guide the discussion toward the agenda’s decisions and capture assigned actions.',
        0,
      ],
      [
        'minutes',
        'Publish minutes',
        'Share the decisions and action owners in the meeting’s canonical record.',
        1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'monthly-general-meeting',
    purpose:
      'Prepare a useful general meeting with a shared slide deck, contributions and a clear invitation.',
    actions: [
      [
        'deck',
        'Build the deck',
        'Create the deck from the approved Google Slides template and link it here; keep the slides in Google Slides.',
        -7,
      ],
      [
        'slides',
        'Ask the team for slides',
        'Share the deck, requested contributions and the actual contribution deadline.',
        -5,
      ],
      [
        'announce',
        'Make the announcement',
        'Publish the meeting time, access details and purpose through the agreed channels.',
        -3,
      ],
    ],
  }),
  galleryOutline({
    slug: 'workshop',
    purpose:
      'Deliver an accessible workshop that has a clear learning outcome and useful feedback.',
    actions: [
      [
        'curriculum',
        'Prepare workshop curriculum',
        'Define the learning outcome and sequence exercises that support it.',
        -21,
      ],
      [
        'registration',
        'Open registration',
        'Publish practical joining information and collect only necessary participant details.',
        -14,
      ],
      [
        'materials',
        'Prepare workshop materials',
        'Check the exercises, equipment and accessible participant materials.',
        -3,
      ],
      [
        'deliver',
        'Deliver workshop',
        'Guide the activities and adapt to participants without losing the intended outcome.',
        0,
      ],
      [
        'feedback',
        'Gather workshop feedback',
        'Ask what participants learned and what should improve in the next session.',
        1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'conference',
    purpose: 'Coordinate the venue, content, participants and operations of a well-run conference.',
    actions: [
      [
        'venue',
        'Secure conference venue',
        'Confirm capacity, accessibility, services and contractual terms.',
        -90,
      ],
      [
        'speakers',
        'Confirm speakers',
        'Agree the session topics, practical requirements and participation terms.',
        -60,
      ],
      [
        'registration',
        'Prepare conference registration',
        'Publish accurate program information and joining arrangements.',
        -45,
      ],
      [
        'sponsors',
        'Confirm sponsors',
        'Agree benefits, commitments and responsibilities with sponsors.',
        -30,
      ],
      [
        'run',
        'Run conference',
        'Coordinate the event-day plan and respond to practical issues.',
        0,
      ],
      [
        'followups',
        'Complete conference follow-ups',
        'Share promised materials, thank contributors and record improvements.',
        3,
      ],
    ],
  }),
  galleryOutline({
    slug: 'conference-talk',
    purpose: 'Prepare and deliver a talk that makes a clear contribution to its intended audience.',
    actions: [
      [
        'abstract',
        'Write talk abstract',
        'State the audience’s problem and the argument or lesson the talk offers.',
        -45,
      ],
      [
        'slides',
        'Build talk slides',
        'Support the narrative with readable, attributable visuals and examples.',
        -14,
      ],
      [
        'rehearse',
        'Rehearse talk',
        'Check timing, transitions, accessibility and the actual presentation setup.',
        -3,
      ],
      [
        'deliver',
        'Deliver talk',
        'Present the approved talk and provide the promised references.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'product-demo-day',
    purpose:
      'Show real product capabilities to a prepared audience and turn feedback into useful follow-up.',
    actions: [
      [
        'invite',
        'Invite demo audience',
        'Identify the people who can give relevant feedback and explain the demo’s purpose.',
        -14,
      ],
      [
        'demos',
        'Prepare demos',
        'Rehearse realistic product workflows and provide a fallback for technical failure.',
        -3,
      ],
      [
        'run',
        'Run demo day',
        'Show the verified capabilities and capture concrete questions and feedback.',
        0,
      ],
      [
        'followup',
        'Follow up on demos',
        'Answer open questions and assign the feedback that needs action.',
        2,
      ],
    ],
  }),
  galleryOutline({
    slug: 'event',
    purpose:
      'Host an event with a secured venue, prepared participants and a dependable event-day plan.',
    steps: [
      galleryContainer({
        key: 'book_venue',
        kind: 'task',
        name: 'Book venue',
        purpose: 'Secure an appropriate, accessible venue for the event.',
        checklist:
          'Confirm capacity, accessibility and the intended event date.|Retain the approved booking and cancellation terms.',
        templateSlug: 'vendor-booking',
        days: -21,
      }),
      galleryContainer({
        key: 'promote',
        kind: 'task',
        name: 'Promote event',
        purpose: 'Reach the intended participants with accurate event information.',
        checklist:
          'Publish the purpose, joining details and accessibility information through the agreed channels.',
        days: -14,
      }),
      galleryContainer({
        key: 'headcount',
        kind: 'task',
        name: 'Confirm headcount',
        purpose: 'Prepare capacity, catering and materials for the actual expected attendance.',
        checklist:
          'Reconcile registrations and confirm the practical numbers with relevant vendors.',
        days: -7,
      }),
      galleryContainer({
        key: 'run',
        kind: 'task',
        name: 'Run event',
        purpose: 'Deliver the event-day plan and support participants.',
        checklist: 'Confirm the host, venue access, materials and contingency contacts.',
        days: 0,
      }),
      galleryContainer({
        key: 'thank_you',
        kind: 'task',
        name: 'Send thank-yous',
        purpose: 'Recognize contributors and keep the event’s follow-up commitments.',
        checklist: 'Thank participants and partners, share promised materials and record feedback.',
        days: 1,
      }),
    ],
  }),
];
