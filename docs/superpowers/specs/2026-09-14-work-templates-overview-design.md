# Work templates: overview design

> **Status**: Approved overview. Each delivery layer (§12) gets its own detailed spec and plan when
> it starts.
> **Date**: 2026-09-14
> **Supersedes, when the named layer ships**: the template model in
> [`templates.md`](../../engineering/specs/templates.md) (Layer 1), and the blueprint half of
> [`2026-08-11-repeating-work-design.md`](./2026-08-11-repeating-work-design.md) (Layers 2 and 3).
> **Companions**: [`statuses.md`](../../engineering/specs/statuses.md) (the category pattern this
> design repeats), [`data-model.md`](../../engineering/specs/data-model.md) §6.6 (labels and label
> groups), [`automations.md`](../../engineering/specs/automations.md), and
> [`mvp-plan.md`](../../core/mvp-plan.md) §3 (the four kinds of work).

## 1. Purpose

Organizations do the same kinds of work again and again. A nonprofit runs a community dinner every
month; each one needs a venue booked three weeks out, an announcement two weeks out, a headcount
three days out, and thank-you notes afterwards. Docket holds pieces of that knowledge in three
unconnected places: a template supplies the description outline, a label group records what kind
of work something is, and a repeating-work definition creates child tasks on a schedule. None of
them stays attached to the work it produced.

A **work template** is one definition for one kind of repeated work, and every piece of work keeps
the template it came from. The template holds the outline, the child work it creates, and the
timing of that child work. Later it also holds statuses, rules, and properties. Three things follow:

- **Repeating work runs itself.** A Program's schedule creates each month's event with its prep
  work already dated, and the dates follow the event when it moves.
- **Hierarchies are reusable.** A template can include other templates, so an Event brings Vendor
  bookings and each Vendor booking brings its own subtasks.
- **Agents read a definition.** Athena and other agents see what an item is, what it should
  contain, and what is missing, from structured data.

**Success measure**: repeating work runs itself. **Test case**: the recurring community dinner in
§5.8. Every decision in this document is checked against it.

## 2. Vocabulary

| Term           | Meaning                                                                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kind           | Initiative, Program, Project, or Task. Docket's fixed set.                                                                                            |
| Work template  | A workspace's definition for one kind of repeated work. "Event" is a Project template. Code and engineering specs call this a **type** (`work_type`). |
| Base template  | The plain template each kind has in every workspace: Blank initiative, Blank program, Blank project, Blank task.                                      |
| Version        | One published state of a template. Every publish creates a new version; published versions never change.                                              |
| Starting draft | The outline and default values a version applies to a new item. This is what a template holds today.                                                  |
| Blueprint      | The child work a version creates, as a list of steps.                                                                                                 |
| Step           | One child in a blueprint: its kind, optionally its own template, its timing, and its team and assignee rules.                                         |
| Anchor date    | The date on a parent that its children's dates count from (§4.2).                                                                                     |
| Schedule       | A kept part of the repeating-work engine. It creates items from one template in one destination on a cadence.                                         |
| Run            | One expected execution of a schedule on one date (an "occurrence" in the engine).                                                                     |

**Product copy.** The Settings section and the concept are **Work templates**. Actions in context
use the short form: **Change template**, **Save as template**, "The Event template has changed".
The word "type" appears only in code and engineering documents.

## 3. Decisions

Numbered so layer specs can cite them.

### Foundation

- **D1** Work templates describe work only. Things an organization tracks that never get done
  (donors, venues, suppliers) stay out. Work can point to a person, a saved place, or a link to the
  tool that owns the record.
- **D2** All four kinds have templates.
- **D3** Every item has exactly one template. Each kind has a base template, so no code path or
  agent handles an item with no template.
- **D4** A template defines its identity (name, icon, description), one starting draft, and a
  blueprint.
- **D5** Designed for now and built after the four layers: properties; statuses per template (a
  template may have its own status set and otherwise uses its kind's workspace set, with every
  status still mapped to one of the five categories); and two rules, _check before done_ and
  _children finish first_.
- **D6** Templates are available to the whole workspace. An admin can narrow a template to certain
  teams. Narrowing changes only where the template is offered; existing items keep it.
- **D7** Who may create and edit templates is a workspace setting controlled by admins. The default
  is any contributor.
- **D8** A person can copy a template into another workspace they belong to. The copy is owned and
  edited separately.
- **D9** Base templates accept an outline and children like any template. Kind names change only
  through vocabulary skins.
- **D10** Milestones and cycles have no templates. Milestones can appear as steps in a Project
  template.

### Blueprints

- **D11** The scheduling half of the repeating-work engine stays. The blueprint half is rebuilt as
  work templates, and existing process definitions move over.
- **D12** An item's children are created with it, all at once, in one transaction.
- **D13** A step can name another template. That template expands at its latest published version,
  bringing its own children.
