import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { SiteFooter } from '@/components/marketing/site-footer';
import { SiteHeader } from '@/components/marketing/site-header';

export const metadata: Metadata = {
  title: {
    default: 'Docket — the command center for everything you run',
    template: '%s — Docket',
  },
  description:
    'Docket is the calm command center for every organization you run — startups, nonprofits, and personal projects — unified in one daily view.',
};

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
