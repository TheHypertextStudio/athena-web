import { preload } from 'react-dom';

const productFonts = [
  '/fonts/ibm-plex-sans/26d4368bf94c0ec4-s.p.woff2',
  '/fonts/ibm-plex-mono/d3ebbfd689654d3a-s.p.woff2',
  '/fonts/ibm-plex-mono/98e207f02528a563-s.p.woff2',
  '/fonts/ibm-plex-mono/db96af6b531dc71f-s.p.woff2',
  '/fonts/ibm-plex-mono/37786be940ec402b-s.p.woff2',
];

const displayFonts = [
  '/fonts/fraunces/a5782d3d220d0319-s.p.woff2',
  '/fonts/fraunces/aaa12613ff216824-s.p.woff2',
];

/** Preload the existing Latin product faces while rendering the root layout. */
export function preloadProductFonts(): void {
  for (const href of productFonts) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
}

/** Preload Fraunces only while rendering marketing, authentication or onboarding. */
export function preloadDisplayFonts(): void {
  for (const href of displayFonts) {
    preload(href, { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }
}
