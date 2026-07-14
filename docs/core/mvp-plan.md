# Docket — MVP Product Plan

### "Linear for Everything"

> **Naming.** _Docket_ is the product. _Athena_ is our first‑party agent (the repo codename "Project Athena" lives on). Throughout this doc, "Docket" means the platform; "Athena" means the in‑house agent. Docket is **agent‑agnostic** — Athena is the default, best‑integrated agent, not a requirement.
>
> **Audience & scope.** This is a **product** document — the _what_ and _why_, written in plain language for any kind of team. It is the source for engineering planning (see `docs/engineering/docket-engineering-plan.md`). Docket is **not** a software‑developer tool; it is for **anyone running real work** — founders, operators, marketers, nonprofits. Examples throughout are deliberately domain‑neutral.

---

## 1. Executive Summary

Linear set the standard for how modern software teams plan and ship work — fast, opinionated, a joy to use. But that quality of coordination is locked inside engineering. Every other kind of team — marketing, operations, research, a founder running a company, a director running a nonprofit — is stuck in a patchwork of spreadsheets, generic to‑do apps, and bloated suites nobody enjoys opening.

**Docket is "Linear for Everything."** It takes Linear's hierarchy of work — initiatives, **programs**, projects, milestones, cycles, tasks — and brings it to teams coordinating _any_ kind of effort, not just code. It gives every team the clarity, momentum, and craft that engineering teams get from Linear.

But Docket has a second, sharper purpose that Linear can't serve: **it's a command center for running _several_ organizations at once.** Its creator runs multiple startups _and_ nonprofits. Each needs its own separated context and its own toolstack — yet they all need to be driven from one place, by one person, in one day. Docket is the layer that sits _above_ the tools each organization already uses and unifies them — **without ever letting their contexts bleed together.**

Two more principles shape everything:

- **Opinionated, elegant, well‑crafted.** We make the hard product decisions so users don't configure their way to a workflow. Speed and design are features. Fewer things at a higher bar.
- **AI‑native, but the work comes first.** Agents are first‑class participants — but they are _execution muscle_, not the centerpiece. The product is the structure and the coordination; agents are a way to get the work done, and **the part that matters is seeing the work happen** transparently.

---

## 2. Vision

Imagine one screen, every morning, that shows everything you need to move forward across _all_ your ventures — your startup, your nonprofit, your personal projects — each clearly labeled, none tangled together. You plan your day by pulling the few things that matter into focus. Where an agent has done work overnight, you review and approve it in a click. When you drop into one venture, the whole app becomes _that_ venture's world — its people, its tools, its language — and when you step back up, you're at the command center again.

That's Docket: **separation where it protects you, unification where it empowers you.**

- For a **solo founder/operator** juggling multiple organizations: the only tool that holds them all at once.
- For a **team** inside any one organization: a Linear‑grade planning tool that finally fits non‑engineering work.
- For **everyone**: a place where AI agents do real work alongside people, with a human always in the loop.

---

## 3. The Core Model

Most planning tools make you cram every kind of work into one shape — usually a flat list of tasks, or a single rigid outline you're forced to bend your real life around. Docket starts from a different observation: the work you do has two completely different questions hiding inside it. The first is _what kind of effort is this?_ — is it a one-time push toward a finish line, like a product launch or a fundraising gala? Or is it ongoing work that never really ends, like donor relations or keeping the books current? The second question is entirely separate: _when does it happen, and who's on the hook?_ Docket keeps these two questions apart on purpose, because tangling them is exactly what makes other tools feel cramped — a deadline gets bolted onto something that should never finish, or recurring work gets dressed up as a project that's perpetually "90% done."

That first question — what kind of work — is answered by a small, deliberate vocabulary. A **Task** is the atomic unit: the single thing someone (or some agent) actually does, like "draft the grant report" or "call the caterer." A **Project** is a bounded effort with an outcome and, often, a deadline — "Spring Gala" or "Launch the new pricing page" — something you finish and close. A **Program** is the opposite shape: an ongoing area of operations that never finishes, like a nonprofit's after-school program or a startup's customer support. (This is the piece other tools quietly lack — they give you projects that end and themes with no real work inside, leaving all your continuous, day-after-day work with no honest home.) And an **Initiative** sits above all of it as a pure _theme_ — a strategic banner like "Grow revenue" or "Expand to a second city" — that gathers related programs and projects together without containing any work of its own.

The second question — the _when_ and _who_ — rides on top of this structure rather than being baked into it. The same task can be pulled into a two-week stretch of focused work, handed to a teammate or an agent, or flagged as waiting on something else, all without changing what kind of work it fundamentally is. That clean split is what lets Docket stay graceful whether you're running a tidy, well-planned project or wrangling the messy, ad-hoc reality of running an organization. The rest of this section walks through these concepts and the few rules that hold them together — first the personal command center that spans all your ventures, then the work hierarchy inside any one of them.

Docket is built from a small set of concepts. The whole game is keeping two kinds of relationship straight:

