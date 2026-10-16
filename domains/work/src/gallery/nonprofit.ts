import { galleryOutline, galleryContainer } from './builders';
/** Community programs and fundraising connect practical work to an explicit public or donor outcome. */
export const NONPROFIT_GALLERY = [
  galleryOutline({
    slug: 'community-event',
    purpose:
      'Host a community event that is welcoming, practical to attend and supported by clear follow-up.',
    actions: [
      [
        'venue',
        'Reserve venue',
        'Confirm capacity, accessibility, services and the actual event date.',
        -30,
      ],
      [
        'promote',
        'Promote community event',
        'Explain the event’s purpose and practical joining details through appropriate community channels.',
        -14,
      ],
      [
        'headcount',
        'Confirm headcount',
        'Reconcile attendance expectations and communicate needs to the host and vendors.',
        -3,
      ],
      [
        'thanks',
        'Send thank-yous',
        'Thank contributors and participants and share promised follow-up.',
        2,
      ],
    ],
  }),
  galleryOutline({
    slug: 'fundraising-campaign',
    purpose:
      'Coordinate a fundraising event and donor outreach around a clear, honest case for support.',
    steps: [
      galleryContainer({
        key: 'event',
        kind: 'project',
        name: 'Fundraising event',
        purpose: 'Deliver the campaign’s event with a clear donor experience.',
        checklist:
          'Confirm the fundraising purpose and practical event plan.|Connect the event’s follow-up to the donor stewardship record.',
        templateSlug: 'fundraising-event',
        days: -7,
      }),
      galleryContainer({
        key: 'outreach',
        kind: 'project',
        name: 'Donor outreach',
        purpose: 'Invite appropriate support and thank donors for their contribution.',
        checklist:
          'Use the authorized donor audience and an accurate case for support.|Coordinate the appeal with the campaign’s event and commitments.',
        templateSlug: 'donor-outreach',
        days: 0,
      }),
    ],
  }),
  galleryOutline({
    slug: 'fundraising-event',
    purpose:
      'Run a well-prepared event that supports the fundraising case and respects donor commitments.',
    actions: [
      [
        'venue',
        'Reserve fundraising venue',
        'Confirm the event format, capacity, accessibility and venue terms.',
        -60,
      ],
      [
        'sponsors',
        'Confirm event sponsors',
        'Agree contribution, recognition and any restrictions with each sponsor.',
        -45,
      ],
      [
        'marketing',
        'Prepare fundraising marketing',
        'Use an accurate case for support and approved sponsor information.',
        -30,
      ],
      [
        'registrations',
        'Manage registrations',
        'Give participants clear joining details and reconcile the expected attendance.',
        -7,
      ],
      [
        'thanks',
        'Thank supporters',
        'Thank attendees and sponsors and record promised stewardship follow-up.',
        2,
      ],
    ],
  }),
  galleryOutline({
    slug: 'donor-outreach',
    purpose:
      'Make a relevant appeal to an authorized donor audience and record respectful stewardship follow-up.',
    actions: [
      [
        'segment',
        'Segment donor list',
        'Choose the appropriate audience using authorized records and contact preferences.',
      ],
      [
        'appeal',
        'Draft donor appeal',
        'Explain the need, intended use of funds and a credible call to action.',
      ],
      [
        'send',
        'Send donor appeal',
        'Check the approved message, audience and giving destination before sending.',
      ],
      [
        'thank_record',
        'Thank and record',
        'Thank supporters and record gifts, restrictions and follow-up in the owning donor system.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'grant-application',
    purpose:
      'Submit an eligible, evidence-based grant application and keep the eventual reporting obligation visible.',
    actions: [
      [
        'eligibility',
        'Check grant eligibility',
        'Confirm applicant, activity, budget and timing requirements before drafting.',
        -45,
      ],
      [
        'narrative',
        'Draft grant narrative',
        'Explain the need, intended outcomes and delivery approach with relevant evidence.',
        -30,
      ],
      [
        'budget',
        'Build grant budget',
        'Prepare eligible costs and explain assumptions or matching funds.',
        -14,
      ],
      [
        'submit',
        'Submit grant application',
        'Check the authorized application and retain the submission confirmation.',
        -1,
      ],
      [
        'report',
        'File the grant report',
        'Use the actual award and reporting terms to plan the required report; leave undated until known.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'grant-report',
    purpose:
      'Provide the funder with an accurate account of outcomes, spending and the grant’s limitations.',
    actions: [
      [
        'outcomes',
        'Gather grant outcomes',
        'Collect verified activity and outcome evidence for the actual reporting period.',
        -21,
      ],
      [
        'financials',
        'Gather grant financials',
        'Reconcile spending with the award’s eligible budget and reporting rules.',
        -14,
      ],
      [
        'write',
        'Write grant report',
        'Explain results, financials and deviations clearly with source references.',
        -7,
      ],
      [
        'submit',
        'Submit grant report',
        'Obtain approval, submit through the required channel and retain confirmation.',
        -1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'major-gift',
    purpose:
      'Develop a respectful major-gift relationship based on an appropriate, clearly explained opportunity to support the mission.',
    actions: [
      [
        'research',
        'Research donor context',
        'Review authorized interests, giving context and contact preferences.',
      ],
      [
        'meet',
        'Meet prospective donor',
        'Listen to interests and discuss the mission without assuming a commitment.',
      ],
      [
        'ask',
        'Make gift request',
        'Present an appropriate, approved request with honest intended use and terms.',
      ],
      [
        'steward',
        'Steward donor relationship',
        'Thank the donor and deliver the reporting or recognition commitments made.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'cohort',
    purpose:
      'Support a group of participants through a coherent program with clear outcomes and evaluation.',
    actions: [
      [
        'recruit',
        'Recruit cohort',
        'Explain eligibility, participant commitments and the selection process.',
        -30,
      ],
      [
        'orientation',
        'Orient cohort',
        'Confirm practical arrangements and help participants understand the program.',
        -7,
      ],
      [
        'sessions',
        'Deliver cohort sessions',
        'Run the agreed learning or support sequence and record necessary attendance or outcomes.',
      ],
      [
        'graduation',
        'Complete cohort graduation',
        'Recognize the participants’ progress and explain any continuing support.',
        0,
      ],
      [
        'evaluation',
        'Evaluate cohort',
        'Review participant outcomes and feedback against the program’s purpose.',
        7,
      ],
    ],
  }),
  galleryOutline({
    slug: 'program-evaluation',
    purpose:
      'Assess a program against explicit measures and turn the findings into useful decisions.',
    actions: [
      [
        'measures',
        'Define evaluation measures',
        'Choose measures that answer the program’s actual learning or accountability questions.',
      ],
      [
        'collect',
        'Collect evaluation evidence',
        'Gather authorized quantitative and qualitative evidence with its limitations.',
      ],
      [
        'analyze',
        'Analyze program evidence',
        'Compare the evidence with the measures and examine alternative explanations.',
      ],
      [
        'report',
        'Report evaluation findings',
        'Explain findings, uncertainty and practical recommendations to the relevant audience.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'partnership-event',
    purpose:
      'Prepare partner organizations to host a coherent event with shared expectations and a clear readiness checkpoint.',
    steps: [
      galleryContainer({
        key: 'ready_to_host',
        kind: 'milestone',
        name: 'Ready to host',
        purpose:
          'Verify that partner coordination and practical preparation are complete before the event.',
        checklist:
          'Check that partners have the guidance, contacts and practical arrangements needed to host.',
        days: -2,
      }),
      galleryContainer({
        key: 'partner_guidance',
        kind: 'task',
        name: 'Send guidance to partner organizations',
        purpose: 'Give each partner the information needed to host or contribute effectively.',
        checklist:
          'Share the agreed roles, venue arrangements, participant guidance and escalation contact.',
        parentStepKey: 'ready_to_host',
        days: -12,
      }),
    ],
  }),
  galleryOutline({
    slug: 'advocacy-campaign',
    purpose: 'Coordinate evidence, outreach and a public event around a clear advocacy objective.',
    steps: [
      galleryContainer({
        key: 'research',
        kind: 'project',
        name: 'Research',
        purpose: 'Develop an accurate evidence base for the advocacy position.',
        checklist:
          'Identify the decision, relevant evidence and affected communities.|Check claims and make uncertainty explicit.',
        days: -45,
      }),
      galleryContainer({
        key: 'outreach',
        kind: 'project',
        name: 'Outreach',
        purpose: 'Engage the people and decision makers relevant to the advocacy goal.',
        checklist:
          'Choose appropriate audiences and an accurate message.|Record commitments and follow-up without collecting unnecessary personal data.',
        days: -14,
      }),
      galleryContainer({
        key: 'public_event',
        kind: 'project',
        name: 'Public event',
        purpose: 'Create a practical opportunity for public participation in the campaign.',
        checklist:
          'Connect the event to the campaign’s specific objective.|Make joining information and accessibility arrangements clear.',
        templateSlug: 'community-event',
        days: 0,
      }),
    ],
  }),
  galleryOutline({
    slug: 'membership-drive',
    purpose:
      'Invite and retain members through a clear value proposition and a measurable membership goal.',
    actions: [
      [
        'goal',
        'Set membership goal',
        'Choose the audience, membership outcome and a realistic measurement period.',
      ],
      [
        'outreach',
        'Conduct membership outreach',
        'Explain membership’s value and use appropriate authorized contact channels.',
      ],
      [
        'renewals',
        'Follow up on renewals',
        'Give existing members clear renewal information and respect contact preferences.',
      ],
      [
        'report',
        'Report membership results',
        'Compare actual results with the goal and identify useful retention improvements.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'session',
    purpose:
      'Deliver one prepared program session with clear participant arrangements and useful feedback.',
    actions: [
      [
        'material',
        'Prepare session material',
        'Connect activities and resources to the session’s intended outcome.',
        -7,
      ],
      [
        'participants',
        'Confirm participants',
        'Share joining details and check the practical or accessibility needs.',
        -2,
      ],
      [
        'deliver',
        'Deliver session',
        'Guide the planned activities and support participants in applying them.',
        0,
      ],
      [
        'feedback',
        'Gather session feedback',
        'Record learning, participation barriers and improvements for the next session.',
        1,
      ],
    ],
  }),
];
