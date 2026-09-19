/**
 * `app-shell-skeletons` — the rail's identity-gated placeholders, split out of `app-shell-frame.tsx`
 * to keep that file under the complexity and length ceilings.
 *
 * @remarks
 * Both are shown only while the viewer's identity is unresolved: the account row before any
 * session, snapshot or `initialSession` names who is signed in, and the Agenda/Tasks day plans are
 * per-user reads that cannot mount before there is a user to key them by.
 */
import { Skeleton } from '@docket/ui/primitives';
import { type JSX } from 'react';

/**
 * Rendered when there is no live session, no server-confirmed `initialSession` and no offline
 * snapshot — i.e. nobody can say whose name and avatar belong here.
 *
 * @remarks
 * Every one of those three sources is absent only on a cold entry that bypassed the layout's
 * server-side session read, so in practice this is a fallback rather than a first-paint treatment.
 */
export function AppShellAccountSkeleton(): JSX.Element {
  return (
    // placeholder: the signed-in account's name, email and avatar — unknown until a session resolves
    <div className="flex items-center gap-2 px-2 py-2" aria-hidden="true">
      <Skeleton className="size-7 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="rounded-corner-xs h-3.5 w-24" />
        <Skeleton className="rounded-corner-xs h-3 w-32" />
      </div>
    </div>
  );
}

/**
 * Rail placeholder used while the viewer's identity is unknown.
 *
 * @remarks
 * The Agenda and the Tasks day-plan are both per-person reads keyed by the signed-in user, so
 * neither can be mounted before there is a user to key them by. Gated on identity alone — never on
 * the workspace list, which the rail does not need.
 */
export function AppShellAgendaSkeleton(): JSX.Element {
  return (
    // placeholder: the signed-in person's agenda and day plan — per-user reads with no viewer yet
    <div className="flex flex-col gap-4 p-4" aria-hidden="true">
      <Skeleton className="rounded-corner-xs h-5 w-20" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}
