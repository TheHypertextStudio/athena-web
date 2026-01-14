/**
 * Tasks layout with modal slot for intercepted routes.
 *
 * Uses Next.js parallel routes to render task detail modals
 * over the task list when navigating within the app.
 * View transitions are enabled via next-view-transitions at the root layout.
 */

import type { ReactNode } from 'react';

interface TasksLayoutProps {
  children: ReactNode;
  modal: ReactNode;
}

export default function TasksLayout({ children, modal }: TasksLayoutProps) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
