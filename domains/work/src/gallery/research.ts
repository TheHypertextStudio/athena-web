import { galleryOutline } from './builders';
/** Research and writing outlines emphasize a clear question, evidence and appropriate publication. */
export const RESEARCH_GALLERY = [
  galleryOutline({
    slug: 'user-research-study',
    purpose:
      'Answer a defined product question through ethical research and clearly communicated evidence.',
    actions: [
      [
        'plan',
        'Plan user research',
        'Define the research question, method and consent-aware handling of participant information.',
      ],
      [
        'recruit',
        'Recruit participants',
        'Choose participants relevant to the question and make participation expectations clear.',
      ],
      [
        'interview',
        'Conduct research interviews',
        'Use the agreed guide and retain only authorized, necessary records.',
      ],
      [
        'synthesize',
        'Synthesize research findings',
        'Separate observations from interpretation and identify patterns and limitations.',
      ],
      [
        'share',
        'Share research findings',
        'Connect the evidence to the product decisions it can support.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'survey',
    purpose:
      'Collect useful survey evidence from a defined audience and report it with appropriate limits.',
    actions: [
      [
        'design',
        'Design survey',
        'Write questions that answer the actual research question without leading respondents.',
      ],
      [
        'pilot',
        'Pilot survey',
        'Check comprehension, accessibility and the usefulness of the expected answers.',
      ],
      [
        'send',
        'Send survey',
        'Use an authorized audience and explain participation and data handling.',
      ],
      [
        'analyze',
        'Analyze survey responses',
        'Check completeness and bias before interpreting the response patterns.',
      ],
      [
        'report',
        'Report survey findings',
        'Explain results, uncertainty and the decisions the evidence supports.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'paper',
    purpose:
      'Develop a defensible written argument and submit it with accurate sources and a clear revision record.',
    actions: [
      [
        'outline',
        'Outline paper',
        'Define the research question, contribution and argument structure.',
      ],
      [
        'draft',
        'Draft paper',
        'Develop the argument with appropriate methods, evidence and citations.',
      ],
      [
        'review',
        'Obtain internal review',
        'Ask relevant reviewers to assess the argument, evidence and presentation.',
      ],
      [
        'submit',
        'Submit paper',
        'Check the destination’s requirements and retain the actual submission reference.',
      ],
      [
        'revise',
        'Revise paper',
        'Address substantive feedback and record how the argument or evidence changed.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'conference-submission',
    purpose:
      'Prepare a focused conference submission that fits the venue and communicates its contribution.',
    actions: [
      [
        'abstract',
        'Write submission abstract',
        'State the problem, contribution and relevance to the conference audience.',
        -30,
      ],
      [
        'draft',
        'Draft conference submission',
        'Develop the required argument, methods or session proposal within the venue’s format.',
        -14,
      ],
      [
        'review',
        'Review submission',
        'Check the contribution, sources, permissions and submission requirements.',
        -5,
      ],
      [
        'submit',
        'Submit to conference',
        'Submit the approved version and retain confirmation before the actual deadline.',
        -1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'book-or-long-report',
    purpose:
      'Produce a coherent long-form work with a useful structure, accurate evidence and a finished publication.',
    actions: [
      [
        'outline',
        'Outline long-form work',
        'Define the audience, argument and role of each chapter or section.',
      ],
      [
        'chapters',
        'Draft chapters',
        'Develop the sections with consistent sources, examples and narrative progression.',
      ],
      [
        'edit',
        'Edit manuscript',
        'Check the overall argument, factual accuracy, consistency and readability.',
      ],
      [
        'design',
        'Design publication',
        'Prepare accessible typography, figures and navigation for the intended format.',
      ],
      [
        'publish',
        'Publish finished work',
        'Check the approved artifact, credits, rights and distribution arrangements.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'literature-review',
    purpose:
      'Summarize the relevant literature around a defined question while making the evidence and gaps traceable.',
    actions: [
      ['search', 'Search literature', 'Choose relevant databases, terms and inclusion boundaries.'],
      [
        'read',
        'Read selected sources',
        'Record each source’s contribution, method and limitations.',
      ],
      [
        'synthesize',
        'Synthesize literature',
        'Compare findings and disagreements and explain the gaps relevant to the question.',
      ],
    ],
  }),
];
