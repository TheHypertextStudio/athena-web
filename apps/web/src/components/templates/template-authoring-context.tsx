'use client';
import { createContext, useContext } from 'react';

/** Route-only presentation context follows included-template links without changing saved data. */
export const TemplateAuthoringContext = createContext('');

/** Preserve a parent's creation mode and its own parent destination through nested authoring. */
export function useTemplateParentContext(): string {
  const context = useContext(TemplateAuthoringContext);
  return context ? `&returnContext=${encodeURIComponent(context)}` : '';
}
