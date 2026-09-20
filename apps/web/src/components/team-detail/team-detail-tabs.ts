/** One visible section on the team detail page. */
export interface TeamDetailTab {
  readonly value: 'overview' | 'activity' | 'library' | 'people' | 'settings';
  readonly label: string;
}

/** Return the team tabs the current capability may see. */
export function teamDetailTabs(canManage: boolean): readonly TeamDetailTab[] {
  return [
    { value: 'overview', label: 'Overview' },
    { value: 'activity', label: 'Activity' },
    { value: 'library', label: 'Library' },
    { value: 'people', label: 'People' },
    ...(canManage ? [{ value: 'settings' as const, label: 'Settings' }] : []),
  ];
}
