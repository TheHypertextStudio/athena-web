# People and external identities

This specification is for engineers changing person creation, assignment, attribution, or access.
Preserve the distinction between recording a person and granting account access.

## Person records

A workspace person is a human `actor`. Its stable ID identifies assignments, ownership, profiles,
search results, and mentions. `userId: null` means that the person has no login; it does not make the
person incomplete. People receive the same visual treatment regardless of account presence.

Contributors can create people by name through `POST /v1/orgs/:orgId/members`. The default role is
null. Explicit role submissions require management authority. Creation sends no invitation and
creates no account or grants. Personal workspaces allow accountless people while retaining their
single account-backed owner and prohibition on invitations.

The existing authorization ladder governs two named people operations: creating people requires
`contribute`; changing workspace-wide identity links or consolidating people requires `manage`.
Accountless people do not satisfy last-owner protection and cannot receive account notifications.

Removing a person archives the actor and revokes its account access, grants, and memberships.
Historical assignments, mentions, invitations, and consolidation records retain their stable actor
references. Pending invitations targeting that person are revoked. The last-owner check runs inside
the same workspace-locked transaction as removal.

## Inline creation

Assignment and ownership controls use the shared workspace person picker. Typing searches existing
people and offers an explicit Add action. Confirmation shows the name and destination workspace and
states that no invitation will be sent. Success creates and selects the person without closing the
parent editor. An exact name match does not prevent explicitly creating another person with that
name; names are not unique identifiers.

Typing, blur, Escape, and cancellation do not create records. A confirmed person remains if the
parent draft is discarded. Failed requests retain the name and draft, and retries reuse the same
Idempotency-Key. A workspace switch must not apply the result of an earlier workspace's request to
the new editor.

The same confirmation is available from editable @mention menus. Insertion retains the caret range
and surrounding content. Mentions persist actor IDs and resolve the current display name. Global
search discovers people but does not create records on an empty result. Cached workspace roster records supplement search results while indexing catches up, with actor-ID deduplication and the same workspace scope as the query.

## Source identities

An external identity retains its provider scope and stable external ID. Multiple identities can
link to one workspace person. Confirmed mappings outrank automatic resolution. Names and unverified
email addresses suggest matches but never prove identity. Historical mappings are retained rather
than silently rewritten by a new matching policy.

A source-person reference records the source identity, target entity and field, original display
name, and the person link. An unresolved assignment remains visible using its source name, or a
provider-qualified identifier when a name is absent. It is not an unassigned task. Source-only assignees and leads form named, read-only groups. Empty-person filters include only work with neither a native person nor active source evidence.

Managers can resolve an identity where it appears or inspect linked identities on a person profile.
They can select a suggested person, search the roster, or create a person and link the identity in
one transaction. Confirmation explains that the mapping applies throughout the workspace. Dismissing
the surface leaves it unresolved; it does not ignore the identity.

Changing an identity link updates only references still derived from that identity. Explicit local
assignment changes detach the source reference so later identity corrections cannot overwrite them.
Provider sync preserves explicit links, deliberate unlinking, and ignored identities. Unmappable
outbound assignments must not silently clear the provider's assignee.

## Account attachment and consolidation

An invitation may name an existing accountless person through `personActorId`. Acceptance attaches
the authenticated user to that record and applies the invitation's authorized role. The person's
ID, name, work, and mentions survive. The server rejects foreign, already linked, or inactive targets.

Managers can preview duplicate consolidation and select the surviving person. The account-backed
record must survive when one exists; two account-backed people cannot be combined. Consolidation
moves current work references and external links transactionally, retains original audit attribution,
and records an alias from the old actor ID. Historical mentions and profile links resolve through
that alias. Access grants are not transferred.

The preview includes the source and surviving names, linked identities, and counts of current work.
The confirmation rejects changed identity records rather than applying a stale decision.

## Validation contract

Behavior tests cover personal and contributor creation, explicit confirmation, duplicate names,
retry idempotency, workspace switches, mention caret preservation, invitation attachment, owner
protection, source resolution, and consolidation. Visual acceptance requires seeded authenticated
screenshots at desktop/mobile widths in both themes. Compilation and unit tests alone do not prove
interactive acceptance.

## Migration and release

The September 19, 2026 implementation preserves existing actor IDs, `member` search kinds, and
`actor` mention payloads. For example, Sam Rivera can own a task with `userId: null` and later
accept an invitation without changing the task's assignee ID.

Deploy the additive actor-alias and source-person persistence migration before clients use the
new read fields. Existing rows with an empty assignee provide no proof of a source identity.
Only stored source evidence or a supported provider refresh can populate those references.

Use the existing search projection and reindex mechanisms for persisted discoverability. The
workspace roster cache provides immediate local results while indexing finishes. Do not create
a second person directory or require identity resolution before assigning work.

The component diagram in [people-components.mmd](people-components.mmd) shows API modules.
Person creation and invitation acceptance share actor persistence. Integration ingestion and
identity resolution share source attribution. Profile, search, and mention readers resolve aliases
so historical references continue to identify the surviving person.

Managers can correct stored external identity mappings without an active integration subscription.
Connector setup, synchronization, and shared-workspace mutations retain their existing product requirements. This keeps recorded
work maintainable after a subscription ends.
