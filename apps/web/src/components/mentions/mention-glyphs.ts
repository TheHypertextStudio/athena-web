/**
 * The marks and words Docket uses for external resources.
 *
 * @remarks
 * Closed records rather than lookups with fallbacks, so adding a resource type or a provider is a
 * compile error until its glyph and its label exist. A mention that renders with no mark, or with
 * a raw enum value as its label, is exactly the kind of small wrongness that makes a product feel
 * unfinished.
 *
 * Every label here is application-owned copy. Nothing a provider says ever reaches the screen.
 */
import {
  Calendar,
  FileGeneric,
  FileImage,
  FilePdf,
  FilePresentation,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Globe,
  Mail,
  Target,
  type LucideIcon,
} from '@docket/ui/icons';
import { RESOURCE_PROVIDER_LABEL } from '@docket/connections/resource-provider-contract';
import type { ExternalResourceType } from '@docket/connections/resource-provider-contract';

/** The mark for each kind of external resource. */
export const RESOURCE_TYPE_ICON: Record<ExternalResourceType, LucideIcon> = {
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: FilePresentation,
  folder: Folder,
  pdf: FilePdf,
  image: FileImage,
  video: FileVideo,
  file: FileGeneric,
  issue: Target,
  message: Mail,
  event: Calendar,
  page: Globe,
  // A resource whose metadata has not resolved yet is still a link, and a link's honest mark is
  // a globe — not a spinner, and not a blank box that reflows when the real glyph arrives.
  unknown: Globe,
};

/** What each kind of external resource is called. */
export const RESOURCE_TYPE_LABEL: Record<ExternalResourceType, string> = {
  document: 'Doc',
  spreadsheet: 'Sheet',
  presentation: 'Slides',
  folder: 'Folder',
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  file: 'File',
  issue: 'Issue',
  message: 'Message',
  event: 'Event',
  page: 'Page',
  unknown: 'Link',
};

/**
 * What each source is called, in Docket's words.
 *
 * @remarks
 * Re-exported from the registry rather than restated, so adding a source never leaves a menu row
 * rendering a raw enum value.
 */
export const MENTION_PROVIDER_LABEL = RESOURCE_PROVIDER_LABEL;