- **D14** A step's team and assignee come from rules relative to the parent: the parent's team, the
  parent's lead or assignee, the person who created the item, or unassigned.
- **D15** Child dates count from the parent's anchor date and move when it moves. A date a person
  set by hand stays where they put it.
- **D16** When the parent has no anchor date yet, children are created without dates, and their
  dates fill in when the anchor is set.
- **D17** Editing a template publishes a new version. New items use it. Open items can take the
  update after a preview. Completed and canceled items never change.
- **D18** When an update removes a step, the child that step created stays. If the child has not
  started, the preview offers to cancel it, unticked by default.
- **D19** Changing an item's template keeps its existing children. The preview offers the new
  template's children, each of which can be unticked.
- **D20** Initiative templates create Programs and Projects and link them to the Initiative, since
  Initiatives group work without containing it.
- **D21** A template that any item uses is archived, never deleted.
- **D22** Publishing is refused when a template would include itself, directly or through its
  children.

### Schedules

- **D23** Programs hold schedules that create templated work inside them. A standalone task or
  project can still repeat on its own.
- **D24** A schedule carries its own draft on top of the template: a title pattern, a lead, a team,
  and specific people for specific steps ("Book venue → Dana").
- **D25** A scheduled item's title comes from a pattern with date tokens, such as `{month} Dinner`.
- **D26** For a schedule tied to a calendar event series, each event's date is the created item's
  anchor date, and moving the event in the calendar moves the item and its unpinned child dates.

### Experience

- **D27** In the composer's top row, a template control replaces the Template menu. It shows the
  selected template's name, its menu is headed "Start from…", and a one-line summary of the
  children expands into the list with dates.
- **D28** "New {template}" actions appear in the command palette and in a Program's add menu.
- **D29** Rows and detail headers show the template's icon and name. Every view can filter and
  group by template.
- **D30** Templates add nothing to the sidebar. A person pins a view filtered to a template.
- **D31** Settings → Work templates replaces Settings → Templates. It carries a one-line
  description, and a command-palette search for "template", "type", or "blueprint" finds it.
- **D32** A template is edited as a sample item on a full page with the kind's normal detail
  layout. Edits collect in a draft; Publish creates the version.
- **D33** Four ways to create a template: Save as template on real work, the sample-item editor,
  Athena drafting, and the gallery or starter set.
- **D34** Hypertext Studio maintains a gallery of curated templates. An installed template is a
  copy the workspace owns.
- **D35** Athena creates and edits templates under the D7 setting, like any contributor.
  Everything Athena creates appears in Inbox to keep, adjust, or undo. Athena draws on the
  onboarding conversation, imported work, repeated work in Docket, and connected tools.
- **D36** Athena building templates is part of Docket Pro. Everything else in this design is on
  every plan, personal workspaces included.
- **D37** Existing templates convert to work templates automatically. Athena offers to convert
  label groups used as stand-in types; the labels stay until a person confirms.

### Delivery

- **D38** Build in four layers: identity, blueprints, Program schedules, Athena and the gallery
  (§12).
- **D39** This overview records the model and decisions. Each layer gets its own detailed spec and
  implementation plan.

## 4. The model

```
Kind (Docket's, fixed)          Initiative · Program · Project · Task
 └─ Work template (workspace)   e.g. Project → "Event"
     ├─ name, icon, description, team narrowing, archived state
     └─ versions                every publish is a new, unchanging version
         ├─ starting draft      outline + default values
         └─ blueprint           steps
             └─ step            kind · optional template · timing · team rule · assignee rule
                                · dependencies · details (title, outline, priority, labels, estimate)

Work item
 ├─ its template, and the version it was created from or last updated to
 └─ if it was created by a blueprint: the step that created it, and which dates a person set by hand

Schedule (kept engine)
 └─ template + destination (a Program, or standalone) + schedule draft + cadence → runs → items
```

### 4.1 Where children go

| Parent kind | Children a blueprint can create                                      |
| ----------- | -------------------------------------------------------------------- |
| Initiative  | Programs and Projects, linked to the Initiative                      |
| Program     | Projects and Tasks inside the Program                                |
| Project     | Milestones, and Tasks inside the Project (optionally in a milestone) |
| Task        | Subtasks                                                             |

### 4.2 Anchor dates

| Kind       | Anchor date                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Initiative | Target date                                                                                                                            |
| Program    | Programs have no date field. Blueprint children count from the day the Program is created.                                             |
| Project    | Target date                                                                                                                            |
| Task       | Due date                                                                                                                               |
| Scheduled  | Schedules create Projects and Tasks. The run date becomes the created item's anchor date (a Project's target date, a Task's due date). |

A step's timing is one of: no date; a number of days before or after the parent's anchor date; or a
number of days after a sibling step's child is completed. These are the engine's existing timing
kinds, re-based from the run date to the parent's anchor date.

