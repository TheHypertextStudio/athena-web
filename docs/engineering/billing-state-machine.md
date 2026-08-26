# Billing state machine

> **Reader:** Engineers who change subscription access or customer billing copy.
>
> **Action:** Preserve these transitions and keep account deletion outside this machine.

This state machine covers Docket Pro access. It does not cover account deletion. Billing events
never write organization retention fields.

```mermaid
stateDiagram-v2
    [*] --> Free
    Free --> Trialing: US Checkout and canonical subscription
    Trialing --> Active: invoice paid
    Trialing --> CancellationScheduled: cancellation at period end
    Active --> PastDue: first payment failure
    Active --> CancellationScheduled: cancellation at period end
    PastDue --> Active: payment recovered within 7 days
    PastDue --> ReadOnly: grace deadline passes
    CancellationScheduled --> ReadOnly: paid period ends
    ReadOnly --> Trialing: eligible unused trial
    ReadOnly --> Active: paid reactivation
    Free --> Complimentary: superadmin grant
    ReadOnly --> Complimentary: provider subscription resolved, then grant
    Complimentary --> ReadOnly: superadmin revoke for shared workspace
    Complimentary --> Free: superadmin revoke for personal workspace
```

The webhook retrieves the current Stripe subscription before it changes access. The scheduled
reconciler repairs the same mirror when Stripe has zero or one current subscription. It alerts and
does nothing when Stripe has duplicates.

This state machine covers a customer discount application. An approved application is final. A
renewal creates another application instead of reopening the old decision.

```mermaid
stateDiagram-v2
    [*] --> Submitted
    Submitted --> NeedsInformation: finance requests evidence
    NeedsInformation --> Submitted: customer supplements
    Submitted --> Approved: finance approves
    Submitted --> Rejected: finance rejects
    Submitted --> Withdrawn: customer withdraws
    NeedsInformation --> Rejected: finance rejects
    NeedsInformation --> Withdrawn: customer withdraws
    Submitted --> Expired: review deadline passes
    NeedsInformation --> Expired: review deadline passes
    Approved --> [*]
    Rejected --> [*]
    Withdrawn --> [*]
    Expired --> [*]
```

This state machine covers the provider-backed award created by an approved application or private
partner decision. Public awards stay scheduled during a free trial. The first paid period starts
their review clock.

```mermaid
stateDiagram-v2
    [*] --> Scheduled
    Scheduled --> Applying: paid period starts or paid subscription exists
    Applying --> Active: Stripe confirms coupon and credit
    Applying --> ProviderFailed: provider write fails
    ProviderFailed --> Applying: finance retries
    Scheduled --> Revoked: finance revokes before activation
    Active --> Ending: renewal is not approved
    Ending --> Active: finance approves renewal
    Ending --> Expired: current paid period ends
    Active --> Revoked: finance revokes
    Revoked --> [*]
    Expired --> [*]
```
