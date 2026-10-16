import { galleryOutline, galleryAction } from './builders';
/** Reporting, finance and operational work with explicit records and decisions. */
export const OPERATIONS_GALLERY = [
  galleryOutline({
    slug: 'quarterly-report',
    purpose:
      'Produce a quarterly report and its accompanying letter from verified revenue, expense and narrative evidence.',
    actions: [
      [
        'export_revenue',
        'Export revenue',
        'Export the quarter’s authoritative revenue records and document the reporting basis.',
        -10,
      ],
      [
        'collect_expenses',
        'Collect expenses',
        'Gather expense records, identify missing receipts and reconcile the reporting period.',
        -7,
      ],
      [
        'write_outline',
        'Write report outline',
        'Arrange the quarter’s financial results, operational context and message to readers.',
        -5,
      ],
    ],
    steps: [
      {
        ...galleryAction(
          [
            'finish_report',
            'Finish report and letter',
            'Reconcile the three preparation outputs, complete the report and write the accompanying letter.',
          ],
          'Produce a complete quarterly report grounded in the actual reporting records.',
        ),
        sort: 3,
        dates: {
          dueDate: {
            kind: 'after_completion',
            stepKeys: ['export_revenue', 'collect_expenses', 'write_outline'],
            offset: { days: 0, unit: 'working' },
          },
        },
      },
    ],
    dependencies: [
      { blockerStepKey: 'export_revenue', blockedStepKey: 'finish_report' },
      { blockerStepKey: 'collect_expenses', blockedStepKey: 'finish_report' },
      { blockerStepKey: 'write_outline', blockedStepKey: 'finish_report' },
    ],
  }),
  galleryOutline({
    slug: 'month-end-close',
    purpose:
      'Close a reporting month with reconciled accounts, reviewed expenses and an auditable record.',
    actions: [
      [
        'reconcile',
        'Reconcile accounts',
        'Match account balances to statements and resolve unexplained differences.',
      ],
      [
        'expenses',
        'Review expenses',
        'Verify the month’s expenses, supporting documents and categorization.',
      ],
      [
        'close',
        'Close the books',
        'Confirm adjustments and retain the approved closing statements.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'invoice-run',
    purpose:
      'Prepare accurate client invoices, send them through the owning billing system and record delivery.',
    actions: [
      [
        'prepare',
        'Prepare invoices',
        'Match billable work and agreed rates to each client’s invoice.',
      ],
      [
        'send',
        'Send invoices',
        'Check recipient details and send the approved invoices through the billing system.',
      ],
      [
        'record',
        'Record invoice delivery',
        'Record the invoice references, delivery status and required follow-up.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'budget-cycle',
    purpose:
      'Turn budget requests into an agreed allocation that reflects available resources and priorities.',
    actions: [
      [
        'requests',
        'Collect budget requests',
        'Gather each requested allocation with its purpose and estimate.',
        -21,
      ],
      [
        'draft',
        'Draft budget',
        'Compare requests with available funds and make tradeoffs explicit.',
        -14,
      ],
      [
        'review',
        'Review budget',
        'Review assumptions and the effect of proposed allocations with decision makers.',
        -7,
      ],
      [
        'approve',
        'Approve budget',
        'Record the authorized allocation and communicate the spending boundaries.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'board-meeting',
    purpose:
      'Prepare a board meeting that supports informed decisions and produces a reliable minutes record.',
    actions: [
      [
        'agenda',
        'Draft agenda',
        'Identify decisions, reports and supporting material needed by the board.',
        -14,
      ],
      [
        'pack',
        'Assemble board pack',
        'Gather the approved papers and make every agenda item traceable to its source.',
        -7,
      ],
      [
        'minutes',
        'Circulate minutes',
        'Record decisions, actions and corrections, then circulate the authorized minutes.',
        2,
      ],
    ],
  }),
  galleryOutline({
    slug: 'annual-report',
    purpose:
      'Publish an accurate account of the organization’s year for its stakeholders and supporters.',
    actions: [
      [
        'results',
        'Collect annual results',
        'Gather verified program outcomes and financial results for the reporting year.',
        -45,
      ],
      [
        'write',
        'Write annual report',
        'Explain the year’s results, limitations and priorities with attributable evidence.',
        -30,
      ],
      [
        'design',
        'Design report',
        'Make the approved narrative and figures readable and accessible in the intended format.',
        -14,
      ],
      [
        'publish',
        'Publish annual report',
        'Check the final artifact and distribute the authorized version.',
        0,
      ],
    ],
  }),
  galleryOutline({
    slug: 'compliance-filing',
    purpose:
      'Submit a required filing with complete records and confirmation from the receiving authority.',
    actions: [
      [
        'records',
        'Gather filing records',
        'Identify the required reporting period, forms and supporting records.',
        -21,
      ],
      [
        'prepare',
        'Prepare filing',
        'Complete the filing from authoritative records and resolve missing information.',
        -7,
      ],
      [
        'file',
        'Submit filing',
        'Submit the approved filing through the required channel and retain its reference.',
        -1,
      ],
      [
        'confirm',
        'Confirm acceptance',
        'Verify receipt and acceptance, and record any further action.',
        1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'insurance-renewal',
    purpose: 'Review insurance needs and renew suitable coverage without a lapse.',
    actions: [
      [
        'coverage',
        'Review coverage',
        'Compare current cover, exclusions and actual organizational or personal needs.',
        -30,
      ],
      [
        'compare',
        'Compare insurance options',
        'Compare quotes on limits, exclusions, premiums and service rather than price alone.',
        -14,
      ],
      [
        'renew',
        'Renew coverage',
        'Confirm the selected policy, effective dates and retained policy documents.',
        -1,
      ],
    ],
  }),
  galleryOutline({
    slug: 'vendor-contract',
    purpose:
      'Agree a vendor contract that meets the need with clear cost, obligations and approval.',
    actions: [
      [
        'requirements',
        'Define vendor requirements',
        'State the deliverable, quality expectations and practical service constraints.',
      ],
      [
        'quotes',
        'Collect vendor quotes',
        'Obtain comparable offers with total costs, availability and terms.',
      ],
      [
        'review',
        'Review contract',
        'Check scope, payment, renewal, termination and responsibility clauses.',
      ],
      [
        'sign',
        'Sign approved contract',
        'Obtain authorized signatures and retain the executed agreement.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'vendor-booking',
    purpose:
      'Secure a vendor booking with a confirmed quote, agreement and correctly recorded deposit.',
    actions: [
      [
        'get_quote',
        'Get quote',
        'Ask for scope, availability, total cost, deposit requirements and cancellation terms.',
        -7,
      ],
      [
        'confirm',
        'Confirm booking',
        'Confirm the accepted service, date, location and terms with the vendor.',
        -3,
      ],
      [
        'pay_deposit',
        'Pay deposit',
        'Check the authorized amount and payment destination, then retain confirmation.',
        -1,
      ],
    ],
    dependencies: [
      { blockerStepKey: 'get_quote', blockedStepKey: 'confirm' },
      { blockerStepKey: 'confirm', blockedStepKey: 'pay_deposit' },
    ],
  }),
  galleryOutline({
    slug: 'office-move',
    purpose:
      'Move an office with a clear occupancy plan and continuity for the people and systems using it.',
    actions: [
      [
        'lease',
        'Confirm lease and access',
        'Confirm the signed lease, move dates and building access requirements.',
        -45,
      ],
      [
        'movers',
        'Arrange movers',
        'Confirm the inventory, packing responsibilities and mover arrival window.',
        -21,
      ],
      [
        'it',
        'Prepare IT move',
        'Plan connectivity, equipment handling and checks before people resume work.',
        -7,
      ],
      [
        'notify',
        'Notify everyone',
        'Share the location, access instructions and operational changes with affected people.',
        -3,
      ],
    ],
  }),
  galleryOutline({
    slug: 'policy-update',
    purpose:
      'Publish an understandable policy change and confirm that affected people know what to do.',
    actions: [
      [
        'draft',
        'Draft policy update',
        'Explain the changed expectation, its reason and who it applies to.',
      ],
      [
        'review',
        'Review policy',
        'Review the policy’s practical, legal and accessibility implications with authorized reviewers.',
      ],
      [
        'publish',
        'Publish approved policy',
        'Publish the approved version in its canonical location and retire ambiguous copies.',
      ],
      [
        'acknowledge',
        'Collect acknowledgments',
        'Notify affected people and record any required acknowledgment or training.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'audit',
    purpose:
      'Respond to an audit with traceable evidence and close findings through verified corrections.',
    actions: [
      [
        'requests',
        'Confirm audit request list',
        'Agree the scope, evidence requests and safe transfer method with the auditor.',
      ],
      [
        'gather',
        'Gather audit evidence',
        'Collect the authoritative records and map each item to its request.',
      ],
      [
        'respond',
        'Respond to audit questions',
        'Provide accurate explanations and record any limits or outstanding evidence.',
      ],
      [
        'findings',
        'Close audit findings',
        'Assign corrective actions and verify the evidence needed to close each finding.',
      ],
    ],
  }),
];