- **Containment** (a hard parent → child; the child can't exist without the parent). An Organization contains its work; a Project contains its Tasks.
- **Association** (a soft, optional link; either side can exist alone). An Initiative _themes_ a Project; a Cycle _schedules_ a Task; a Task _blocks_ another Task.

Most planning tools flatten these into one tree and force structure where it doesn't belong. Docket keeps them separate.

### 3.1 The two altitudes

```
   YOU (one person)
     │ owns
     ▼
   ┌──────────────────────────── HUB ────────────────────────────┐
   │  your personal command center — spans all your orgs          │
   │  Today · Inbox · Portfolio · Search   (cross-org, aggregated)│
   └───────┬───────────────────────────────────────┬─────────────┘
           │ owns                                   │ gathers (via your membership)
           ▼                                        ▼
   ┌───────────────┐                  ┌───────────────┐   ┌───────────────┐
   │ Personal space│                  │ Organization  │   │ Organization  │
   │  (org of one) │                  │   "Startup"   │   │  "Nonprofit"  │
   └───────────────┘                  └───────────────┘   └───────────────┘
        each Organization is an isolated, shared context (its own
        members · tools · agents · vocabulary · work)
```

- **Hub** — your personal command center. There is exactly one per person. It _aggregates_ across every organization you belong to (it never merges their data). It owns your cross‑org views and your **Personal space**.
- **Organization** — the context boundary. Everything that defines a venture's world is scoped to it and isolated: its members, its connected tools, its agents, its vocabulary, and all its work.
- **Personal space** — your own "organization of one," for work that isn't tied to any venture. It reuses all the same machinery.

The Hub **gathers** the organizations you're a member of — it does **not** privately own them. A startup has cofounders; a nonprofit has volunteers. Each Organization is an independent, shared tenant, and the _same_ Organization shows up in every member's own Hub. **Separation is structural (the Org boundary); unification is a personal view (the Hub). Data never merges; views aggregate.**

### 3.2 The work hierarchy (inside an Organization)

```
   Organization
     ├─ contains ─► Initiative   (a theme — no work inside; spans Programs/Projects)
     │
     ├─ contains ─► Program      (ONGOING operations — no end)
     │                ├─ Project (a bounded effort — has an outcome/optional deadline)
     │                │    └─ Task (+ Milestones as a dated checkpoint attribute)
     │                └─ Task    (ongoing/recurring work, no project)
     │
     ├─ contains ─► Project      (a Project can also sit directly under the Org)
     └─ contains ─► Task         (unplanned / Triage)

   Initiative  ┄themes┄►  Programs & Projects    (many-to-many overlay)
   Cycle       ┄schedules┄►  Tasks               (a team's recurring time window)
   Task        ┄blocked by┄►  Task               (org-wide, cross-project, acyclic)
```

| Concept        | What it is                                                                                                                                                                                | Has an end?       | Headline signal                |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------ |
| **Initiative** | A strategic **theme** that groups efforts ("Grow revenue"). Contains no work itself; Programs/Projects _associate_ with it.                                                               | No                | Rolled‑up health + child mix   |
| **Program**    | An **ongoing area of operations** ("Customer Support"; a nonprofit's "After‑School Program"). Never finishes.                                                                             | No                | Health + flow (not a % bar)    |
| **Project**    | A **bounded effort** ("Launch v2"; "Spring Gala"). Tracked to completion; may carry a deadline.                                                                                           | Yes               | Weighted‑progress bar + health |
| **Cycle**      | A **recurring stretch of time** — say two weeks — that a team commits a batch of work to, then reviews (a marketing team's two‑week content push; a monthly giving cycle; _sprint‑like_). | Yes (fixed)       | Committed work + capacity      |
| **Task**       | The **atomic unit of work**.                                                                                                                                                              | Optional due date | Status + assignee              |

**Why "Program" is its own concept (not just a renamed Initiative).** Real organizations — especially nonprofits and operations teams — run continuous work that never "completes." Project (bounded) and Initiative (a theme with no work inside) leave that homeless. Program fills it: an ongoing container of work, the continuous counterpart to the bounded Project.

### 3.3 Key model rules

- **Project is optional on a Task.** A Task always belongs to an Organization (and a Team); it can live in a Project, directly in a Program (ongoing work), or unsorted in **Triage**. This keeps "for Everything" honest — it has to hold messy ad‑hoc work, not just neat plans.
- **Milestones are an attribute of a Project** — dated checkpoints that group some of the Project's Tasks toward a deliverable. Not a top‑level thing.
- **Initiatives are many‑to‑many** with Programs and Projects (themes cut across). Workspaces may
  also arrange Initiatives into a shallow hierarchy whose maximum depth defaults to two total
  levels and is configurable. Hierarchy links are contextual references: they may point at an
  Initiative in another workspace, but never grant access to it.
- **Cycles are team‑scoped.** Each Team runs its own cadence.
- **Dependencies are org‑wide and cross‑project.** A Task can be "blocked by" / "blocking" any other Task in the organization, even in a different Project. The graph is kept acyclic.
- **Teams are first‑class** within an Organization. A Team owns its workflow states, its Cycles, and its Triage queue.

---

## 4. Actors & Agents

The single most important idea in Docket is this: the work doesn't care who does it. When you look at any piece of work, there is always a "who" attached — who's responsible, who's doing it, who made that last change. Docket calls that "who" an **Actor**, and an Actor can be a person on your team or an AI agent. The two are treated exactly the same way. You can hand a task to a colleague or hand it to an agent using the very same move, in the very same place. Nothing about your screens changes depending on which one you choose. This is deliberate: you plan your day around the work that needs to move forward, not around staffing a team of bots. An agent is just another capable pair of hands, and you decide, task by task, when it makes sense to use one.

Delegating to an agent should feel as ordinary as asking a reliable assistant to take something off your plate. Say you've got a batch of donor thank-you notes to send, next quarter's budget to update line by line, or a week of meetings that need rescheduling around a conflict. You hand the task to an agent the same way you'd hand it to a person — and then, instead of the work disappearing into a black box, it opens up in front of you. Docket shows the agent working as a live, plain-English play-by-play: what it's looking at, what it's deciding, what it's about to do. You can read along, nudge it when it's heading the wrong way, answer a question when it's unsure, or step in and take over entirely. The point of delegating isn't to make the work vanish — it's to watch it happen, and to trust it because you can see it.

And you are always the one in control. An agent never quietly changes things on your behalf. Before it commits anything that matters — sending those notes, saving that budget, moving those meetings — it pauses and asks for your go-ahead, and you approve, edit, or reject with a tap. You can also keep your own name on a task while letting an agent do the legwork: you stay the owner and accountable party, the agent is just the one carrying it out. Every action an agent takes is recorded with both names attached — the agent that did it and you, the person who set it in motion — so there's never any doubt about who was behind a change. The work moves faster because the agent does the doing; it stays trustworthy because nothing happens without you seeing it and saying yes.

Docket is AI‑native: people and agents are both first‑class. Everywhere the system asks "who" — assignee, owner, author of an action — it points to a single concept, an **Actor**.

- **Human** — a person. Backed by a global account that persists no matter which organizations they belong to.
- **Agent** — an AI worker (Athena, or a connected provider like Claude or Codex).
- **Team** — a named group of people. A grouping for organizing and permissions — **not** something you assign work to.

**You can assign work to a Human or an Agent** (they're interchangeable in the assignee field). You **cannot** assign work to a Team. There's also an optional **delegate**: you can stay the owner of a task and hand the _doing_ of it to an agent ("you own it, the agent does it").

### 4.1 Agents are execution muscle; sessions are the point

The important reframing: **Docket is not a place to curate a roster of AI "teammates" with elaborate personalities and settings.** Agents are simply how some work gets done. The brand barely matters (realistically: Athena, Claude, maybe Codex). What matters is **seeing the work** — transparently, with a human in control.

So the first‑class thing isn't the agent — it's the **Session**: one episode of an agent doing a job. A Session shows a live, plain‑English stream of what the agent is thinking and doing, asks you questions when it's unsure, and pauses for your approval before it commits changes. You can watch it, steer it, approve or reject its work, or take over.

```
   You delegate a task ─►  a SESSION opens ─►  you watch / approve / take over
                          (live activity + approval checkpoint)
```

- **The human checkpoint (approval gate).** Docket owns whether an agent's actions apply directly or need your sign‑off — independent of how capable the agent is. There are **two separate dials**: _what an agent may touch_ (it starts **read‑only** and asks for more access when it needs it) and _whether its actions need sign‑off_ (**suggest** = proposes only · **apply‑after‑approval** · **apply‑directly**). Pending approvals show up _in the session_ and also mirror to your cross‑org **Inbox/Today**, so you can sign off from wherever you are. By default the **approver is whoever assigned or delegated the task**, configurable per organization or team.
- **Accountability.** Every agent action is attributed to the agent _and_ records who set it in motion ("Athena, on behalf of you").
- **Domain‑neutral by design.** An agent might draft and queue a batch of donor thank‑you notes, update next quarter's budget across line items, or reschedule a week of meetings. The session and approval experience is the same regardless of the kind of work — it is never code‑specific.
- **Setup is light.** Athena is built in. Connecting another provider is a short flow in Settings. Agents start **read‑only** and ask for more access in the moment when they need it.
- **Guidance.** Agents automatically follow written instructions you set at the **organization and team level** (team instructions override the org's) — e.g. "always draft, never send, without my OK," or "match our brand voice."

---

## 5. The Command Center (multi‑org)

Picture the first thing you open each morning when you run more than one venture at once. Not a single startup's task list, and not a generic to-do app that flattens everything into one undifferentiated pile — but a personal command center that holds every world you're responsible for and lays the day out in front of you. This is the Hub: your private home base inside Docket, the one place that belongs to you rather than to any single organization. There is exactly one of these per person, and it is where you stand when you want to see the whole picture before you dive in.

The magic of the Hub is that it does two opposite things at once, and never confuses them. It keeps each venture's world cleanly separated — your startup's fundraising push never bleeds into your nonprofit's donor outreach, and a half-finished budget for one org never shows up tangled with a hiring plan for another. Yet it also lets you reach across all of them from a single vantage point: you can pull the three tasks that actually matter today out of four different organizations and set them side by side, see every approval an agent is waiting on no matter which venture it came from, and look at all your ventures' efforts on one shared timeline. Every item you pull in wears a small label telling you which organization it belongs to, so even when work from different worlds sits next to each other, you always know exactly whose it is. Nothing is merged; everything is gathered.

That is the heart of what makes Docket different from a spreadsheet, a generic planner, or a workspace built for one team. You don't have to log out of one tool and into another, or keep five browser tabs straight in your head, or mentally re-orient every time you switch from your company to your cause. You plan your whole day in one calm view, then drop into a single venture when it's time to do the focused work — at which point the entire app rebinds to that world, speaking its language and showing its people and tools — and step back up to the command center whenever you want the wide view again. The separation protects you from chaos; the unification gives you back the leverage of seeing everything you're carrying in one place.

The Hub is what makes Docket _yours_ rather than a nicer single‑workspace tool.

- **Today** — your daily cockpit: a personal plan you build by pulling tasks from any organization, beside your calendar, beside a "needs attention" column (agent approvals, blockers, due items). Every item is **org‑chipped** so you always know which venture it belongs to.
- **Inbox** — everything that needs a response across all your orgs (notifications, agent approvals), separate from a quieter **Activity feed** for passive awareness.
- **Portfolio** — a single cross‑org roadmap of every venture's Programs and Projects on one timeline.
- **Search / Command** — one `Cmd+K` palette that fuses search, navigation, actions, and switching orgs.

Drop into an organization and the whole app rebinds to that context. Step back to the Hub and you're aggregated again. (See §7 for the navigation model.)

---

## 6. Integrations

Every organization you run already lives in a scatter of tools. A startup keeps its planning in Linear, its code in GitHub, and its messages and meetings in Google Workspace. A nonprofit might run almost entirely out of Gmail, Google Calendar, and Google Tasks. Docket sits on top of those tools and connects to them one organization at a time, so the morning you sign up it can already show you real work pulled in from where it lives today.

From there, two kinds of connection exist, and the difference is about ownership. Linear is the migration source for planning work. Gmail, Google Tasks, Google Calendar, and GitHub remain authoritative for the data they own; Docket links to them and turns relevant signals into work.

Each organization connects **its own** toolstack (a startup's GitHub + Linear + Google Workspace; a nonprofit's Google Workspace). Docket sits _above_ those tools.

- **The end game: Docket becomes the source of truth — for the _work_ layer.** Like Linear, Docket aims to be where your planning and tasks truly live. Code stays in GitHub, while Gmail and Google Calendar remain authoritative — Docket _links_ to them.
- **Federation is the on‑ramp.** You start by importing/mirroring from the tools a team already uses, so Docket is useful on day one; over time it becomes the home.
- **Two ways to connect a tool:**
  - **Migration** (Linear): Docket _takes over_ — it imports the work in and becomes the source of truth.
  - **Connector** (GitHub, Gmail, Google Calendar, Google Tasks): Docket _complements_ — it links code, signal, time, and work while the external tool stays authoritative.
- **What integrations contribute:** **Work** → tasks; **Context** → linked docs; **Signal** (email/chat) → things that can become tasks/updates; **Time** (calendar) → deadlines; **Code** (pull requests/commits — the one explicitly software‑specific role) → links on a task.
- **Signal, concretely:** connect Gmail with one consent, and relevant messages land in your personal Stream next to everything else, each linking back to the thread.
- **MVP depth:** one‑time/transitional **import** for migration tools; **read‑only mirror** for connectors. Two‑way sync is a deliberate later step.

Linked work carries its **provenance** (where it came from, with a live link), so the unified views always show one clean picture, labeled by source.

---

## 7. Information Architecture

Docket only ever shows you one of two altitudes at a time, and a thin strip down the left edge of the screen is how you move between them. At the top sits your Hub — the bird's-eye view that gathers every venture you run into one place. Below it is a row of small avatars, one for each organization you belong to: a startup, a nonprofit, your own personal space. Tap the Hub and the whole app speaks in the language of "all your worlds at once" — your day laid out across ventures, everything waiting on you, the full roadmap of every campaign and project on a single timeline. Tap an organization's avatar and the entire app quietly re-aims at that one venture: the menu, the lists, the people, the connected tools all swap to belong to it and it alone. There is no half-in, half-out state and no risk of mixing a donor's name into a product launch — at any moment you are unambiguously either above everything or fully inside one thing.

**Two altitudes, one rail.** A persistent thin **global rail** on the left holds: Hub (Today) · Inbox · Search · one avatar per Organization · Personal space · "add org." Selecting the Hub or an Org **rebinds** the sidebar and main content — you're always unambiguously in one context.

- The **Hub is the unified layer** — its surfaces aggregate across orgs (not a merged tree).
- **Fluid drill‑down:** click a cross‑org item in the Hub and it rebinds you into that org's context, right at the item.
- **Org rail behavior:** each org avatar shows attention badges (unread + pending approvals) and can be reordered/pinned.
- **Landing is configurable** (Hub Today / a specific org / last‑used).

**Inside an Organization**, the sidebar reads: My Work · Triage · Initiatives · Programs · Projects · Cycles · Teams · Views · Agents · Settings. Sidebar labels honor the org's **vocabulary skin** (a nonprofit's may read "Campaigns / Grants / Events").

**View types** reused throughout: **List** with Linear‑style grouping/sub‑grouping (lists are the default; **kanban** — drag‑cards‑between‑columns boards — is de‑emphasized), **Timeline/Roadmap**, **Detail** pages, the **Session** view, and the **Daily Plan**.

---

## 8. The Screens

Each screen below records the decided layout and key behaviors. Flagship screens include a domain‑neutral wireframe.

### 8.1 Hub — Today cockpit (+ Inbox, Search)

Today is the screen you open first every morning, the one that answers the question "if I do nothing else, what actually matters right now?" If you run more than one venture, you know the failure mode well: a startup tab, a nonprofit spreadsheet, a personal to-do list, and a calendar that's a separate app entirely, with the real plan living only in your head. Today collapses all of that into one cockpit. The middle Plan column is a short list you build by hand each morning, pulling the few things you intend to do from any of your ventures, so it might hold "finalize the Q3 budget" from your startup right above "send the grant report" from your nonprofit. Every line carries a small colored chip naming the venture it belongs to, so the contexts sit side by side without ever blurring together. Beside it, your calendar shows the day's actual shape, and a Needs-Attention column gathers the things that will bite you if ignored: work due today, anything stuck waiting on something else, and approvals an AI worker is holding for your sign-off. The screen is shaped this way because a person juggling several organizations doesn't need more dashboards, they need one honest plan; Today is deliberately a calm, finite list of what you've chosen, not an anxious dump of everything that exists.

The flagship daily surface: a **three‑pane** cockpit — your **Plan**, your **Calendar**, and a **Needs‑Attention** column — with work **grouped by organization**.

```
┌───┬──────────────┬──────────────────────────────────────────────────────┐
│ ◉ │  HUB          │  Today · Thu Jun 5                        [ Plan day ▸]│
│   │  ──────────── │  ───────────────────────────────────────────────────  │
│ Ⓐ │ ▸ Today       │  PLAN              CALENDAR          NEEDS ATTENTION    │
│ Ⓝ │   Inbox       │  ▾ Acme Ⓐ          9  ▢ standup      ⚠ Approvals (2)   │
│ Ⓟ │   Portfolio   │   ☐ Q3 budget Ⓐ    10 ▢▢ deep work    • Athena: donor  │
│   │   Search      │   ☐ Hire JD   Ⓐ    12 ▢ lunch          notes  Ⓝ [▸]    │
│ + │              │  ▾ Hope Fund Ⓝ     1  ▢ board prep   ⛔ Blocked (3)     │
│   │              │   ☐ Grant rpt Ⓝ    3  ▢ 1:1          ⏰ Due today (2)   │
│   │              │   ☐ Volunteers Ⓝ                     📨 Inbox (5)       │
│   │              │  + pull from any org…                                   │
└───┴──────────────┴──────────────────────────────────────────────────────┘
  rail   Hub sidebar     Ⓐ Acme(startup) · Ⓝ Hope Fund(nonprofit) · Ⓟ Personal
```

- **Approvals: digest → detail.** Today shows a compact approvals digest (one‑tap for low‑risk); the full diff/question is handled in the Inbox.
- **Inbox is split** from a passive **Activity feed** (action vs. awareness).
- **Org rail:** badged + reorderable. **Search:** one `Cmd+K` unified command palette (entities + navigation + actions + org‑switch; Hub‑global vs. org‑local toggle).

### 8.2 Portfolio — cross‑org roadmap

Portfolio is the wide-angle view, the answer to "across everything I'm running, what's in flight and when does it land?" Today is about this morning; Portfolio is about the next few months. It lays out a single timeline where each venture gets its own horizontal band, and inside that band the venture's ongoing areas of operation (a nonprofit's mentorship work, a startup's customer success) form lanes, while the bounded efforts inside them (a spring fundraising gala, a paid product launch) appear as bars stretched across the weeks they'll take. A diamond on a bar marks a checkpoint worth hitting; a small robot mark flags where an AI worker is active or waiting on you. Crucially, the bands stay separate: you see your startup's launch and your nonprofit's gala on the same screen, on the same calendar, without their data ever mixing. Strategic themes that cut across ventures ("grow revenue," "reach more families") aren't drawn as more bars cluttering the picture; they're filter chips you toggle to spotlight just the efforts tied to a theme and dim the rest. It's shaped as one continuous timeline because the thing a multi-venture operator most often gets wrong is timing collisions, two big pushes landing in the same week, and the only way to catch that is to see them all on one ruler.

One timeline across every venture.

```
┌────────────────┬──────────────────────────────────────────────── now ─────┐
│ ▾ Acme  Ⓐ      │            ┃                                                │
│   Cust. Success│  ▐███ onboarding ▌  ▐██ retention ▌●          ┃ (Program   │
│   Growth       │       ▐████ paid launch ▌◆◆                   ┃  = lane,    │
│ ▾ Hope Fund Ⓝ  │            ┃                                   ┃  Project   │
│   Mentorship   │  ▐█████ spring cohort ▌◆        ▐██ gala ▌🤖   ┃  = bar)    │
│   Operations   │  ▐ grants (ongoing) … ──────────────────────► ┃            │
└────────────────┴───────────────────────────────────────────────────────────┘
  rows = org swimlanes → Program lanes → Project bars
  bars: name + health tint + milestone ◆ + agent/approval 🤖 signal
  Initiatives = filter chips (dim non-members) · adaptive-density time scale
```

- Rows are **org swimlanes** (default). Within each, **Programs are lane containers** (no bar — they never end) and **Projects are bars** inside their Program lane.
- **Initiatives are filter chips** that highlight/dim, not drawn geometry.
- Time scale auto‑picks granularity from what's visible (manual override).

### 8.3 Org work views — My Work, Task list, Triage, Views

When you step out of the bird's-eye Hub and drop into a single organization, the work views are where you actually live inside that venture. My Work is your personal slice of it, and it's split in a way that reflects how Docket really operates: one side is what's assigned to you to do yourself, the other is what you've handed to an AI worker and what's now waiting for your approval, so delegated work never silently disappears. The Task list is the main workhorse, organized first by which effort each task belongs to and then by how far along it is, so a long list stays legible instead of becoming a wall. Where an AI worker is running a task, its row shows a small live pill, and you can tap straight into watching that work happen. Triage is the holding pen for everything that arrives unsorted, a forwarded email that should become a task, a request from a teammate, a suggestion an agent surfaced, presented as one plain newest-first list, each item tagged with where it came from, so nothing falls through the cracks before you've decided what it is. And because the same view can be shared with collaborators, every shared view quietly respects each person's access: a volunteer with limited permissions opening your shared list simply never sees the work they aren't allowed to see. The whole area is shaped to move incoming chaos toward decided, organized work without forcing you to file everything the moment it appears.

- **My Work** is an **agent‑aware split**: "Assigned to me" vs. "Delegated to my agents / awaiting my approval."
- The **Task list** defaults to **group by Project → sub‑group by Status** (Linear‑style nesting; lists preferred over boards). Agent‑run rows show a **live‑session pill** (running / awaiting‑approval / paused / errored) that opens the Session.
- **Triage** (the holding pen for unsorted incoming work — from integrations, other teams, or agent proposals) is an **org‑level aggregate that drills into per‑Team queues**, shown as one simple newest‑first list, each item source‑tagged.
- **Saved Views** are shareable but **permission‑filtered** — a shared view always respects each person's access (a guest never sees hidden work).

### 8.4 Project / Program / Initiative detail

This is the page you open when you want to understand one effort deeply, and Docket deliberately gives it three different shapes depending on what kind of effort it is, because a bounded project and an endless operation are honestly different animals. A Project, something with a finish line like a product launch or a gala, leads with an overview: a progress bar that fills as tasks get done (and counts the heavier tasks for more, so it reflects real effort rather than raw count), a one-glance health label, and the work grouped under the dated checkpoints it's building toward. Its discussion and the running log of what AI workers have done live in a side panel, with a dedicated strip showing which agents are active here and whether any are waiting on you, so you're never surprised by autonomous work. A Program, the ongoing kind of work that never finishes, like a customer-support function or a nonprofit's after-school program, drops the progress bar entirely (there's no 100% to reach) and instead shows a health-and-flow snapshot, with its long history organized by time period so it stays usable even after years of accumulation. An Initiative, which is purely a strategic theme rather than a container of tasks, leads with a timeline rollup of all the efforts that ladder up to it, and its status is calculated automatically from its children rather than something you have to keep updating by hand. The page is shaped this way so the headline you see always matches the question you'd actually ask about that kind of work.

```
┌──────────────────────────────────────────────────────────────┬────────────┐
│ Paid Launch  ●On track   ▓▓▓▓▓▓░░ 68%   target Jun 30          │ PROPERTIES │
│ [ Overview ]  Tasks   Updates                                  │ Lead  …    │
│ ───────────────────────────────────────────────────────────── │ Dates …    │
│ ▾ Milestone: Beta (done)                                       │ Program …  │
│    ☑ pricing page     ☑ checkout flow                          │ Initiative…│
│ ▾ Milestone: GA (now)                                          │ ────────── │
│    ☐ onboarding emails     ☐ launch post                       │ AGENTS HERE│
│ 🤖 Agents here: Athena · last: drafted launch post · ⚠ 1 appr  │ comments + │
│                                                                │ activity ▾ │
└──────────────────────────────────────────────────────────────┴────────────┘
```

- **Project:** overview‑first; a **weighted‑progress bar** (fills as tasks complete, with bigger tasks counting for more) + a **health pill**; tasks grouped into **Milestone sections**; **Updates get their own tab**; **comments + agent activity live in the properties panel**; a **dedicated "agents here" strip**.
- **Program** (ongoing, no % bar): headline is a **health + flow snapshot**; its work list is **grouped by Cycle, segmented by Project** so it stays usable as it accumulates for years.
- **Initiative:** a **document-first strategic brief** with a manual lifecycle, independently
  writable health, latest narrative update, generated document contents, sub-Initiatives, and
  deduplicated connected Programs/Projects. Connected-work health is a supporting rollup rather
  than the Initiative's status or health. The overview surfaces off-track, at-risk, and stale
  Initiatives before the dense hierarchy roster.

### 8.5 Cycle detail + Task detail

These two detail screens sit at the most granular level, where planning meets the actual doing. A Cycle is a fixed stretch of time, often two weeks, that a team commits a batch of work to and then reviews, like a marketing team's content push or a monthly giving drive. Its screen is a focused list of the committed tasks (grouped by which effort each belongs to) topped by a collapsible stats banner that answers "are we on pace?": a line tracking how much of the planned work is done versus still remaining, alongside the team's capacity and any scope that crept in. And because real work always overruns, the close of a cycle isn't automatic, you're walked through each leftover task and decide, one by one, whether to keep it, move it forward, or send it back to be re-sorted, so nothing rolls over by accident. The Task screen is the smallest unit, and it's built so the human and the AI worker share one timeline: when you delegate the task, the agent's live activity streams right inside the same comment-and-activity feed where your own notes go, so watching the work is the same surface as discussing it. The to-do steps within the task sit as a simple inline checklist under the description, and because something blocking this task might live in an entirely different effort, a dedicated section shows those dependencies and names which effort each one comes from. It's shaped this way so the unit where work actually gets done never hides what an agent is doing or what's standing in the way.

- **Cycle:** a **list with a collapsible stats banner** (a **burn‑up line** — planned work done vs. remaining — plus capacity, scope changes, carryover); tasks **grouped by Project/Program**; carryover is **reviewed before it rolls** (at cycle close, keep / move / return‑to‑Triage each leftover).
- **Task:** the agent **session streams inline in the comment+activity feed**; **subtasks are an inline checklist** under the description, with a **dedicated dependency‑visualization section** (dependencies are cross‑project, so each shows the other task's project); external links appear as **rows in the properties panel**.

### 8.6 Agents — sessions‑first

> **Build status (2026-07-03)**: shipped end-to-end. The agentic loop (multi-turn tool use
> over the same MCP catalog third-party agents get), the three-dial approval policy,
> durable pause/resume transcripts, batch proposals with the ghost grammar
> (`docs/design/ghost-grammar.md`), the SSE live tail, the Athena chat thread (⌘J), remote
> MCP connections, the paid-plan gate, and the firehose-onboarding prompt are all live —
> see `docs/engineering/specs/athena-agent.md`.

This is where you go to watch the work happen. When you hand a job to an agent, what you really want isn't a folder of robot profiles to manage — it's a window into what is being done on your behalf right now, with the power to step in. So the Agents area isn't a roster of AI helpers; it's a living feed of sessions, where a session is one episode of an agent doing one job: drafting a batch of donor thank-you notes, reconciling next quarter's budget, rescheduling a week of meetings. You can filter the feed by what needs you most — what's running, what's paused waiting for your yes-or-no, what finished, what hit a snag. Open any session and you get a plain-English narration of the agent's thinking alongside a running list of exactly what it has changed, so there are no surprises buried in the result. The screen is split this way on purpose: the left side is the story (what it's doing and why, the questions it's asking), and the right side is the receipt (what's actually changed, who set it in motion, and the buttons to pause, take over, or cancel). Crucially, the agent can't quietly send those fourteen notes or move that money — it proposes, and the proposal waits for your tap. That same pending approval also surfaces in your cross-org Inbox and Today, so you're never forced to camp out on this screen to keep things moving. The point is calm visibility: the work is transparent, you stay in control, and the brand of the agent doing it barely matters.

The "Agents" area is essentially a **live, filterable feed of Sessions** (running / awaiting‑approval / done / errored), each opening the Session view:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Task: Send donor thank-you notes               Ⓝ Hope Fund               │
│ 🤖 Athena · on behalf of you · running 1m                                   │
├───────────────────────────────────────────┬──────────────────────────────┤
│ ACTIVITY                                   │ CHANGES THIS SESSION          │
│ 💭 Pulling the 14 donors from last week…   │ • drafted 14 notes            │
│ 💬 "Drafts ready. Tone: warm, brief."      │ • (awaiting approval to send) │
│ ⚠ PROPOSED  Send 14 thank-you notes        │ ────────────────────────────  │
│   [ Approve & send ▸ ]   [ Review each ]   │ ACCOUNTABILITY                │
│ ❓ "Include the year-end event invite?"     │ Athena · on behalf of you     │
│   ┌ reply ───────────────────────────────┐ │ [ Pause ] [ Take over ]       │
│   │ Yes, add it to the top 5 donors.     │ │ [ Cancel session ]            │
│   └─────────────────────────────[ Send ]─┘ │                               │
└───────────────────────────────────────────┴──────────────────────────────┘
```

- **Approval flow:** pending actions appear in the session **and** mirror to your Inbox/Today.
- Provider (Athena/Claude/Codex) is a minor chip. **Setup lives in Settings** (connect a provider; Athena built‑in). Permissions start **read‑only, grant‑on‑request**.

### 8.7 Settings (user-owned, with workspace administration)

Settings belongs to the user because Athena is the user's digital chief of staff and Docket is a centralized place to view data from many streams. The global Settings area is ordered around the user's relationship with Athena: Profile, Athena, Connections, Notifications, Calendar, Security, Connected apps, Data & privacy, and Workspaces. Connections are outbound: they are the apps Athena uses as data sources. Connected apps are inbound: external clients the user has authorized to access Docket. Workspace administration remains available under Workspaces for members, roles, billing, work structure, imports, and workspace-level automations.

- **One "Members & Access" area** — people are primary; access is editable per‑person and from each resource. Granular permissions are shown as **plain‑language roles** (Owner/Admin/Member/Guest), with the detailed capability grid behind an "advanced" option for custom roles. **Guests** sit in the same list with a "Guest" badge and see nothing until granted.
- **Connections** — a **categorized directory** of the external services Athena can use; connecting a tool is a **wizard that picks Migration vs. Connector up front**, consequences spelled out.
- **Vocabulary skins** — chosen from **preset themes** (Startup / Nonprofit / Agency) that remap Docket's words for that org.

### 8.8 Landing + Sign‑up + Onboarding _(top priority)_

This is the most important moment in the entire product, because it's where a curious visitor decides whether Docket is for them — and the answer has to be obviously yes within minutes. The landing page makes a confident, Linear-grade promise: one calm command center for running everything you're responsible for. Signing up is deliberately frictionless — you use your device's face or fingerprint instead of inventing yet another password, and if you'd rather sign in with an account you already have, that same choice quietly doubles as connecting a tool Docket can pull real work from. There's no credit card asked of someone just trying it for themselves; you're only asked to pay when you create a shared space and bring other people in, which is exactly when the value becomes a team value. The first thing Docket asks after you're in is simply who this is for — a startup, a nonprofit, or just you — and that single fork quietly tailors everything that follows, including the words the product uses, which we present not as a buried setting but as a point of pride. Then comes the move that earns trust: instead of dropping you into an empty, intimidating blank slate, Docket connects to a tool you already live in and imports your actual work, so the very first screen you see is filled with your real tasks, your real deadlines, your real venture. That's the "oh, this is genuinely useful" beat. Meeting Athena and discovering the multi-organization Hub come later, gently, once your first organization has enough substance to make them feel earned rather than overwhelming.

A Linear‑grade marketing landing flows into:

- **Passkey‑first sign‑up** (passkey = sign in with your device's face/fingerprint, no password), with Google / Linear / GitHub as secondary options that double as data‑source links.
- A **14‑day, tier‑dependent trial**: no credit card for Personal/solo use; a card is required only when you create a shared team org or invite people. (After the trial, your data stays exportable and is deleted about two weeks later if you don't continue.)
- **First screen after sign‑in: an intent fork** — "a startup / a nonprofit / just me" — that branches the defaults and starter structure.
- A focused workspace-name step that uses Docket's standard product terminology.
- **First work = connect a tool and import real work**, so the first screen shows _your_ actual work — the strongest "this is useful" moment.
- An **optional, skippable "Meet Athena" step.**
- The Hub/multi‑org model is revealed progressively, once the first org has substance.

### 8.9 Service Admin dashboard (operator back‑office)

This screen is the only one in the plan that customers never see — it's the back office our own team uses to run Docket as a business, the equivalent of the dashboard a payments company keeps behind the scenes to support its merchants. It exists because a real product needs a place to answer support questions, fix billing, and keep an eye on the system's health without anyone touching a database by hand. It's organized around people rather than organizations, which matters here precisely because a single person may run several ventures inside Docket; when someone writes in for help, you start from that human and fan out to whichever of their organizations is relevant. The everyday rescue actions live right where a support or finance teammate can reach them — extending a trial that lapsed at a bad moment, issuing a credit, changing a plan, processing a refund — and those changes flow straight through to billing so the records never drift apart. Because Docket promises that a customer's data stays exportable and is only deleted well after they leave, this screen makes that promise visible and enforceable: it shows exactly where each account sits in its lifecycle and lets staff place a hold to stop the clock when needed, with every such action written into a permanent log. That same discipline governs the most sensitive capability — temporarily viewing the product as a customer to diagnose their problem — which is always wrapped in a warning banner, time-limited, requires a stated reason, and is fully audited, because seeing someone's private workspace is a privilege that must be accountable. The agent-oversight view stays deliberately high-level: aggregate signals like how much work is flowing and where approvals are getting stuck, never the contents of anyone's actual sessions.

For _our_ team running the hosted business (not a customer surface) — "Stripe's dashboard, but for Docket":

- **Split metrics + queues** home; **user‑primary** navigation (a person spans many orgs; reach orgs from a user).
- **Common billing actions inline** (extend trial, credit, change plan, refund, pause dunning), writing back to Stripe.
- A **data‑lifecycle pipeline** (trial → export → grace → delete) with first‑class **holds** and a full **audit trail**.
- Staff roles: **Support / Finance / Superadmin**; support **"View as"** is banner‑wrapped, time‑boxed, reason‑logged, audited.
- Agent oversight: **health signals only** (aggregate volume, errors, stuck approvals).

---

## 9. Out of Scope (for the MVP, or deliberately not owned)

- **Two‑way integration sync** — MVP is import + read‑only mirror; bidirectional is a fast‑follow.
- **Native documents** — document storage is outside the current provider allowlist and is not a Docket integration surface.
- **An agent marketplace / agent "skills"** — agents are execution muscle; keep the provider set small (Athena, Claude, maybe Codex). Skills, if ever, are an Athena concern, not a Docket product feature.
- **Owning code, files, calendar, or email** — these stay in their authoritative tools; Docket links.
- **Capacity/load planning that mixes agent cost with human hours** — out for MVP.

---

## 10. Open Questions

- **Hub naming** — "Hub" is a working name (alternatives: "Home", "your Docket").
- **Program label** vs. vocabulary skins — Program is its own entity; confirm how skins rename it per org.
- **MVP scope line** — how much of granular permissions, the multi‑org breadth, and the MCP/agent surface ships in v1 (a dedicated scope‑cut pass; several items above are clearly post‑MVP).
- **Cross‑org daily plan** edge cases (e.g. a personal task with no org).

---

_Engineering architecture, the data model, the stack, and infrastructure decisions live in `docs/engineering/docket-engineering-plan.md`._