### 4.3 Why items record their version and step

An item's version and each child's step let Docket compare what an item has with what a version
would create. That comparison is what makes D17 (open items take updates), D18 (removed steps), and
D19 (changing templates keeps children) possible. Hand-set date markers make D15 possible.

### 4.4 Indicative data shape

Names are indicative. The Layer 1 and Layer 2 specs finalize columns, constraints, and migrations.

| Table                  | Holds                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `work_type`            | Workspace, kind, name, icon, description, `is_base`, status (`draft` \| `published` \| `archived`)                    |
| `work_type_team`       | Team narrowing (D6)                                                                                                   |
| `work_type_version`    | Template, number, `published_at`, starting draft (the existing per-kind `TemplateDraft` union)                        |
| `blueprint_step`       | Version, key, kind, optional child `work_type`, parent step, sort, timing, team rule, assignee rule, per-kind details |
| `blueprint_dependency` | Blocking edges between task steps in one version                                                                      |
| Each work table        | `work_type_id` and `work_type_version_id` (required), `blueprint_step_id` (optional), hand-set markers per date field |

### 4.5 Units and boundaries

| Unit                                          | Responsibility                                                                                                                                                  | Depends on                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Template contracts (`domains/work`)           | Template, version, step, rule, and timing contracts                                                                                                             | Nothing                           |
| Blueprint planner (`domains/work`)            | Pure functions: expand a version into a planned tree; recalculate dates after an anchor moves; detect loops; compute the update and change-template differences | Template contracts                |
| Template persistence (`apps/api`)             | Read and write templates, versions, and steps                                                                                                                   | `packages/db`                     |
| Creation service (`apps/api`)                 | Apply a planned tree in one transaction through the existing create paths, recording versions and steps                                                         | Planner, persistence, work writes |
| Schedule glue (`apps/api/src/lib/recurrence`) | Turn a run into a creation request (template, destination, schedule draft, anchor date)                                                                         | Creation service, kept scheduler  |
| Template routes and MCP tools                 | The HTTP and agent surface for §9                                                                                                                               | Persistence, creation service     |
| Web surfaces (`apps/web`)                     | Composer control, detail header actions, previews, Settings list, sample-item editor, Program schedules                                                         | Typed query layer                 |
| Athena authoring and gallery                  | Signals, drafts, Inbox review, gallery install and copy                                                                                                         | Template routes, MCP tools        |

The planner holds all blueprint logic and reads no database, so every rule in §5 is tested as a
pure function.

## 5. Blueprint behavior

Every behavior follows the rule templates already follow: **a template never removes anything a
person wrote.**

### 5.1 Creating an item

1. The template's latest published version applies.
2. The starting draft fills fields the author left blank. Its outline is appended after anything
   the author already wrote, using the existing merge policy in
   `apps/web/src/components/templates/merge.ts`.
3. The planner expands the blueprint. Each step that names a template expands at that template's
   latest published version.
4. Rules resolve against the parent: team, lead or assignee, creator, or unassigned. A rule that
   resolves to nobody (the parent has no lead) produces an unassigned child.
5. Dates resolve from the anchor date. With no anchor date, dated children are created undated
   (D16).
6. The creation service writes the whole tree in one transaction: every child or none.

Manual creation, Program schedules, Athena, and MCP tools all use this one path.

### 5.2 Moving the anchor date

In the same write that changes the anchor, every child date without a hand-set marker is
recalculated as the new anchor plus its step offset. Dates timed after a sibling fill in when that
sibling's child is completed. Setting a child date by hand sets its marker.

### 5.3 Adding children by hand

Allowed. A hand-added child records no step.

### 5.4 Updating an open item to a newer version

A preview lists each difference, and the person accepts differences individually:

- A new step creates a child.
- A changed offset moves child dates that have no hand-set marker.
- A removed step leaves its child in place and, when the child has not started, offers to cancel
  it, unticked (D18).
- Outline and title changes are never applied to existing items.

Accepting checks that the item has not changed since the preview. When it has, accepting is
refused and a fresh preview is shown.

### 5.5 Changing an item's template

Existing children stay. The preview offers the new template's children, each of which can be
unticked.
The item records the new template and version; kept children keep the step that created them.

### 5.6 Archiving a template

A template any item uses can only be archived. It leaves create menus; existing items keep it. The
archive dialog lists schedules that use the template. Those schedules keep running and are marked
as using an archived template.

### 5.7 Limits

- **Loops**: publishing is refused when the version's expansion reaches the same template again
  (Event → Vendor booking → Event). The refusal names the loop.
- **Size**: one creation may produce at most 500 items. Publishing is refused when a version's
  expansion exceeds that, and creation re-checks because a child template may have changed since.

### 5.8 Test case: the community dinner

