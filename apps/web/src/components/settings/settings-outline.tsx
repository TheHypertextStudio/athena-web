/**
 * `settings` — the DOM contract that lets a settings section describe its own sub-navigation.
 *
 * @remarks
 * The rail listed twenty-three sections and stopped. Inside one of them a reader faced anything up
 * to six groups with no map, so finding "Recovery codes" or "Calendar sharing" meant opening
 * Security or Calendar and scrolling until it appeared. The rail knew the sections; nothing knew
 * the sections' contents.
 *
 * The outline itself is read from the rendered section by `useOutlineEntries` in `@docket/ui/hooks`
 * — a group added, renamed, reordered, or conditionally hidden changes the sub-nav in the same
 * edit, because the sub-nav *is* the headings. What stays here is only what this surface owns: the
 * attribute {@link SettingsGroup} stamps, and the id it gives a heading.
 */

/** Marks a heading as one the outline should list. Set by {@link SettingsGroup}. */
export const SETTINGS_GROUP_ATTR = 'data-settings-group';

/**
 * A stable element id for a group heading.
 *
 * @remarks
 * Derived from the title so it survives a re-render and a remount — an index would renumber the
 * moment a conditional group appears above, silently moving every anchor below it.
 *
 * @param title - The group's title.
 * @returns a slug suitable for an element id.
 */
export function settingsGroupId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `settings-group-${slug}`;
}
