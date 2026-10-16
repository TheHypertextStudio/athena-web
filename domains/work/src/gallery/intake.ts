import { galleryOutline } from './builders';
/** Contextual intake outlines; labels and team names are reviewed destination suggestions. */
export const INTAKE_GALLERY = [
  galleryOutline({
    slug: 'bug-report',
    purpose: 'Give someone enough evidence to reproduce a defect and verify the expected behavior.',
    labelSuggestions: ['Bug'],
    fields: [
      [
        'What happened',
        'Describe the observed behavior and its impact on the person doing the work.',
      ],
      [
        'Steps to reproduce',
        'List the shortest repeatable steps, including the starting state and relevant input.',
      ],
      ['Expected result', 'Explain the intended behavior and how a fix can be checked.'],
      [
        'Environment',
        'Record the product version, device or browser, and safe diagnostic references. Do not include secrets.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'feature-request',
    purpose: 'Connect a requested product change to a real problem and a measurable outcome.',
    labelSuggestions: ['Feature'],
    fields: [
      [
        'Problem',
        'Describe the difficulty in the current workflow and the consequence of leaving it unresolved.',
      ],
      [
        'Who asked',
        'Link the request or record the affected audience without exposing private customer details.',
      ],
      ['Proposed change', 'Explain the smallest useful change and any alternatives considered.'],
      ['Success measure', 'State what observable result would make this request successful.'],
    ],
  }),
  galleryOutline({
    slug: 'engineering-task',
    purpose:
      'Make a bounded engineering change understandable and verifiable before implementation begins.',
    fields: [
      ['Goal', 'Describe the behavior or capability to deliver and why it matters.'],
      ['Approach', 'Identify the relevant components, constraints and intended implementation.'],
      ['Verification', 'List the checks that prove the result and any compatibility requirements.'],
    ],
  }),
  galleryOutline({
    slug: 'design-request',
    purpose: 'Give a designer a clear audience, deliverable and decision context.',
    offeringSuggestions: ['Design'],
    fields: [
      ['Audience', 'Who will use or see this work, and what should it help them do?'],
      ['Deliverable', 'Describe the needed artifact, format and where it will be used.'],
      [
        'Constraints',
        'Link existing references, accessibility requirements and brand or technical boundaries.',
      ],
      [
        'Due context',
        'Explain the milestone or decision the timing supports, rather than inventing a deadline.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'marketing-request',
    purpose: 'Prepare a focused marketing deliverable with a clear audience and message.',
    offeringSuggestions: ['Marketing'],
    fields: [
      ['Channel', 'Name the intended distribution channel and any format limits.'],
      ['Audience', 'Describe who should respond and the action they should take.'],
      ['Key message', 'Write the central claim and the evidence supporting it.'],
      ['Assets needed', 'List copy, images, links and approvals that must be available.'],
      ['Deadline', 'Explain the launch or event context and any actual timing constraint.'],
    ],
  }),
  galleryOutline({
    slug: 'content-request',
    purpose:
      'Turn a topic into useful content for a specific reader using trustworthy source material.',
    fields: [
      ['Topic', 'Define the subject and the question the content should answer.'],
      ['Format', 'Name the deliverable and expected length or structure.'],
      ['Target reader', 'Describe what the reader already knows and needs next.'],
      ['Source material', 'Link the approved facts, interviews and examples the author can use.'],
    ],
  }),
  galleryOutline({
    slug: 'support-escalation',
    purpose:
      'Transfer an unresolved customer problem with enough context for the next owner to act.',
    fields: [
      ['Customer', 'Link the authorized customer or case record.'],
      ['Report', 'Summarize the reported behavior and work already attempted.'],
      ['Impact', 'Describe who is blocked and the consequence for their work.'],
      ['Workaround', 'Record a verified workaround or say what remains unavailable.'],
      ['Owner', 'Identify the next responsible person and the handoff needed.'],
    ],
  }),
  galleryOutline({
    slug: 'data-request',
    purpose:
      'Produce the evidence needed for a specific decision without collecting unnecessary data.',
    fields: [
      ['Question', 'State the question to answer in plain language.'],
      ['Decision it informs', 'Describe the choice the result should support.'],
      ['Source', 'Identify authorized data sources, relevant scope and known limitations.'],
      ['Format', 'Specify the useful output, definitions and level of detail.'],
    ],
  }),
  galleryOutline({
    slug: 'purchase-request',
    purpose: 'Make a purchase decision with a clear need, cost and approval path.',
    fields: [
      ['Item', 'Describe what is needed, its intended use and alternatives.'],
      ['Cost', 'Include the quote, recurring charges and relevant taxes or delivery costs.'],
      ['Budget line', 'Name the applicable budget and remaining allocation if known.'],
      ['Approver', 'Identify who can authorize the purchase and what they need to decide.'],
    ],
  }),
  galleryOutline({
    slug: 'reimbursement',
    purpose: 'Provide an auditable reimbursement request tied to an authorized expense.',
    fields: [
      ['Expense', 'Explain the business or program purpose and expense date.'],
      ['Amount', 'State the total and currency, separating any nonreimbursable portion.'],
      ['Receipt', 'Attach or link the authorized receipt in its owning system.'],
      ['Budget line', 'Identify the program or budget that should bear the expense.'],
    ],
  }),
  galleryOutline({
    slug: 'facilities-request',
    purpose: 'Describe a building or equipment issue so the right repair can be arranged.',
    fields: [
      ['Location', 'Identify the site and precise affected area.'],
      ['Issue', 'Describe the observed fault, access needs and useful photos or records.'],
      ['Urgency', 'Explain the effect on safety or operations and any temporary containment.'],
    ],
  }),
  galleryOutline({
    slug: 'volunteer-request',
    purpose: 'Define a volunteer need that can be matched to people and a practical shift.',
    fields: [
      ['Role', 'Describe the contribution and expected responsibilities.'],
      ['Shift', 'State the actual date, time and location or remote arrangement.'],
      ['Skills', 'List necessary preparation, accessibility needs and support available.'],
      ['How many', 'Specify the number of volunteers and any minimum staffing needed.'],
    ],
  }),
  galleryOutline({
    slug: 'donor-inquiry',
    purpose: 'Respond to a donor question accurately and keep stewardship follow-up visible.',
    fields: [
      ['Donor', 'Link the authorized donor record and preferred contact context.'],
      ['Question', 'Record the inquiry and the information needed to answer it.'],
      [
        'Gift context',
        'Reference relevant gifts, restrictions or commitments without copying private financial details.',
      ],
      ['Follow-up owner', 'Identify the responsible person and the next response.'],
    ],
  }),
  galleryOutline({
    slug: 'client-request',
    purpose: 'Clarify a client request before it changes agreed scope, timing or billing.',
    fields: [
      ['Client', 'Link the client and current engagement record.'],
      ['Request', 'Describe the desired result in the client’s words.'],
      ['Scope impact', 'Compare the request with the agreed deliverables and dependencies.'],
      ['Billing impact', 'Record the estimate or commercial decision needed before work starts.'],
    ],
  }),
  galleryOutline({
    slug: 'change-request',
    purpose: 'Review a proposed change with its reason, cost and explicit approval.',
    fields: [
      ['What changes', 'Describe the proposed difference from the agreed baseline.'],
      ['Why', 'Explain the need, evidence and consequence of keeping the current plan.'],
      ['Scope and cost impact', 'Identify affected deliverables, timing, effort and dependencies.'],
      ['Approval', 'Record the decision required and who has authority to make it.'],
    ],
  }),
  galleryOutline({
    slug: 'meeting-follow-up',
    purpose:
      'Turn a meeting decision into a clear next action without duplicating the meeting record.',
    fields: [
      ['Decision', 'Link the meeting record and summarize the decision this action implements.'],
      ['Owner', 'Name the person accountable for the next step.'],
      ['Due', 'Record the actual commitment or dependency that determines timing.'],
    ],
  }),
  galleryOutline({
    slug: 'errand',
    purpose: 'Keep a practical errand ready to complete when the right place or time is available.',
    fields: [
      ['Where', 'Record the place, opening hours or route constraint.'],
      ['What', 'List the item or action and anything to bring.'],
      ['By when', 'Explain the real timing need or leave the errand undated.'],
    ],
  }),
];
