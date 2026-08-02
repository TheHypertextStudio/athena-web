import type { JSX, ReactNode } from 'react';

import './brief.css';

/**
 * Layout for the `(public)` route group — the surfaces an anonymous visitor can reach.
 *
 * @remarks
 * Deliberately almost nothing. The authenticated `(app)` group wraps its pages in the product
 * shell (sidebar, activity rail, tab bar) and redirects a signed-out request to `/sign-in`;
 * neither is wanted here. A published brief is a document, not a screen of an application, so
 * the only chrome this layout contributes is a page background and the document stylesheet.
 *
 * There is no session read at all — not a permissive one, none. A brief's readability is decided
 * entirely by the workspace that published it, so asking who the visitor is would add a
 * dependency (and a cookie-driven render) for a decision that does not depend on the answer.
 *
 * Typography is inherited from the root layout's IBM Plex Sans, which is the point: the brief is
 * recognisably the same product's voice without being dressed as the product's interface.
 *
 * @param props - The route group's children.
 * @returns The public document frame.
 */
export default function PublicLayout({ children }: { children: ReactNode }): JSX.Element {
  return <div className="brief antialiased">{children}</div>;
}