The Community Dinners Program has a schedule: every second Thursday, the Event template, title
pattern `{month} Dinner`, and "Book venue → Dana". The run for October 8 creates "October Dinner"
with a target date of October 8. "Book venue" is assigned to Dana and due September 17. "Vendor
booking" is created from its own template with the subtasks "Get quote" and "Pay deposit". The
treasurer sets the deposit due date by hand. The organizer moves the dinner to October 15, and every
prep date moves a week except the deposit date.

### 5.9 Further cases

Real templates from the owner's own workspaces. Each names the decisions it exercises beyond §5.8,
and each layer's E2E suite adds the ones its layer makes possible.

| Workspace        | Template                                                                                                                                        | Exercises                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LVBT             | **Monthly general meeting** (Project): build the deck from the Google Slides template, ask the team to contribute slides, make the announcement | A standalone monthly repeat with no Program (D23); a task that links to the tool owning the record (D1); an assignee rule of "parent's lead" for the announcement (D14)      |
| LVBT             | **Partnership event** (Project): send guidance to partner organizations; milestone "Ready to host"                                              | A milestone as a step, with tasks placed inside it (D10, §4.1)                                                                                                               |
| LVBT             | **Fundraising campaign** (Initiative) → **Fundraising event** (Project): reserve the venue, produce the marketing                               | An Initiative template creating a linked Project (D20) from another template (D13); the Initiative's target date as the anchor the event counts from (§4.2)                  |
| Hypertext Studio | **Quarterly report** (Project): export revenue, collect expenses, write the outline, then finish the report and its letter                      | A quarterly schedule (D23); "finish the report" timed after its three siblings complete (§4.2); a title pattern such as `Q{quarter} {year} report` (D25)                     |
| Hypertext Studio | **New product launch** (Initiative) → scoping Project, then further Projects                                                                    | An Initiative template whose Projects are created together but start at different offsets (D12, D15)                                                                         |
| Reasonable Tech  | **Product version release** (Project): write the changelog, update the documentation, verify CI                                                 | Created on demand from "New Release" (D28) with no schedule; children dated from a target date set later (D16); a candidate for _children finish first_ once rules ship (§8) |

One owner runs all three workspaces, so the same **Fundraising event** or **Product version
release** definition is copied between them rather than rebuilt (D8).

## 6. Schedules and the engine

| Part of today's engine                                                                        | Outcome                                                                                                        |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Series, series revisions, weekdays, exceptions, missed-run policy, rolling horizon, scheduler | **Kept.** A series points at a template and a destination and carries its schedule draft (D24, D25).           |
| Calendar bindings                                                                             | **Kept.** The calendar event's date is the item's anchor date, and event moves reach the item (D26).           |
| Occurrences                                                                                   | **Kept.** Each run records the item it created.                                                                |
| Process definitions, revisions, steps, and step specs                                         | **Replaced** by templates, versions, and blueprint steps. Specific teams and people become parent-based rules. |
| Process instances and the instance mapping tables                                             | **Removed.** Items record their template, version, and step. A run's completion follows its item's status.     |
| MCP `define_process`, `schedule_process`, `repeat_task`                                       | Become template authoring, schedule creation, and the single-task repeat shortcut.                             |

A schedule is specific to one place, so its draft may name people and teams; a template is general,
so it may not. A standalone repeat such as "Water the plants every Monday" is a schedule on the base
Task template with its own title, and it adds nothing to anyone's template menus.

**Moving existing data**: single-step process definitions become schedules on the base Task
template. Multi-step definitions become a template plus a schedule. Specific teams and people in
their steps move into the schedule's draft and step assignments, so existing assignments survive.

## 7. Experience

### 7.1 Creating work

- The composer's template control replaces the Template menu (D27). Choosing a template applies its
  starting draft by the merge policy in §5.1, and a summary line such as "Creates 6 tasks and 2
  milestones" expands into the children with their dates.
- "New Event" appears in the command palette and a Program's add menu lists the templates that fit
  inside it (D28).
- The empty-description "Start from template" action stays.

### 7.2 Looking at work

- Rows and detail headers show the template's icon and name, and every view can filter and group by
  template (D29).
- The detail header offers **Change template**, and **Update available** when a newer version
  exists. Both open their previews (§5.4, §5.5).
- Templates add nothing to the sidebar (D30).

### 7.3 Settings → Work templates

- Replaces Settings → Templates, listed by kind, with **Browse gallery** (D31, D34).
- Opening a template shows a sample item on a full page: the outline in the normal editor, children
  listed with dates such as "event day − 21", child templates shown as chips, and team and assignee
  chosen from parent-based rules. Closing returns to Settings. Edits collect in a draft; **Publish**
  creates the version (D32).
- The authoring setting (D7) and team narrowing (D6) live here.

### 7.4 Save as template

Available on any Initiative, Program, Project, or Task. It captures the outline and the children.
Each child's current date becomes an offset from the parent's anchor date, and specific teams and
people become parent-based rules. The sample-item editor opens for review before publishing.

