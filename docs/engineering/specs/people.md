# People — the actor system, and every place account-holders are treated differently

> **Status**: normative
> **Requirement ids**: ENT-43, ENT-44, ENT-45, ENT-46, ENT-47, ENT-48
> **Last updated**: 2026-08-02

## The rule

> "all actors that are tracked by Docket will have a user profile or account with Docket. Our actor
> system and schema should be able to support this. For example, a nonprofit may have volunteers
> that are not given Docket accounts, but they may need to be treated like staff who can be assigned
> work. Docket should ensure that all actors are treated equally from a UI and UX perspective unless
> there are clear and convincing reasons not to."

A workspace tracks **people**. Some of them sign in. Whether someone signs in is a fact about their
relationship to the _software_, not about their standing in the _organization_ — and in a nonprofit
it is often inversely related to how much of the work they do. So the default is equality, and every
departure from it has to earn its place on the list below.

**If you find a divergence in the product that is not in §3, it is a bug.** That is the whole
contract of this document (ENT-48): the list is exhaustive by construction, so an unlisted
difference is either removed or added here with a written reason — never left to be discovered by a
volunteer wondering why their name is grey.

## 1. What a person is

One row: `actor` where `kind = 'human'` (`packages/db/src/schema/identity.ts`).

| Column          | Account-holder            | Account-less person |
| --------------- | ------------------------- | ------------------- |
| `kind`          | `'human'`                 | `'human'`           |
| `userId`        | their Better Auth user id | **`null`**          |
| `roleId`        | an org role               | an org role         |
| everything else | identical                 | identical           |

`user_id` is nullable, and the uniqueness index that keeps one account from joining a workspace
twice is explicitly partial — `where user_id is not null` — so account-less people are not competing
for a slot they cannot fill. The schema has permitted this from the beginning; what did not exist
until ENT-44 was a way to _create_ one.

Two ways in, converging on the same row:

- `POST /v1/orgs/:orgId/members/invitations` → email → the invitee redeems it →
  `acceptInvitation` materializes the actor **with** `user_id`.
- `POST /v1/orgs/:orgId/members` → a name (and optionally a role) → the actor exists immediately
  **without** `user_id`.

Both return the same `MemberOut`. Nothing downstream can tell which path produced a row except by
reading `user_id`, and §3 is the complete list of things allowed to read it.

## 2. What is identical, and where that is enforced

| Capability                | Mechanism                                                                     | Why it is already equal                                                                                                                                                                    |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Assigned a task           | `task.assignee_id → actor.id`                                                 | The FK targets `actor`, and `assertRefInOrg` validates only tenancy. No account check exists on any assignment path.                                                                       |
| Leading a project         | `project.lead_id → actor.id`                                                  | Same.                                                                                                                                                                                      |
| Owning an initiative      | `initiative.owner_id → actor.id`                                              | Same.                                                                                                                                                                                      |
| Owning a program          | `program.owner_id → actor.id`                                                 | Same.                                                                                                                                                                                      |
| Appearing in the roster   | `GET /v1/orgs/:orgId/members`                                                 | Filters on `kind = 'human'` only, and orders by `lower(display_name)`. Insertion order would have grouped every account-less person after every account-holder for no reason anyone chose. |
| Appearing in every picker | `memberActorOptions` (`apps/web/src/components/property-pickers/options.tsx`) | Built from that one roster read, so the assignee / lead / owner pickers cannot diverge from it.                                                                                            |
| Having a profile          | `GET /v1/orgs/:orgId/members/:actorId/profile`                                | Resolves for every human actor. The payload has no account field, so no client can branch on one.                                                                                          |
| Renaming                  | `PATCH /v1/orgs/:orgId/members/:actorId/profile`                              | Offered on the same terms to both. For an account-less person this workspace is the only place their name exists; refusing the edit would strand it.                                       |
| Role and status           | `PATCH /v1/orgs/:orgId/members/:actorId`                                      | Unchanged, and unchanged in what it accepts.                                                                                                                                               |
| Removal                   | `DELETE /v1/orgs/:orgId/members/:actorId`                                     | Same endpoint, same last-owner guard.                                                                                                                                                      |
| Search + activity         | `enqueueSearchUpsert(orgId, 'actor', …)`                                      | Fired on create, rename, role change and removal, exactly as for members.                                                                                                                  |
| Visual treatment          | `apps/web/src/components/people/person-row.tsx`                               | The row component never receives `userId`. There is no branch to drift.                                                                                                                    |

## 3. The complete list of intentional divergences

