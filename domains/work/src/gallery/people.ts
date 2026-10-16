import { galleryOutline } from './builders';
/** People workflows make preparation, access and follow-through concrete without naming reusable assignees. */
export const PEOPLE_GALLERY = [
  galleryOutline({
    slug: 'hiring-a-role',
    purpose:
      'Fill a defined role through an organized, fair process with clear evaluation criteria.',
    actions: [
      [
        'post',
        'Post the role',
        'Agree the responsibilities, compensation context and selection criteria before publishing.',
      ],
      [
        'screen',
        'Screen applications',
        'Evaluate candidates against the stated criteria and retain only necessary records.',
      ],
      [
        'interviews',
        'Run interview loop',
        'Use consistent questions and capture evidence relevant to the role.',
      ],
      [
        'offer',
        'Make offer',
        'Confirm authorized terms, references and the candidate’s next steps.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'employee-onboarding',
    fields: [
      [
        'Planning anchor',
        'Set the Project target to the 90-day onboarding review; preparation and earlier check-ins count back from that date.',
      ],
    ],
    purpose:
      'Help a new employee gain access, understand expectations and receive support through the first 90 days.',
    actions: [
      [
        'accounts',
        'Prepare accounts',
        'Arrange authorized access and verify the new employee can use required systems.',
        -91,
      ],
      [
        'equipment',
        'Prepare equipment',
        'Confirm the necessary equipment, delivery and setup support.',
        -91,
      ],
      [
        'week_one',
        'Agree first-week plan',
        'Introduce key people, explain working arrangements and choose useful first tasks.',
        -90,
      ],
      [
        'day_30',
        'Hold 30-day check-in',
        'Review initial experience, access problems and clarity of expectations.',
        -60,
      ],
      [
        'day_60',
        'Hold 60-day check-in',
        'Discuss progress, support needs and the next responsibilities.',
        -30,
      ],
      [
        'day_90',
        'Hold 90-day check-in',
        'Review the onboarding outcomes and agree ongoing development priorities.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'offboarding',
    purpose:
      'Close a working relationship with a clear handover, appropriate access removal and respectful conversation.',
    actions: [
      [
        'handover',
        'Complete handover',
        'Transfer responsibilities, essential records and outstanding commitments to authorized owners.',
        -3,
      ],
      [
        'access',
        'Remove access',
        'Review and revoke access according to the actual departure arrangement.',
        0,
      ],
      [
        'conversation',
        'Hold exit conversation',
        'Offer a respectful conversation and record only appropriate, consent-aware feedback.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'performance-review-cycle',
    purpose:
      'Run a review cycle with grounded evidence, consistent calibration and useful development conversations.',
    actions: [
      [
        'self',
        'Collect self-reviews',
        'Invite reflection on actual outcomes, challenges and development goals.',
        -21,
      ],
      [
        'manager',
        'Prepare manager reviews',
        'Use relevant evidence and check feedback against the role’s expectations.',
        -14,
      ],
      [
        'calibration',
        'Calibrate reviews',
        'Review consistency and bias without disclosing unnecessary private information.',
        -7,
      ],
      [
        'conversations',
        'Hold review conversations',
        'Discuss the review, hear the employee’s response and agree practical next steps.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'one-on-one',
    purpose: 'Use a one-on-one for a useful conversation about progress, obstacles and support.',
    actions: [
      [
        'agenda',
        'Prepare one-on-one agenda',
        'Invite topics from both participants and identify decisions or support needed.',
      ],
      [
        'notes',
        'Record agreed notes',
        'Keep a concise shared record of useful decisions without unnecessary sensitive detail.',
      ],
      [
        'followups',
        'Track one-on-one follow-ups',
        'Assign the agreed next actions and make the next check-in clear.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'team-meeting',
    purpose:
      'Bring the team together for decisions and coordination that benefit from a shared conversation.',
    actions: [
      [
        'agenda',
        'Prepare team agenda',
        'Choose topics that need the group and state the intended outcome for each.',
      ],
      [
        'notes',
        'Record meeting notes',
        'Capture decisions, relevant context and unresolved questions in the canonical meeting record.',
      ],
      [
        'actions',
        'Assign action items',
        'Give each agreed action an owner and an actual timing commitment.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'team-offsite',
    purpose:
      'Prepare an accessible offsite with a clear purpose, practical arrangements and useful follow-up.',
    actions: [
      [
        'venue',
        'Book offsite venue',
        'Confirm accessibility, capacity, services and contractual terms.',
        -45,
      ],
      [
        'agenda',
        'Design offsite agenda',
        'Choose activities that serve the agreed team outcomes.',
        -21,
      ],
      [
        'travel',
        'Arrange offsite travel',
        'Coordinate authorized travel and accommodations with participants’ access needs.',
        -14,
      ],
      [
        'followups',
        'Complete offsite follow-ups',
        'Publish decisions and turn the agreed improvements into owned actions.',
        3,
      ],
    ],
  }),
  galleryOutline({
    slug: 'volunteer-onboarding',
    purpose:
      'Help a volunteer understand the role, complete necessary preparation and have a supported first shift.',
    actions: [
      [
        'paperwork',
        'Complete volunteer paperwork',
        'Collect only required agreements and checks through the approved records system.',
      ],
      [
        'orientation',
        'Provide volunteer orientation',
        'Explain the role, safeguarding or safety expectations and where to get help.',
      ],
      [
        'first_shift',
        'Support first volunteer shift',
        'Confirm practical arrangements and check the volunteer has the support needed.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'training-session',
    purpose:
      'Deliver training that gives participants a practical capability and a way to assess their learning.',
    actions: [
      [
        'materials',
        'Prepare training materials',
        'Create accessible instruction and exercises tied to the learning outcome.',
        -14,
      ],
      [
        'schedule',
        'Confirm training arrangements',
        'Agree participants, timing, location and necessary accommodations.',
        -7,
      ],
      [
        'deliver',
        'Deliver training',
        'Guide the session and check participants can apply the material.',
        0,
      ],
      [
        'feedback',
        'Gather training feedback',
        'Record what participants learned and the improvements needed for the next session.',
        1,
      ],
    ],
  }),
];
