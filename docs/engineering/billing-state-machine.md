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
    Trialing --> Complimentary: paid subscription resolved, then grant
    Active --> Complimentary: paid subscription resolved, then grant
    Complimentary --> ReadOnly: superadmin revoke for shared workspace
    Complimentary --> Free: superadmin revoke for personal workspace
```

The webhook retrieves the current Stripe subscription before it changes access. The scheduled
reconciler repairs the same mirror when Stripe has zero or one current subscription. It alerts and
does nothing when Stripe has duplicates.
