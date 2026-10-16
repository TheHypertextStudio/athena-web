import { galleryOutline, galleryContainer } from './builders';
/** Editorial and campaign work keeps source material, approvals and publication decisions visible. */
export const MARKETING_GALLERY = [
  galleryOutline({
    slug: 'blog-post',
    purpose: 'Publish a useful, accurate article for a defined reader and make it discoverable.',
    actions: [
      [
        'outline',
        'Outline article',
        'Define the reader’s question, central argument and supporting sources.',
        -14,
      ],
      [
        'draft',
        'Draft article',
        'Develop the argument with relevant examples and attributable evidence.',
        -10,
      ],
      ['edit', 'Edit article', 'Check clarity, factual accuracy, structure and accessibility.', -4],
      [
        'publish',
        'Publish article',
        'Check the approved article, links and metadata in its canonical publication.',
        0,
      ],
      [
        'promote',
        'Promote article',
        'Share the article through channels appropriate to its intended readers.',
        1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'newsletter-issue',
    purpose:
      'Send a coherent newsletter issue that gives its audience timely and useful information.',
    actions: [
      [
        'stories',
        'Collect stories',
        'Choose relevant updates and verify their source records.',
        -7,
      ],
      [
        'draft',
        'Draft newsletter',
        'Organize the issue around the audience’s interests and a clear editorial focus.',
        -4,
      ],
      [
        'review',
        'Review newsletter',
        'Check facts, links, consent-sensitive details and the actual email layout.',
        -1,
      ],
      ['send', 'Send newsletter', 'Confirm the approved audience and send the verified issue.', 0],
    ],
  }),
  galleryOutline({
    slug: 'social-campaign',
    purpose:
      'Deliver a coordinated social campaign with a clear message and measurable audience response.',
    actions: [
      [
        'plan',
        'Plan social campaign',
        'Define the audience, message, channels and response to measure.',
        -14,
      ],
      [
        'assets',
        'Produce social assets',
        'Create accessible copy and visuals suited to each selected channel.',
        -7,
      ],
      [
        'schedule',
        'Schedule campaign',
        'Check the publication order, links and actual campaign dates.',
        -2,
      ],
      [
        'report',
        'Report campaign results',
        'Compare observed response with the campaign goal and explain useful lessons.',
        7,
      ],
    ],
  }),
  galleryOutline({
    slug: 'webinar',
    purpose:
      'Deliver a well-prepared webinar that gives participants useful content and a clear next step.',
    actions: [
      [
        'speakers',
        'Book webinar speakers',
        'Agree the topic, audience and speaker commitments.',
        -30,
      ],
      [
        'promote',
        'Promote webinar',
        'Publish accurate joining details and the value for the intended participants.',
        -21,
      ],
      [
        'rehearse',
        'Rehearse webinar',
        'Check timing, handoffs, accessibility and the actual presentation setup.',
        -3,
      ],
      ['run', 'Run webinar', 'Host the session and capture questions and promised resources.', 0],
      [
        'followup',
        'Follow up with participants',
        'Share the recording or materials that may lawfully be distributed and answer open questions.',
        2,
      ],
    ],
  }),
  galleryOutline({
    slug: 'case-study',
    purpose:
      'Explain a customer outcome with evidence, accurate context and permission to publish.',
    actions: [
      [
        'interview',
        'Interview customer',
        'Gather the initial problem, approach and observable results with permission.',
        -21,
      ],
      [
        'draft',
        'Draft case study',
        'Tell the customer’s story without overstating attribution or results.',
        -14,
      ],
      [
        'approve',
        'Approve with customer',
        'Ask the authorized customer reviewer to confirm facts, quotations and publishable details.',
        -5,
      ],
      [
        'publish',
        'Publish case study',
        'Publish only the approved version and verify its presentation and links.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'video',
    purpose:
      'Produce a clear video for its audience with an intentional script, usable footage and accessible publication.',
    actions: [
      [
        'script',
        'Write video script',
        'Define the message, sequence and required shots or demonstrations.',
        -21,
      ],
      [
        'shoot',
        'Shoot video',
        'Capture the planned material and confirm permissions for participants and locations.',
        -14,
      ],
      ['edit', 'Edit video', 'Build a coherent cut, verify sound and add accurate captions.', -5],
      [
        'publish',
        'Publish video',
        'Check the approved export, captions, description and publication settings.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'podcast-episode',
    purpose: 'Publish a prepared, well-edited conversation with clear value for the listener.',
    actions: [
      [
        'guest',
        'Book guest',
        'Agree the topic, recording arrangements and permission to publish.',
        -21,
      ],
      [
        'record',
        'Record episode',
        'Use a prepared conversation guide and check the captured audio.',
        -14,
      ],
      [
        'edit',
        'Edit episode',
        'Remove technical problems while preserving the speakers’ meaning.',
        -5,
      ],
      [
        'publish',
        'Publish episode',
        'Check the final audio, show notes, credits and distribution.',
        0,
      ],
      [
        'promote',
        'Promote episode',
        'Share accurate excerpts and links with the relevant audience.',
        1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'press-release',
    purpose:
      'Distribute a factual, approved announcement that journalists can understand and verify.',
    actions: [
      [
        'draft',
        'Draft press release',
        'Lead with the news, essential facts and a clear media contact.',
        -7,
      ],
      [
        'approve',
        'Approve announcement',
        'Verify factual claims, quotations and authorization to announce.',
        -3,
      ],
      [
        'distribute',
        'Distribute press release',
        'Send the approved release to the intended media and publish its canonical link.',
        0,
      ],
      [
        'followup',
        'Follow up with media',
        'Answer substantive questions and record coverage or corrections.',
        3,
      ],
    ],
  }),
  galleryOutline({
    slug: 'launch-announcement',
    purpose:
      'Communicate a verified product launch with consistent messaging, assets and audience-specific channels.',
    actions: [
      [
        'messaging',
        'Define launch messaging',
        'Connect actual product capabilities to the audience’s problem.',
        -14,
      ],
      [
        'assets',
        'Prepare launch assets',
        'Produce the approved copy, visuals, links and accessible formats.',
        -7,
      ],
      [
        'channels',
        'Prepare launch channels',
        'Confirm destinations, audiences and the publication sequence.',
        -3,
      ],
      [
        'publish',
        'Publish launch announcement',
        'Verify product availability and publish the approved announcement.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'campaign',
    purpose:
      'Deliver an agency campaign from an agreed client brief through approval, launch and evaluation.',
    actions: [
      [
        'brief',
        'Agree campaign brief',
        'Confirm the client’s audience, objective, deliverables and commercial scope.',
        -30,
      ],
      [
        'creative',
        'Develop campaign creative',
        'Create concepts and assets that answer the approved brief.',
        -21,
      ],
      [
        'approval',
        'Obtain client approval',
        'Record the authorized client decision and any final revisions.',
        -7,
      ],
      [
        'launch',
        'Launch campaign',
        'Check the approved assets, destinations and practical rollout plan.',
        0,
      ],
      [
        'wrapup',
        'Wrap up campaign',
        'Report results, reconcile deliverables and capture the lessons for the next campaign.',
        7,
      ],
    ],
  }),
  galleryOutline({
    slug: 'brand-refresh',
    purpose:
      'Refresh an organization’s identity from audience evidence through a coherent design and practical rollout.',
    steps: [
      galleryContainer({
        key: 'research',
        kind: 'project',
        name: 'Research',
        purpose: 'Understand the audience, current identity and the reason for change.',
        checklist:
          'Gather audience evidence and review how the current brand is used.|Agree the opportunities and constraints for the refresh.',
        templateSlug: 'user-research-study',
        days: -60,
      }),
      galleryContainer({
        key: 'identity',
        kind: 'project',
        name: 'Identity',
        purpose: 'Develop a consistent identity that answers the agreed brand goals.',
        checklist:
          'Create and test the verbal and visual direction.|Document accessible, practical use across the intended surfaces.',
        days: -21,
      }),
      galleryContainer({
        key: 'rollout',
        kind: 'project',
        name: 'Rollout',
        purpose:
          'Apply the approved identity consistently where people encounter the organization.',
        checklist:
          'Inventory affected surfaces and prioritize useful updates.|Verify the actual applications and explain the change to relevant people.',
        days: 0,
      }),
    ],
  }),
];