Each one exists because a person who does not sign in has no session, no inbox, and no consent to
carry — not because they are a lesser participant. Nothing on this list is visible as a marker
_on_ the person; each is an absence of something that would have nowhere to go.

### 3.1 They have no account settings

**What differs**: Settings → Profile, Security, Passkeys, Sessions, Recovery codes, Connected
accounts, and Account deletion exist only for the signed-in caller, about themselves.

**Why**: these surfaces edit an authentication identity. There is no identity to edit, and no one
who could be authorized to edit it — an admin changing "a volunteer's passkey" is not a coherent
action. Their workspace-facing identity (name, avatar, role, status) _is_ editable by managers,
through the same endpoints used for anyone else.

**Where it shows**: the caller's own Settings area only. Nothing on another person's profile
mentions it, so a reader never learns from the UI which kind of person they are looking at.

### 3.2 They receive no notifications

**What differs**: notification preferences, contact points, email digests and push are per **user**
(`me-notifications`, `contact-points`), and event routing resolves recipients to user ids
(`apps/api/src/consumers/routing.ts`).

**Why**: a notification needs a destination. Docket holds no email address, phone number or device
for an account-less person, deliberately — collecting contact details for someone who never agreed
to be contacted is a privacy decision, not a feature gap. Their work is still routed and still
appears in every workspace surface; it simply is not pushed at them.

**Consequence to hold**: assigning work to an account-less person is a real assignment, and the
person who _made_ it is expected to tell them. The product must not imply Docket did.

### 3.3 They cannot be an Owner in practice

**What differs**: the last-owner guard requires an org to retain at least one **active Owner**, and
that guard is what protects the org from being locked out. Giving the Owner role to someone who
cannot sign in satisfies the guard's letter while defeating its purpose.

**Why**: this is a safety property of the organization, not a judgement about the person.

**Status**: the API does **not** currently block it — `POST /` and `PATCH /:actorId` accept any
in-org role for any human actor, so this is a divergence in _advice_, not in enforcement. It is
recorded here rather than quietly enforced because the enforcement (refusing the Owner role to an
account-less actor, or requiring at least one account-backed Owner) is a behavioural change that
should be designed, not slipped in.

### 3.4 They are not a target for "invite" flows

**What differs**: `POST /invitations` takes an email address, so it cannot name an existing
account-less person; there is no "invite this row" action on a profile.

**Why**: nothing prevents inviting the same human by email — that creates a _second_ actor for
them, which is a genuine gap rather than a designed divergence. Merging an invitation into an
existing account-less actor (so the volunteer who later gets a login keeps their assigned work) is
**not built**. Until it is, an admin who invites someone already on the roster gets two rows.

**Recorded as**: an open gap, not a justified difference. It is on this list so it cannot be
mistaken for one.

### 3.5 A personal workspace has no roster at all

**What differs**: `POST /v1/orgs/:orgId/members` returns 409 for a personal workspace, and the
People and Teams nav rows are not rendered for one.

**Why**: this is not an actor-treatment divergence — it applies identically to account-holders
(`POST /invitations` has always returned 409 there). A personal workspace is an org-of-one, and its
org backing is an implementation detail the reader should never have to meet.

## 4. What this rules out

For the avoidance of future doubt, none of the following is permitted, and none of it exists today:

- a badge, tag, tooltip, icon, or asterisk on a person because they have no account;
- muted, italic, or lower-contrast text for their name;
- a separate "Invited", "Pending", "External", or "No account" section in any list;
- sorting or grouping any list by account presence;
- a disabled, read-only, or absent control on their row that an account-holder's row has;
- an empty state or 404 where an account-holder would have had a surface;
- copy describing them as incomplete, unregistered, or not yet real.

## 5. Where the code lives

| Concern                                        | File                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| Schema                                         | `packages/db/src/schema/identity.ts` (`actor`)         |
| DTOs + profile read                            | `apps/api/src/routes/actors.ts`                        |
| Roster, create, profile, rename, role, removal | `apps/api/src/routes/members.ts`                       |
| API contract tests                             | `apps/api/tests/routes/actors-accountless.test.ts`     |
| Roster surface                                 | `apps/web/src/components/people/people-list.tsx`       |
| Roster row                                     | `apps/web/src/components/people/person-row.tsx`        |
| Profile surface                                | `apps/web/src/components/people/person-profile.tsx`    |
| Add-a-person dialog                            | `apps/web/src/components/people/add-person-dialog.tsx` |
| Data layer                                     | `apps/web/src/components/people/people-queries.ts`     |
| Routes                                         | `apps/web/src/app/(app)/orgs/[orgId]/people/`          |
