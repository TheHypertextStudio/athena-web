'use client';
import { useState } from 'react';
import type { ProgramDefaultSchedule } from '@docket/work/work-schedule-defaults';
import type { BlueprintEditorProps } from './work-template-blueprint-child';
import type { WorkTemplateFormState } from './use-work-template-form';
import { ProgramDefaultScheduleOutline } from './program-default-schedule-outline';
import { ProgramDefaultScheduleEditor } from './program-default-schedule-editor';
import { moveDefaultSchedule } from './program-default-schedule-draft';
const NEW_ROUTINE = '$new';

/** Keep recurring-work selection in the same freely revisitable Program outline. */
export function useProgramDefaultScheduleWorkspace(
  form: WorkTemplateFormState,
  context: BlueprintEditorProps,
  onActivate: () => void,
  onReturn: () => void,
) {
  const [key, setKey] = useState<string | null>(null);
  const values = form.definition.defaultSchedules;
  const index = values.findIndex((value) => value.key === key);
  const value = values[index];
  const active = form.kind === 'program' && key !== null;
  const select = (next: string): void => {
    setKey(next);
    onActivate();
    focusRoutine();
  };
  const update = (next: ProgramDefaultSchedule): void => {
    replaceRoutine(form, next);
    setKey(next.key);
    if (key !== next.key) focusRoutine();
  };
  const close = (): void => {
    if (key === NEW_ROUTINE) setKey(null);
    onReturn();
    focusOutlineRow(value?.key ?? null);
  };
  const remove = (): void => {
    removeRoutine(form, key);
    setKey(null);
    onReturn();
    focusOutlineRow(null);
  };
  const move = (direction: -1 | 1): void => {
    if (key)
      form.setDefinition((definition) => ({
        ...definition,
        defaultSchedules: moveDefaultSchedule(definition.defaultSchedules, key, direction),
      }));
  };
  return {
    active,
    clear: () => {
      setKey(null);
    },
    outline:
      form.kind === 'program' ? (
        <ProgramDefaultScheduleOutline
          values={values}
          selectedKey={key}
          disabled={context.disabled}
          onSelect={select}
          onAdd={() => {
            select(NEW_ROUTINE);
          }}
        />
      ) : null,
    editor: active ? (
      <div id="program-routine-editor" className="min-w-0">
        <ProgramDefaultScheduleEditor
          key={key}
          orgId={context.orgId}
          value={value}
          templates={context.templates}
          disabled={context.disabled}
          onChange={update}
          onClose={close}
          onMove={move}
          onRemove={remove}
          canMoveEarlier={index > 0}
          canMoveLater={index >= 0 && index < values.length - 1}
        />
      </div>
    ) : null,
  };
}
function focusOutlineRow(key: string | null): void {
  requestAnimationFrame(() => {
    const row = document.getElementById(key ? `routine-outline-${key}` : 'template-work-root');
    const header = document.querySelector<HTMLElement>('[data-template-definition-header]');
    if (row && header) row.style.scrollMarginTop = `${header.offsetHeight + 24}px`;
    row?.scrollIntoView({ block: 'start' });
    row?.focus({ preventScroll: true });
  });
}

function replaceRoutine(form: WorkTemplateFormState, next: ProgramDefaultSchedule): void {
  form.setDefinition((definition) => ({
    ...definition,
    defaultSchedules: definition.defaultSchedules.some((item) => item.key === next.key)
      ? definition.defaultSchedules.map((item) => (item.key === next.key ? next : item))
      : [...definition.defaultSchedules, next].slice(0, 20),
  }));
}
function removeRoutine(form: WorkTemplateFormState, key: string | null): void {
  form.setDefinition((definition) => ({
    ...definition,
    defaultSchedules: definition.defaultSchedules.filter((item) => item.key !== key),
  }));
}

function focusRoutine(): void {
  requestAnimationFrame(() => {
    const panel = document.getElementById('program-routine-editor');
    const header = document.querySelector<HTMLElement>('[data-template-definition-header]');
    if (panel && header) panel.style.scrollMarginTop = `${header.offsetHeight + 24}px`;
    panel?.scrollIntoView({ block: 'start' });
    panel?.querySelector<HTMLElement>('h3')?.focus({ preventScroll: true });
  });
}