### 7.5 Program schedules

The Program page gains a **Schedules** section: add a schedule with today's repeat editor for the
cadence, a template, a title pattern, and step assignments; see upcoming runs; see failed runs with
their reasons.

### 7.6 Athena

- Suggestions ("You've planned four similar dinners. Make this an Event template?") and everything
  Athena creates appear in Inbox to keep, adjust, or undo (D35).
- During onboarding Athena proposes starter templates from the conversation and imported work.
- Athena offers to convert label groups used as stand-in types, in Inbox (D37).
- Athena building templates requires Pro (D36).

### 7.7 Starter and gallery catalog

The gallery (D34) holds every template below. The onboarding fork (a startup, a nonprofit, an
agency, or just me) installs the rows marked for it, and Athena tailors names, children, offsets,
and which rows to offer from the workspace's signals (D35). Every entry is data, seeded as an owned
copy the workspace may rename, rewrite, or delete. This is the seed list; the Layer 4 spec finalizes
each outline and blueprint.

Two shapes recur. **Ticket-shaped** templates are Tasks whose value is the outline, the default
labels, and the default team: the intake forms people build from label groups today (D37). They
ship usable in Layer 1. **Blueprint-shaped** templates create dated children and need Layer 2, and
the ones marked as repeats need Layer 3.

Fork letters: **S** startup, **N** nonprofit, **A** agency, **P** just me. A row with no letter is
gallery-only.

#### Intake and tickets (Task)

| Template               | Outline and defaults                                                         | Forks   |
| ---------------------- | ---------------------------------------------------------------------------- | ------- |
| **Bug report**         | What happened, steps to reproduce, expected result, environment; label `Bug` | S       |
| **Feature request**    | Problem, who asked, proposed change, success measure; label `Feature`        | S       |
| **Engineering task**   | Goal, approach, verification                                                 | S       |
| **Design request**     | Audience, deliverable, constraints, due context; team Design                 | S, A    |
| **Marketing request**  | Channel, audience, key message, assets needed, deadline; team Marketing      | S, A    |
| **Content request**    | Topic, format, target reader, source material                                | S, A    |
| **Support escalation** | Customer, report, impact, workaround, owner                                  | S       |
| **Data request**       | Question, decision it informs, source, format                                | S       |
| **Purchase request**   | Item, cost, budget line, approver                                            | S, N, A |
| **Reimbursement**      | Expense, amount, receipt, budget line                                        | S, N, A |
| **Facilities request** | Location, issue, urgency                                                     | N       |
| **Volunteer request**  | Role, shift, skills, how many                                                | N       |
| **Donor inquiry**      | Donor, question, gift context, follow-up owner                               | N       |
| **Client request**     | Client, request, scope impact, billing impact                                | A       |
| **Change request**     | What changes, why, scope and cost impact, approval                           | A       |
| **Meeting follow-up**  | Decision, owner, due                                                         | S, N, A |
| **Errand**             | Where, what, by when                                                         | P       |

#### Engineering and product

| Template                         | Children                                                       | Forks |
| -------------------------------- | -------------------------------------------------------------- | ----- |
| **Product release** (Project)    | Write changelog, update documentation, verify checks, announce | S     |
| **Hotfix** (Project)             | Reproduce, fix, verify, release note                           | S     |
| **Incident** (Project)           | Triage, mitigate, communicate, review                          | S     |
| **Incident review** (Task)       | Timeline, causes, actions                                      | S     |
| **Feature build** (Project)      | Design review, build, review, release                          | S     |
| **Design review** (Task)         | Prepare, review, revise                                        | S, A  |
| **Technical spike** (Task)       | Question, time box, findings                                   | S     |
| **Dependency upgrade** (Task)    | Upgrade, run checks, note breaking changes                     | S     |
| **Security review** (Project)    | Scope, assess, remediate, verify                               | S     |
| **Product launch** (Initiative)  | Scoping (Project), Build (Project), Go-to-market (Project)     | S     |
| **Roadmap quarter** (Initiative) | Planning (Project), themed Projects                            | S     |

#### Marketing and content

| Template                          | Children                                                  | Forks   |
| --------------------------------- | --------------------------------------------------------- | ------- |
| **Blog post** (Project)           | Outline, draft, edit, publish, promote                    | S, A    |
| **Newsletter issue** (Project)    | Collect stories, draft, review, send                      | S, N, A |
| **Social campaign** (Project)     | Plan, produce assets, schedule, report                    | S, A    |
| **Webinar** (Project)             | Book speakers, promote, rehearse, run, follow up          | S, A    |
| **Case study** (Project)          | Interview, draft, approve with customer, publish          | S, A    |
| **Video** (Project)               | Script, shoot, edit, publish                              | S, A    |
| **Podcast episode** (Project)     | Book guest, record, edit, publish, promote                | S, A, P |
| **Press release** (Project)       | Draft, approve, distribute, follow up                     | S, N, A |
| **Launch announcement** (Project) | Messaging, assets, channels, publish                      | S       |
| **Campaign** (Project)            | Brief, creative, client approval, launch, wrap-up         | A       |
| **Brand refresh** (Initiative)    | Research (Project), Identity (Project), Rollout (Project) | A       |
| **Content calendar** (Program)    | Schedule → Blog post; schedule → Newsletter issue         | S, A    |

