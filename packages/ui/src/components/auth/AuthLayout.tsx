/**
 * `@docket/ui` — `AuthLayout`, the bounded card every authentication surface renders inside.
 *
 * @remarks
 * A focused container centred on the app canvas, following the Google sign-in shape: inside the
 * card, a two-column split puts the question on the left and the thing you act on — form, or
 * permission list — on the right, so a wide viewport is used rather than stacking everything into
 * one narrow column. Below `@3xl` the columns become one and the card narrows.
 *
 * The split is deliberate and it is not branding. The left column carries the heading and only the
 * context needed to answer it (on the consent screen: who is asking, as which account, where you
 * will be returned); the right carries the controls. An auth screen is a utility surface, so there
 * is no tagline, no marketing panel, and no explanatory copy about how passkeys work.
 *
 * `brand` is a slot rather than a rendered link because `@docket/ui` imports nothing from
 * `next/` and each consuming app routes differently.
 *
 * @example
 * ```tsx
 * <AuthLayout brand={<Wordmark />} intro={<h1>Welcome back</h1>}>
 *   <SignInForm />
 * </AuthLayout>
 * ```
 */
import type * as React from 'react';

import { cn } from '../../lib/utils';

/** Props for {@link AuthLayout}. */
export interface AuthLayoutProps {
  /** The wordmark, rendered above the card. A slot so each app supplies its own face and router. */
  readonly brand: React.ReactNode;
  /** The left column: the heading, and only the context needed to answer it. */
  readonly intro: React.ReactNode;
  /** The right column: the form or permission list, and the actions. */
  readonly children: React.ReactNode;
  /** Extra classes for the card. */
  readonly className?: string;
}

/**
 * The centred auth card with its context/action split.
 *
 * @param props - See {@link AuthLayoutProps}.
 * @returns The `<main>` element wrapping the card.
 */
export function AuthLayout({
  brand,
  intro,
  children,
  className,
}: AuthLayoutProps): React.JSX.Element {
  return (
    // The auth tree sits outside AppShell, so nothing upstream establishes a container context and
    // container-query utilities copied from app pages would silently never match. Declare it here.
    // `min-h-dvh` with ordinary document scroll: the card grows and the page scrolls, rather than
    // the card clipping or the layout fighting the viewport.
    //
    // No gutter below `@md`. A phone has ~390px to spend and an outer gutter plus the card's own
    // inset was charging ~40px a side for the privilege of drawing a border nobody can see against
    // a full-height card. The card goes edge-to-edge there and only becomes a card — max width,
    // radius, border, shadow, canvas around it — once there is width to spare.
    <main className="bg-surface-container text-on-surface @container min-h-dvh">
      {/* A container query cannot target the element that declares the container, so the centring
          lives on this descendant rather than on <main> — as a class on <main> it silently never
          matched and the card sat pinned to the top-left. */}
      <div className="flex min-h-dvh flex-col @md:items-center @md:justify-center @md:px-4 @md:py-8">
        <div
          className={cn(
            'bg-surface flex min-h-dvh w-full flex-col justify-center gap-6 px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]',
            // A floor height rather than hugging the content, which made the card a squat
            // letterbox on a desktop viewport once the two columns halved its height.
            'border-outline-variant @md:min-h-80 @md:max-w-md @md:rounded-xl @md:border @md:p-6 @md:shadow-sm',
            '@3xl:min-h-96 @3xl:max-w-3xl @3xl:p-10',
            className,
          )}
        >
          {/* Inside the card, not floating above it: nothing on this screen sits outside the one
              surface being acted on. */}
          {brand}
          <div className="grid gap-6 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @3xl:gap-12">
            <div className="flex min-w-0 flex-col gap-3">{intro}</div>
            <div className="flex min-w-0 flex-col gap-6">{children}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
