import { copyIdentityKey, type CopySourceIdentity } from '@docket/work/template-copy';
import type {
  WorkTemplateGalleryItem,
  WorkTemplateGalleryQuery,
} from '@docket/work/template-gallery-contract';

/** Human labels over actual catalog categories, preserving the authored browse order. */
export const GALLERY_CATEGORIES: readonly {
  readonly value: NonNullable<WorkTemplateGalleryQuery['category']>;
  readonly label: string;
}[] = [
  { value: 'intake', label: 'Requests and actions' },
  { value: 'engineering-product', label: 'Engineering and product' },
  { value: 'marketing-content', label: 'Marketing and content' },
  { value: 'sales-clients', label: 'Sales and clients' },
  { value: 'operations-finance', label: 'Operations and finance' },
  { value: 'people', label: 'People' },
  { value: 'nonprofit', label: 'Nonprofit' },
  { value: 'events', label: 'Events' },
  { value: 'research-writing', label: 'Research and writing' },
  { value: 'personal', label: 'Personal' },
];
/** Explicit gallery audience choices, independent of organization creation intent and vocabulary. */
export const GALLERY_FORKS = [
  { value: 'startup', label: 'Startups', all: 'All startup work' },
  { value: 'nonprofit', label: 'Nonprofits', all: 'All nonprofit work' },
  { value: 'agency', label: 'Agencies', all: 'All agency work' },
  { value: 'personal', label: 'Personal work', all: 'All personal work' },
] as const;
interface Outcome {
  readonly name: string;
  readonly slugs: readonly string[];
}
/** Optional curated navigation; membership and complete fork selection always come from the server. */
export const GALLERY_OUTCOMES: Readonly<
  Record<NonNullable<WorkTemplateGalleryQuery['fork']>, readonly Outcome[]>
> = {
  startup: [
    { name: 'Ship a product', slugs: ['product-launch', 'product-release'] },
    { name: 'Keep delivery moving', slugs: ['bug-report', 'incident'] },
    { name: 'Publish useful updates', slugs: ['content-calendar', 'newsletter-issue'] },
  ],
  nonprofit: [
    { name: 'Deliver your program', slugs: ['program-delivery', 'cohort'] },
    { name: 'Bring people together', slugs: ['event', 'community-event'] },
    { name: 'Fund your work', slugs: ['fundraising-campaign', 'grant-application'] },
  ],
  agency: [
    { name: 'Run a client engagement', slugs: ['client-engagement', 'proposal'] },
    { name: 'Deliver a campaign', slugs: ['campaign', 'content-calendar'] },
    { name: 'Keep the business running', slugs: ['month-end-close', 'invoice-run'] },
  ],
  personal: [
    { name: 'Keep up with everyday work', slugs: ['weekly-review', 'renewal-personal'] },
    { name: 'Plan something ahead', slugs: ['trip', 'move'] },
    { name: 'Make room for a longer goal', slugs: ['side-project', 'learning-a-skill'] },
  ],
};
/** Selection keys bind actual released identity; equal names never merge unrelated catalog entries. */
export function galleryItemKey(item: WorkTemplateGalleryItem): string {
  return copyIdentityKey(item.identity);
}

/** Exact checked source identity, including tenant, draft revision or immutable publication. */
export function gallerySourceKey(identity: CopySourceIdentity): string {
  return copyIdentityKey(identity);
}