#### Sales and clients

| Template                            | Children                                                      | Forks |
| ----------------------------------- | ------------------------------------------------------------- | ----- |
| **Proposal** (Project)              | Discovery call, scope, pricing, send, follow up               | S, A  |
| **Customer onboarding** (Project)   | Kickoff call, account setup, training, 30-day check-in        | S, A  |
| **Client engagement** (Program)     | Kickoff (Project); schedule → Monthly client report (Project) | A     |
| **Monthly client report** (Project) | Pull results, write summary, review, send                     | A     |
| **Deliverable review** (Task)       | Internal review, client review, revisions                     | A     |
| **Renewal** (Project)               | Usage review, renewal call, updated terms, signature          | S, A  |
| **Churn follow-up** (Task)          | Reach out, record reason, close out                           | S     |
| **Partnership** (Project)           | Intro, terms, announcement, quarterly check-in                | S, N  |
| **Trade show** (Project)            | Register, booth, staffing, travel, follow-ups                 | S, A  |

#### Operations and finance

| Template                        | Children                                                                  | Forks   |
| ------------------------------- | ------------------------------------------------------------------------- | ------- |
| **Quarterly report** (Project)  | Export revenue, collect expenses, write outline, finish report and letter | S, N    |
| **Month-end close** (Project)   | Reconcile accounts, review expenses, close the books                      | S, N, A |
| **Invoice run** (Task)          | Prepare invoices, send, record                                            | A       |
| **Budget cycle** (Project)      | Collect requests, draft, review, approve                                  | S, N    |
| **Board meeting** (Project)     | Draft agenda, assemble the board pack, circulate minutes                  | S, N    |
| **Annual report** (Project)     | Collect results, write, design, publish                                   | N       |
| **Compliance filing** (Project) | Gather records, prepare, file, confirm                                    | S, N    |
| **Insurance renewal** (Task)    | Review coverage, compare, renew                                           | S, N, A |
| **Vendor contract** (Project)   | Requirements, quotes, review, sign                                        | S, N, A |
| **Vendor booking** (Task)       | Get quote, confirm, pay deposit                                           | N, A    |
| **Office move** (Project)       | Lease, movers, IT, notify everyone                                        | S, A    |
| **Policy update** (Task)        | Draft, review, publish, acknowledge                                       | S, N    |
| **Audit** (Project)             | Request list, gather, respond, close findings                             | N       |

#### People

| Template                               | Children                                                         | Forks   |
| -------------------------------------- | ---------------------------------------------------------------- | ------- |
| **Hiring a role** (Project)            | Post the role, screen, interview loop, offer                     | S, N, A |
| **Employee onboarding** (Project)      | Accounts, equipment, first-week plan, 30-, 60-, 90-day check-ins | S, N, A |
| **Offboarding** (Project)              | Handover, access removal, exit conversation                      | S, N, A |
| **Performance review cycle** (Project) | Self-reviews, manager reviews, calibration, conversations        | S       |
| **One-on-one** (Task)                  | Agenda, notes, follow-ups                                        | S, A    |
| **Team meeting** (Task)                | Agenda, notes, action items                                      | S, N, A |
| **Team offsite** (Project)             | Venue, agenda, travel, follow-ups                                | S, A    |
| **Volunteer onboarding** (Task)        | Paperwork, orientation, first shift                              | N       |
| **Training session** (Project)         | Materials, schedule, deliver, feedback                           | N, A    |

#### Nonprofit programs and fundraising

| Template                              | Children                                                                  | Forks |
| ------------------------------------- | ------------------------------------------------------------------------- | ----- |
| **Community event** (Project)         | Reserve venue, promote, confirm headcount, send thank-yous                | N     |
| **Fundraising campaign** (Initiative) | Fundraising event (Project), Donor outreach (Project)                     | N     |
| **Fundraising event** (Project)       | Reserve venue, sponsors, marketing, registrations, thank-yous             | N     |
| **Donor outreach** (Project)          | Segment list, draft appeal, send, thank and record                        | N     |
| **Grant application** (Project)       | Check eligibility, draft narrative, build budget, submit, file the report | N     |
| **Grant report** (Project)            | Gather outcomes, financials, write, submit                                | N     |
| **Major gift** (Task)                 | Research, meet, ask, steward                                              | N     |
| **Program delivery** (Program)        | Schedule → Session or Cohort (Project)                                    | N     |
| **Cohort** (Project)                  | Recruit, orientation, sessions, graduation, evaluation                    | N     |
| **Program evaluation** (Project)      | Define measures, collect, analyze, report                                 | N     |
| **Partnership event** (Project)       | Send guidance to partners; milestone "Ready to host"                      | N     |
| **Advocacy campaign** (Initiative)    | Research (Project), Outreach (Project), Public event (Project)            | N     |
| **Membership drive** (Project)        | Set goal, outreach, renewals, report                                      | N     |

