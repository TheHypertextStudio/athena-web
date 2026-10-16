import { galleryOutline } from './builders';
/** Personal work remains practical, contextual and independently editable. */
export const PERSONAL_GALLERY = [
  galleryOutline({
    slug: 'weekly-review',
    purpose:
      'Close the current week with a clear view of commitments and a realistic plan for the next one.',
    actions: [
      [
        'inbox',
        'Clear inbox',
        'Process captured items into useful actions, references or deliberate dismissals.',
      ],
      [
        'review',
        'Review the week',
        'Look at actual outcomes, unfinished commitments and what needs attention.',
      ],
      [
        'plan',
        'Plan next week',
        'Choose the next useful priorities and check them against available time.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'trip',
    purpose:
      'Prepare a trip with confirmed travel, suitable lodging and the practical items needed to leave.',
    actions: [
      [
        'travel',
        'Book travel',
        'Compare the actual route, timing, entry requirements and cancellation terms.',
        -30,
      ],
      [
        'lodging',
        'Book lodging',
        'Confirm location, access arrangements and costs for the real travel dates.',
        -21,
      ],
      [
        'packing',
        'Prepare packing list',
        'Check documents, medication, equipment and clothing against the trip’s conditions.',
        -2,
      ],
    ],
  }),
  galleryOutline({
    slug: 'renewal-personal',
    purpose:
      'Decide whether a personal subscription, service or membership is still useful and act before it renews.',
    actions: [
      [
        'compare',
        'Compare renewal options',
        'Review actual use, cost and suitable alternatives without assuming renewal is best.',
        -14,
      ],
      [
        'renew_cancel',
        'Renew or cancel',
        'Complete the chosen action and retain confirmation of the terms or cancellation.',
        -1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'tax-filing',
    purpose:
      'Prepare an accurate personal tax filing with organized records and retained confirmation.',
    actions: [
      [
        'documents',
        'Gather tax documents',
        'Collect the relevant reporting-year records through their authorized sources.',
        -30,
      ],
      [
        'prepare',
        'Prepare tax return',
        'Use the applicable requirements or qualified help and resolve missing information.',
        -14,
      ],
      [
        'review',
        'Review tax return',
        'Check the figures, identity details and supporting documents before submission.',
        -5,
      ],
      [
        'file',
        'File tax return',
        'Submit through the appropriate channel and retain confirmation.',
        -1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'move',
    purpose: 'Move home with housing, practical services and important contact details arranged.',
    actions: [
      [
        'place',
        'Find a place',
        'Compare the real housing requirements, costs and occupancy terms.',
        -60,
      ],
      [
        'movers',
        'Arrange movers',
        'Confirm the inventory, packing plan and actual moving arrangements.',
        -21,
      ],
      [
        'utilities',
        'Arrange utilities',
        'Coordinate service end and start dates with the confirmed move.',
        -7,
      ],
      [
        'address',
        'Change address',
        'Update necessary organizations and contacts through their owning services.',
        1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'side-project',
    purpose:
      'Finish a personally useful project within a deliberate scope and share the result with the right audience.',
    actions: [
      [
        'define',
        'Define side project',
        'Choose a bounded outcome, the reason it matters and a realistic stopping point.',
      ],
      [
        'build',
        'Build side project',
        'Work through the agreed scope and check the result against its purpose.',
      ],
      [
        'share',
        'Share side project',
        'Publish or share the finished work with appropriate context and any limitations.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'learning-a-skill',
    purpose:
      'Build a chosen skill through appropriate material, consistent practice and a practical progress check.',
    actions: [
      [
        'material',
        'Choose learning material',
        'Select material suited to the current level and the actual skill goal.',
      ],
      [
        'practice',
        'Arrange practice schedule',
        'Choose a repeatable practice rhythm that fits available time.',
      ],
      [
        'milestone',
        'Check skill milestone',
        'Use a practical exercise or demonstration to assess progress and choose the next step.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'household-maintenance',
    purpose:
      'Keep a household item or system working through appropriate inspection, service and a reliable record.',
    actions: [
      [
        'inspect',
        'Inspect household item',
        'Check the condition and any manufacturer guidance or safety limits.',
      ],
      [
        'service',
        'Arrange maintenance service',
        'Complete an appropriate safe maintenance action or use a qualified service where needed.',
      ],
      [
        'record',
        'Record maintenance',
        'Retain the service details, warranty information and actual next maintenance recommendation.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'health-appointment',
    purpose: 'Prepare for a health appointment and keep the agreed follow-up understandable.',
    actions: [
      [
        'book',
        'Book appointment',
        'Confirm the provider, actual appointment details and practical access needs.',
      ],
      [
        'prepare',
        'Prepare for appointment',
        'Gather the relevant questions, records and instructions from the provider.',
      ],
      [
        'attend',
        'Attend appointment',
        'Bring the necessary information and clarify the next steps with the provider.',
      ],
      [
        'followup',
        'Complete appointment follow-up',
        'Follow the actual agreed instructions and arrange any required next appointment.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'gift',
    purpose:
      'Choose and deliver an appropriate gift with the practical timing and recipient context in mind.',
    actions: [
      [
        'choose',
        'Choose gift',
        'Consider the recipient, occasion, budget and anything they would prefer to avoid.',
        -14,
      ],
      [
        'buy',
        'Buy gift',
        'Check availability, total cost and delivery timing before purchasing.',
        -7,
      ],
      ['wrap', 'Wrap gift', 'Prepare appropriate wrapping and any personal note.', -2],
      ['deliver', 'Deliver gift', 'Arrange delivery or give the gift at the actual occasion.', 0],
    ],
  }),
];
