# Shared App Shell Layout Design

## Objective

Mount one app shell for every route in the `(app)` group and keep that same shell instance alive
while session, workspace, and page state resolve. Loading changes content inside the shared layout;
it never replaces the layout itself.

## Architecture

`apps/web/src/app/(app)/layout.tsx` remains the shared Server Component boundary for product routes.
It renders `AppShellFrame` directly, without a full-layout Suspense boundary or alternate shell
fallback.

`AppShellFrame` is the single client coordinator. It always mounts the stable shell providers and
one `AppShell` instance. Session and organization queries produce a resolved or provisional model
for the shell's existing slots:

- Home navigation is always present.
- Workspace switching, Search, account actions, the agenda, and protected route content stay inert
  or provisional until their required context exists.
- Workspace and content skeletons occupy their normal regions inside the mounted shell.
- A resolved missing session opens the existing authentication interlock over the mounted shell.

There is no `AppShellLoadingFrame` and no duplicate loading shell tree.

## Authentication Return Path

The shell must not call `useSearchParams()`, because doing so forces the shared layout beneath a
Suspense boundary during static rendering. When a session resolves missing, the authentication
effect constructs the return path from the current pathname and `window.location.search`. The
effect runs only in the browser, where the query string is available without suspending layout
rendering.

## State Flow

1. The `(app)` layout mounts `AppShellFrame` once.
2. The frame immediately renders one `AppShell` with provisional sidebar and content slots.
3. After the session resolves, the organization query is enabled.
4. Until organizations settle, the same shell continues rendering provisional slots.
5. Once context is ready, real sidebar controls, agenda, account menu, providers, and route content
   replace only their corresponding slots within the existing shell.
6. Query errors use the current application-owned workspace error handling; they do not remove the
   shell.

## Accessibility and Responsive Behavior

The main loading region remains a named, busy status. Disabled controls expose their unavailable
state through native semantics. Desktop navigation, the mobile header, and the mobile drawer all
come from the same persistent `AppShell` instance, so the loading transition cannot change the
responsive layout boundary.

## Validation

- A component regression records the shell instance and proves it is not replaced when session and
  organization state resolve.
- Existing tests continue to verify protected children remain hidden and the signed-out interlock
  preserves the return path.
- Focused web and UI tests, typecheck, lint, and production build validate the refactor.
- Desktop and mobile browser checks confirm the mounted layout remains visible throughout a delayed
  sign-in transition.