#### Events

| Template                              | Children                                                       | Forks   |
| ------------------------------------- | -------------------------------------------------------------- | ------- |
| **Meeting** (Project)                 | Agenda, materials, run, minutes                                | S, N, A |
| **Monthly general meeting** (Project) | Build the deck, ask the team for slides, make the announcement | N       |
| **Workshop** (Project)                | Curriculum, registration, materials, deliver, feedback         | N, A    |
| **Conference** (Project)              | Venue, speakers, registration, sponsors, run, follow-ups       | S, N    |
| **Conference talk** (Project)         | Abstract, slides, rehearse, deliver                            | S, P    |
| **Product demo day** (Project)        | Invite, prepare demos, run, follow up                          | S       |
| **Event series** (Program)            | Schedule → Community event or Workshop                         | N, A    |

#### Research and writing

| Template                            | Children                                        | Forks |
| ----------------------------------- | ----------------------------------------------- | ----- |
| **User research study** (Project)   | Plan, recruit, interview, synthesize, share     | S, A  |
| **Survey** (Project)                | Design, pilot, send, analyze, report            | S, N  |
| **Paper** (Project)                 | Outline, draft, internal review, submit, revise |       |
| **Conference submission** (Project) | Abstract, draft, review, submit                 |       |
| **Book or long report** (Project)   | Outline, chapters, edit, design, publish        | P     |
| **Literature review** (Task)        | Search, read, synthesize                        |       |

#### Personal

| Template                         | Children                                            | Forks |
| -------------------------------- | --------------------------------------------------- | ----- |
| **Weekly review** (Task)         | Clear inbox, review the week, plan next week        | P     |
| **Trip** (Project)               | Book travel, book lodging, packing list             | P     |
| **Renewal** (Task)               | Compare options, renew or cancel                    | P     |
| **Tax filing** (Project)         | Gather documents, prepare, review, file             | P     |
| **Move** (Project)               | Find place, movers, utilities, change of address    | P     |
| **Side project** (Project)       | Define, build, share                                | P     |
| **Learning a skill** (Project)   | Choose material, practice schedule, milestone check | P     |
| **Household maintenance** (Task) | Inspect, service, record                            | P     |
| **Health appointment** (Task)    | Book, prepare, attend, follow up                    | P     |
| **Gift** (Task)                  | Choose, buy, wrap, deliver                          | P     |

Four of these are the owner's own (§5.9). The rest follow the same shape so that every fork lands
with templates that create dated work on day one, and every ticket-shaped row gives Athena a named
outline to fill when it turns an email or a message into work.

## 8. What the model leaves room for

These are out of scope for the four layers. The model must not block them.

- **Properties.** A version will gain a property list, steps will set property defaults, and an
  anchor date may later be a named date property ("event date"). Until then anchors use each kind's
  existing date fields.
- **Statuses per template.** A version will optionally reference its own status set; without one,
  the kind's workspace set applies. Every status keeps one of the five categories. How a team's
  forked set interacts with a template's own set is decided in that spec.
- **Rules.** _Check before done_ (someone other than the assignee confirms before completion) and
  _children finish first_ (a parent cannot complete while children are open). Both are enforced in
  the shared write path, the way label exclusivity is, so people, automations, and agents obey the
  same rule.

## 9. Agents and MCP

- **Discover**: list work templates with kind, children summary, and version; read one version's
  blueprint as structured data.
- **Create**: create an item from a template through §5.1, returning the created tree.
- **Maintain**: preview an update or a template change as a structured list of differences, then
  accept named differences.
- **Author**: create and edit templates and schedules under the D7 setting. Agent-created templates
  appear in Inbox.
- **Read work**: every work read includes the item's template, version, and each child's step, so
  an agent can see that an Event has no venue task or that an update is available.

`apps/api/src/mcp/repeating-work-tools.ts` migrates onto these contracts. Template discovery and
authoring tools for the current template model exist on the unmerged branch
`claude/docket-mcp-templates-7fd14e`; see §14.

## 10. Errors

Every failure has a stable Problem code and application-owned copy.

