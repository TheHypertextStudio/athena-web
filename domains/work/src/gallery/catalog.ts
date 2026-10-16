import { INTAKE_GALLERY } from './intake';
import { ENGINEERING_GALLERY } from './engineering';
import { MARKETING_GALLERY } from './marketing';
import { SALES_GALLERY } from './sales';
import { OPERATIONS_GALLERY } from './operations';
import { PEOPLE_GALLERY } from './people';
import { NONPROFIT_GALLERY } from './nonprofit';
import { EVENTS_GALLERY } from './events';
import { RESEARCH_GALLERY } from './research';
import { PERSONAL_GALLERY } from './personal';
import { PROGRAM_GALLERY } from './programs';
import type { GalleryEntry } from './types';
/** Complete checked first-release catalog; installation always creates independent destination copies. */
export const GALLERY_CATALOG: readonly GalleryEntry[] = [
  ...INTAKE_GALLERY,
  ...ENGINEERING_GALLERY,
  ...MARKETING_GALLERY,
  ...SALES_GALLERY,
  ...OPERATIONS_GALLERY,
  ...PEOPLE_GALLERY,
  ...NONPROFIT_GALLERY,
  ...EVENTS_GALLERY,
  ...RESEARCH_GALLERY,
  ...PERSONAL_GALLERY,
  ...PROGRAM_GALLERY,
];

function freezeCatalogData(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freezeCatalogData(child);
  Object.freeze(value);
}
// A destination writer parses its own copy; a released source version never changes in memory.
freezeCatalogData(GALLERY_CATALOG);
