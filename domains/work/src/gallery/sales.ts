import { galleryOutline } from './builders';
/** Client and commercial work makes scope, decisions and follow-up explicit. */
export const SALES_GALLERY = [
  galleryOutline({
    slug: 'proposal',
    purpose:
      'Prepare a credible proposal that connects a client need to clear scope, price and next steps.',
    actions: [
      [
        'discovery',
        'Hold discovery call',
        'Understand the client’s problem, constraints and decision process.',
      ],
      [
        'scope',
        'Define proposal scope',
        'Describe deliverables, exclusions, responsibilities and acceptance.',
      ],
      [
        'pricing',
        'Prepare pricing',
        'Explain the estimate, payment terms and assumptions behind the price.',
      ],
      [
        'send',
        'Send proposal',
        'Check the approved document and send it to the authorized decision maker.',
      ],
      [
        'followup',
        'Follow up on proposal',
        'Answer questions and record the actual next decision or deadline.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'customer-onboarding',
    fields: [
      [
        'Planning anchor',
        'Set the Project target to the 30-day customer check-in. Keep kickoff, setup and training dates tied to the actual agreed start.',
      ],
    ],
    purpose:
      'Help a new customer become ready to use the product or service with a clear support path.',
    actions: [
      [
        'kickoff',
        'Hold kickoff call',
        'Confirm the customer’s goals, stakeholders and first-use plan.',
      ],
      [
        'account',
        'Set up account',
        'Configure the agreed access and verify that the customer can use it.',
      ],
      [
        'training',
        'Deliver customer training',
        'Walk through the workflows relevant to the customer’s goals.',
      ],
      [
        'checkin',
        'Complete 30-day check-in',
        'Review actual usage, unresolved obstacles and the next useful improvement.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'monthly-client-report',
    purpose:
      'Give a client a concise, evidence-based account of results, interpretation and next actions.',
    actions: [
      [
        'results',
        'Pull monthly results',
        'Collect the reporting period’s authoritative measures and supporting records.',
        -5,
      ],
      [
        'summary',
        'Write results summary',
        'Explain what changed, why it matters and the limits of the evidence.',
        -3,
      ],
      [
        'review',
        'Review client report',
        'Verify calculations, scope and any claims before sharing.',
        -1,
      ],
      [
        'send',
        'Send client report',
        'Send the approved report and identify the decision or discussion it supports.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'deliverable-review',
    purpose:
      'Review an actual client deliverable against agreed requirements and resolve revisions clearly.',
    actions: [
      [
        'internal',
        'Complete internal review',
        'Check the deliverable against the brief, quality standards and contractual scope.',
      ],
      [
        'client',
        'Obtain client review',
        'Ask the authorized reviewer for specific feedback against the agreed criteria.',
      ],
      [
        'revisions',
        'Complete agreed revisions',
        'Resolve approved feedback and identify any request that changes scope.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'renewal-client',
    purpose:
      'Review a customer relationship and agree clear renewal terms before the current agreement ends.',
    actions: [
      [
        'usage',
        'Review customer usage',
        'Summarize actual value, use, unresolved problems and renewal risks.',
        -45,
      ],
      [
        'call',
        'Hold renewal call',
        'Discuss the customer’s current needs and the proposed continuation.',
        -30,
      ],
      [
        'terms',
        'Prepare updated terms',
        'Record agreed scope, price, duration and any changed obligations.',
        -14,
      ],
      [
        'signature',
        'Obtain renewal signature',
        'Secure the authorized agreement and retain the executed version.',
        -1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'churn-follow-up',
    purpose:
      'Understand why a customer left and close the relationship respectfully without losing useful learning.',
    actions: [
      [
        'reachout',
        'Reach out to departing customer',
        'Offer a brief conversation or written response without pressuring the customer.',
      ],
      [
        'reason',
        'Record departure reason',
        'Separate the customer’s stated reason from internal assumptions.',
      ],
      [
        'closeout',
        'Close out relationship',
        'Confirm access, data and commercial obligations and assign any useful follow-up.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'partnership',
    purpose:
      'Establish a mutually understood partnership and review whether it delivers the agreed value.',
    actions: [
      [
        'intro',
        'Hold partnership introduction',
        'Discuss the shared purpose, contribution and practical constraints.',
      ],
      [
        'terms',
        'Agree partnership terms',
        'Record responsibilities, permissions, decision rights and commercial terms.',
      ],
      [
        'announcement',
        'Announce partnership',
        'Publish only approved claims, names and commitments.',
      ],
      [
        'checkin',
        'Hold quarterly partnership check-in',
        'Review actual results and adjust the agreed next steps.',
        90,
      ],
    ],
  }),
  galleryOutline({
    slug: 'trade-show',
    purpose:
      'Prepare a trade-show presence that supports a clear commercial objective and effective follow-up.',
    actions: [
      [
        'register',
        'Register for trade show',
        'Confirm the event package, required information and attendance terms.',
        -90,
      ],
      [
        'booth',
        'Prepare booth',
        'Arrange the exhibit, accessible materials and practical setup requirements.',
        -30,
      ],
      [
        'staffing',
        'Plan booth staffing',
        'Confirm shifts, responsibilities and the conversation or lead-handling approach.',
        -14,
      ],
      [
        'travel',
        'Arrange travel',
        'Book authorized travel and lodging around actual staffing commitments.',
        -14,
      ],
      [
        'followups',
        'Complete trade-show follow-ups',
        'Follow up on agreed conversations and record the commercial outcome.',
        3,
      ],
    ],
  }),
  galleryOutline({
    slug: 'kickoff',
    purpose:
      'Start a client engagement with aligned scope, responsibilities and a practical delivery plan.',
    actions: [
      [
        'agenda',
        'Prepare kickoff agenda',
        'List the scope, stakeholders, decisions and working arrangements to confirm.',
        -3,
      ],
      [
        'scope',
        'Align engagement scope',
        'Review deliverables, exclusions, acceptance criteria and commercial assumptions.',
        0,
      ],
      [
        'owners',
        'Agree responsibilities',
        'Confirm who decides, contributes and reviews each part of the engagement.',
        0,
      ],
      [
        'plan',
        'Share engagement plan',
        'Publish the agreed milestones, communication rhythm and immediate next actions.',
        1,
      ],
    ],
  }),
];