| Situation                                        | Behavior                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Publishing would create a loop                   | Refused; the message names the loop                                                                                 |
| Publishing or creating would exceed 500 items    | Refused; the message gives the count                                                                                |
| A rule resolves to nobody                        | Child created unassigned; no failure                                                                                |
| A child template is narrowed to other teams      | Child still created; narrowing only affects what is offered                                                         |
| A scheduled run cannot create its item           | Run recorded as failed with its code, shown in the Program's Schedules section and in Inbox, never skipped silently |
| The item changed between preview and accept      | Accept refused; a fresh preview is shown                                                                            |
| The caller may not author templates under D7     | Refused with a permission code naming the setting                                                                   |
| A free workspace asks Athena to build a template | Pro-required response with the upgrade path                                                                         |

## 11. Testing

- **Domain, 100% coverage**: the blueprint planner (expansion, rule resolution, anchor dates,
  undated children, hand-set markers, loop and size limits, update and change-template differences).
- **API**: one-transaction creation and rollback, schedule runs through the existing scheduler
  suites, the authoring setting, and migrations from templates and process definitions on a fresh
  database with realistic fixtures.
- **Web**: behavior tests for the composer control, previews, Settings list, sample-item editor, and
  Program schedules, with no assertions on copy.
- **E2E**: the §5.8 journey: save a dinner as a template, schedule it on a Program, let a run create
  the Event, move the event date, confirm the prep dates follow and the hand-set date stays.
- **MCP conformance** for every new and migrated tool.
- **Visual verification** at two widths in both themes for every new surface, per
  `docs/engineering/ui-verification.md`.

## 12. Delivery layers

Each layer ships something usable and gets its own spec and plan.

| Layer                     | Scope                                                                                                                                                                                                                                                                                                                                                                                       | Done when                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1. Identity               | `work_type` and versions with starting drafts; base templates in every workspace; every item backfilled to its base template; templates converted (§13); composer control and New actions; icon and name on rows and headers; filter and group by template; Settings → Work templates with the sample-item editor for outlines; Change template; the D7 setting; MCP discovery and creation | A person creates an Event project from the Event template and groups a project list by template     |
| 2. Blueprints             | Steps, composition, rules, anchor dates and hand-set markers; versions with update and change-template previews; Save as template; loop and size limits; archiving; process definitions and instances moved over                                                                                                                                                                            | Creating an Event creates its dated prep work, and moving the event date moves unpinned child dates |
| 3. Program schedules      | Series re-pointed at templates and destinations; schedule drafts, title patterns, step assignments; Program Schedules section; standalone repeats on base templates; calendar anchors; failed-run surfacing; process instance tables removed                                                                                                                                                | The §5.8 journey passes end to end                                                                  |
| 4. Athena and the gallery | Gallery content, browse, and install; copy to another workspace; Athena drafting from signals; onboarding starter templates; Inbox review; label-group conversion offers; Pro gating                                                                                                                                                                                                        | A new nonprofit workspace is offered an Event template during onboarding and keeps it from Inbox    |

## 13. Moving existing templates

| Today                     | Becomes                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Workspace-scoped template | A published work template of the same kind, available to the whole workspace                                 |
| Team-scoped template      | A published work template narrowed to that team                                                              |
| Personal template         | An unpublished draft work template, visible only to its author until they publish it                         |
| Seeded default templates  | Published work templates; the seeding guard ("does this workspace hold any template") carries over unchanged |

## 14. Risks

- **Backfilling every work row.** `work_type_id` becomes required on four large tables. Backfill in
  batches before adding the constraint. Production migrations run pending files in one
  transaction, so an enum value must not be added and used in the same deploy; PGlite does not
  reproduce that failure.
- **Rebuilding under a shipped scheduler.** The scheduler suites stay green at every step of Layers
  2 and 3, and the process tables are removed only after their data has moved and been verified.
- **Recalculating many dates in one write.** An anchor move rewrites up to 500 child dates in the
  same transaction; the Layer 2 spec measures this against the replay-safe write path.
- **Connectors and imports.** Items created by the Linear reconciler, email-to-task, and imports get
  their kind's base template until Layer 4's conversion offers apply.
- **Views and search.** Grouping and filtering by template needs a work-view field and a search
  facet; `templates.md` currently keeps templates out of the search index. Layer 1 decides the facet.
- **Parallel MCP template work.** The branch `claude/docket-mcp-templates-7fd14e` adds agent tools
  for today's template model. If it lands first, Layer 1 moves those tools onto work templates; if
  it has not landed, Layer 1 builds the §9 tools directly and that branch is closed.

## 15. Decisions to confirm

1. **Personal templates** become unpublished drafts visible only to their author (§13). The
   alternative is a personal availability option on templates, which D6 does not include.
2. **Short-form copy**: in-context actions say "template" ("Change template") while the section and
   concept say "Work templates" (§2).
3. **Size limit**: one creation produces at most 500 items (§5.7). The number is a starting guard
   and the Layer 2 spec may change it after measuring §14's date-recalculation cost.
