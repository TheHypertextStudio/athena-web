'use client';
import { createContext, useContext, useState, type Dispatch, type SetStateAction } from 'react';

type EditorSelection = Map<string, string | null>;
const pendingSelections = new Map<string, EditorSelection>();
/** Only transient editor selections cross the first-save route change. */
export const TemplateEditorSelectionContext = createContext<EditorSelection | null>(null);

/** Restore child/routine editor selection without persisting presentation in the definition. */
export function takeTemplateEditorSelection(key?: string): EditorSelection {
  const selected = key ? pendingSelections.get(key) : undefined;
  return selected ?? new Map<string, string | null>();
}

/** Transfer the selected editor before replacing the new-template route with its saved identity. */
export function retainTemplateEditorSelection(key: string, selected: EditorSelection): void {
  pendingSelections.set(key, new Map(selected));
}

/** Keep one local editor selection while allowing a first-save route handoff. */
export function useTemplateEditorSelection(
  name: string,
): [string | null, Dispatch<SetStateAction<string | null>>] {
  const selections = useContext(TemplateEditorSelectionContext);
  const [value, setValue] = useState<string | null>(() => selections?.get(name) ?? null);
  const select: Dispatch<SetStateAction<string | null>> = (next) => {
    const resolved = typeof next === 'function' ? next(value) : next;
    selections?.set(name, resolved);
    setValue(resolved);
  };
  return [value, select];
}

/** Consume a completed handoff after React mounts the saved route, including strict mode probes. */
export function clearTemplateEditorSelection(key: string): void {
  pendingSelections.delete(key);
}
