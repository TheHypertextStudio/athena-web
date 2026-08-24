# Object-command delivery

This component diagram is for maintainers who change canvas command persistence or post-commit
effects. They should preserve the transaction boundary and keep every consequence retryable after
the response process exits.

```mermaid
flowchart LR
  Route[Object command route]
  Tx[Serializable command transaction]
  Receipt[Change-set writer]
  Idempotency[Idempotency completion]
  Outbox[Consequence-job writer]
  Scheduler[Consequence worker]
  Events[Strict event publisher]
  Search[Search-job publisher]

  Route --> Tx
  Tx --> Receipt
  Tx --> Idempotency
  Tx --> Outbox
  Route -. after response .-> Scheduler
  Scheduler --> Outbox
  Scheduler --> Events
  Scheduler --> Search
```

The transaction commits the receipt, replay response, and consequence job beside the object
mutation. The route may then return without waiting for event or search delivery. The worker leases
the persisted job, checkpoints after each effect, and retries strict failures with stable dedupe
input. The regular search-index cron invokes the same worker, so process loss after commit delays
delivery instead of dropping it.
