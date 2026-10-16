import { galleryOutline, galleryContainer } from './builders';
/** Engineering outlines connect implementation to evidence and a safe release. */
export const ENGINEERING_GALLERY = [
  galleryOutline({
    slug: 'product-release',
    purpose:
      'Ship a verified product version with clear changes, usable documentation and a supported upgrade path.',
    actions: [
      [
        'changelog',
        'Write changelog',
        'Summarize user-visible changes, fixes and migration steps.|Link the issues or revisions behind the release notes.',
        -3,
      ],
      [
        'documentation',
        'Update documentation',
        'Update affected setup and usage instructions.|Run the documented examples against this version.',
        -3,
      ],
      [
        'checks',
        'Verify checks',
        'Run the checks required for the changed product behavior.|Record any remaining release blocker and its owner.',
        -1,
      ],
      [
        'announce',
        'Announce release',
        'Prepare the audience-specific release message and canonical download link.|Confirm the released artifact matches the announcement.',
        0,
      ],
    ],
    dependencies: [{ blockerStepKey: 'checks', blockedStepKey: 'announce' }],
  }),
  galleryOutline({
    slug: 'hotfix',
    purpose:
      'Resolve a bounded production defect quickly while proving the fix and explaining its impact.',
    actions: [
      [
        'reproduce',
        'Reproduce defect',
        'Capture a minimal failing case and affected versions.|Identify the practical impact and any safe workaround.',
      ],
      [
        'fix',
        'Implement fix',
        'Change the smallest relevant behavior and preserve compatibility.|Add a regression that fails before the correction.',
      ],
      [
        'verify',
        'Verify hotfix',
        'Run the regression and affected release checks.|Check the actual artifact or runtime that will reach users.',
      ],
      [
        'release_note',
        'Write release note',
        'Explain the corrected behavior and who needs to update.|Link the verified release and any follow-up.',
      ],
    ],
    dependencies: [
      { blockerStepKey: 'reproduce', blockedStepKey: 'fix' },
      { blockerStepKey: 'fix', blockedStepKey: 'verify' },
      { blockerStepKey: 'verify', blockedStepKey: 'release_note' },
    ],
  }),
  galleryOutline({
    slug: 'incident',
    purpose:
      'Restore affected service, keep people informed and learn from the incident without losing the operational record.',
    actions: [
      [
        'triage',
        'Triage incident',
        'Establish affected systems, severity and the current impact.|Link the incident channel and identify the response owner.',
      ],
      [
        'mitigate',
        'Mitigate impact',
        'Choose and execute the safest containment or recovery action.|Verify service behavior and record remaining risk.',
      ],
      [
        'communicate',
        'Communicate status',
        'Tell affected people what is known and what they can do.|Maintain a clear next-update commitment in the incident record.',
      ],
      [
        'review',
        'Review incident',
        'Reconstruct the timeline and contributing conditions.|Agree owned improvements and verify service is stable.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'incident-review',
    purpose:
      'Explain an incident’s timeline and contributing conditions, then agree changes that reduce recurrence.',
    actions: [
      [
        'timeline',
        'Build incident timeline',
        'Use actual observations to reconstruct detection, response and recovery.|Link source evidence and identify gaps in the record.',
      ],
      [
        'causes',
        'Analyze contributing causes',
        'Separate the trigger from technical and organizational conditions.|Check each explanation against the evidence.',
      ],
      [
        'actions',
        'Agree improvement actions',
        'Select bounded changes with an accountable owner and acceptance condition.|Track each follow-up separately from this review.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'feature-build',
    purpose:
      'Deliver a defined product capability through design, implementation, review and a verifiable release.',
    actions: [
      [
        'design',
        'Review design',
        'Confirm the user problem, interaction and acceptance criteria.|Resolve accessibility and technical constraints before building.',
        -14,
      ],
      [
        'build',
        'Build feature',
        'Implement the approved behavior with meaningful regression coverage.|Keep the change within the agreed scope.',
        -7,
      ],
      [
        'review',
        'Review implementation',
        'Review behavior, security and compatibility with the relevant owner.|Resolve findings and verify the acceptance criteria.',
        -2,
      ],
      [
        'release',
        'Release feature',
        'Publish the verified artifact through the existing release path.|Confirm the capability is available to its intended audience.',
        0,
      ],
    ],
    dependencies: [
      { blockerStepKey: 'design', blockedStepKey: 'build' },
      { blockerStepKey: 'build', blockedStepKey: 'review' },
      { blockerStepKey: 'review', blockedStepKey: 'release' },
    ],
  }),
  galleryOutline({
    slug: 'design-review',
    purpose:
      'Evaluate a design against its audience, task and constraints, then make the needed revisions.',
    actions: [
      [
        'prepare',
        'Prepare design review',
        'Link the current design and describe the decisions that need review.|Supply the audience, goals and relevant constraints.',
      ],
      [
        'review',
        'Review design evidence',
        'Walk through realistic use cases and accessibility needs.|Record concrete findings and their effect on the intended outcome.',
      ],
      [
        'revise',
        'Revise design',
        'Address the agreed findings and preserve intentional decisions.|Share the revised design with unresolved questions clearly named.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'technical-spike',
    purpose:
      'Answer a technical uncertainty within a deliberate time box so a later decision can be made.',
    actions: [
      [
        'question',
        'Define research question',
        'State the uncertain assumption and the decision it blocks.|Identify what evidence would answer it.',
      ],
      [
        'timebox',
        'Set investigation boundary',
        'Choose the approaches to compare and the stopping condition.|Keep production changes outside the exploratory scope.',
      ],
      [
        'findings',
        'Record findings',
        'Compare observed results, limits and tradeoffs.|Recommend the next step and link reproducible evidence.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'dependency-upgrade',
    purpose:
      'Upgrade a dependency with clear compatibility evidence and documented migration effects.',
    actions: [
      [
        'upgrade',
        'Upgrade dependency',
        'Read the relevant release and migration notes.|Apply the version change and necessary code adjustments.',
      ],
      [
        'checks',
        'Run affected checks',
        'Exercise the integrations that depend on the changed package.|Verify the built artifact and relevant runtime behavior.',
      ],
      [
        'breaking',
        'Document breaking changes',
        'Record changed behavior, configuration and upgrade steps.|Link remaining follow-up and the supported rollback path.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'security-review',
    purpose:
      'Assess a defined product boundary, remediate practical security findings and verify the result.',
    actions: [
      [
        'scope',
        'Define security scope',
        'Identify assets, entry points, trust boundaries and authorized test methods.|Agree the review’s limits and evidence handling.',
      ],
      [
        'assess',
        'Assess threats and controls',
        'Exercise realistic misuse cases against the defined boundary.|Record reproducible findings without publishing sensitive data.',
      ],
      [
        'remediate',
        'Remediate findings',
        'Prioritize fixes by actual impact and exposure.|Implement corrections with focused regression coverage.',
      ],
      [
        'verify',
        'Verify security corrections',
        'Retest the original findings and relevant adjacent behavior.|Record residual risk and the owner of each remaining item.',
      ],
    ],
  }),
  galleryOutline({
    slug: 'product-launch',
    purpose:
      'Coordinate product scoping, delivery and market readiness around one explicit launch outcome.',
    steps: [
      galleryContainer({
        key: 'scoping',
        kind: 'project',
        name: 'Scoping',
        purpose: 'Agree the audience, value and minimum launchable product.',
        checklist:
          'Define the problem and measurable launch outcome.|Set boundaries, dependencies and release risks.',
        days: -60,
      }),
      galleryContainer({
        key: 'build',
        kind: 'project',
        name: 'Build',
        purpose: 'Deliver the capability promised by the launch.',
        checklist:
          'Translate the agreed scope into accepted product behavior.|Verify the release artifact and support path.',
        templateSlug: 'feature-build',
        days: -7,
      }),
      galleryContainer({
        key: 'go_to_market',
        kind: 'project',
        name: 'Go-to-market',
        purpose: 'Prepare the audience and channels for the verified launch.',
        checklist:
          'Align the message with actual product capabilities.|Prepare the launch channels and response plan.',
        templateSlug: 'launch-announcement',
        days: 0,
      }),
    ],
  }),
  galleryOutline({
    slug: 'roadmap-quarter',
    purpose:
      'Choose coherent quarterly themes and turn them into explicit, reviewable delivery outcomes.',
    steps: [
      galleryContainer({
        key: 'planning',
        kind: 'project',
        name: 'Quarter planning',
        purpose: 'Agree the constraints and outcomes that should shape this quarter.',
        checklist:
          'Review customer evidence, capacity and current commitments.|Choose themes with observable success measures.',
        days: -60,
      }),
      galleryContainer({
        key: 'theme_one',
        kind: 'project',
        name: 'Primary theme',
        purpose: 'Deliver the highest-priority outcome selected in quarterly planning.',
        checklist:
          'Replace this theme name with the agreed outcome.|Define milestones and the evidence for completion.',
        days: -14,
      }),
      galleryContainer({
        key: 'theme_two',
        kind: 'project',
        name: 'Supporting theme',
        purpose: 'Deliver a second bounded outcome without hiding capacity tradeoffs.',
        checklist:
          'Name the outcome and the relationship to the primary theme.|Agree scope and an owner before implementation.',
        days: 0,
      }),
    ],
  }),
];
