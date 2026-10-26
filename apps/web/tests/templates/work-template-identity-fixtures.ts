import { WorkTemplateChildChange } from '@docket/work/work-template-reference';

/** Pinned event identity exposed to both readers and editors. */
export const event = {
  id: 'event',
  name: 'Event',
  icon: null,
  isBase: false,
  archived: false,
  versionNumber: 1,
  latestVersionNumber: 2,
};
/** A different live publication selected by the change-preview journey. */
export const choice = {
  ...event,
  id: 'meeting',
  name: 'Meeting',
  versionId: 'meeting-v2',
  versionNumber: 2,
};
/** Resource and performer context shared by the identity behavior cases. */
export const props = {
  orgId: 'org',
  kind: 'project' as const,
  workId: 'project',
  teamId: null,
  workTypeId: 'event',
  workTypeVersionId: 'event-v1',
};

/** Build one selected or optional child in a template-change review fixture. */
export function addition(
  key: string,
  selected: boolean,
  changeId: string,
): WorkTemplateChildChange {
  return WorkTemplateChildChange.parse({
    changeId,
    kind: 'add_child',
    path: [key],
    count: 1,
    selectedByDefault: selected,
    children: [
      {
        path: [key],
        parentPath: [],
        kind: 'task',
        title: key,
        workTypeId: null,
        workTypeVersionId: null,
        dates: {},
        unresolvedReasons: {},
        optional: !selected,
        selectedByDefault: selected,
        selected,
        prerequisites: [],
      },
    ],
  });
}
