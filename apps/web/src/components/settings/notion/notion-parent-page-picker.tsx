'use client';

/**
 * `settings/notion` — choose the Notion page Docket builds its databases under.
 *
 * @remarks
 * This replaces a native `<select>` listing every page the integration could see: flat, unsorted,
 * unsearchable, and rendered by the OS on top of the settings dialog it belonged to. In a
 * workspace of any age that control was unusable — hundreds of options, several of them sharing a
 * name, with no way to tell which "Projects" was which.
 *
 * Three things make it usable now, and each is load-bearing:
 *
 * - **The search runs at Notion**, not in the browser, so the list is bounded by what a person
 *   reads rather than by what a workspace contains.
 * - **Each row carries what distinguishes it** — the page's emoji, whether it sits at the top
 *   level, and when it was last edited. Resolving each result's parent *title* would be an extra
 *   request per row per keystroke; the edit time does the same job for free.
 * - **Nothing is preselected.** The old card defaulted to whichever page sorted first, so pressing
 *   Create without opening the dropdown built nine databases somewhere nobody chose.
 *
 * Presentational: the search term, the results and the fetch all live in the setup card, which is
 * the one component that needs to know whether this connection can see any pages at all.
 */
import type { NotionParentPageOut } from '@docket/connections/notion/mirror-contract';
import { OptionPicker } from '@docket/ui/components';
import { FileText } from '@docket/ui/icons';
import type { JSX } from 'react';

import {
  PAGE_PICKER_EMPTY,
  PAGE_PICKER_IDLE,
  PAGE_PICKER_PLACEHOLDER,
  PAGE_PICKER_SEARCH,
  pagePlacement,
} from './notion-copy';
import { relativeTimeLabel } from './use-notion-mirror-controller';

/** Props for {@link NotionParentPagePicker}. */
export interface NotionParentPagePickerProps {
  /** The current result wave, already narrowed by Notion. */
  pages: readonly NotionParentPageOut[];
  /** The chosen page, or null while nothing has been chosen. */
  value: NotionParentPageOut | null;
  /** Report the chosen page. */
  onChange: (page: NotionParentPageOut) => void;
  /** The live search term. */
  query: string;
  /** Report typing. */
  onQueryChange: (query: string) => void;
  /** True while results for the current term are still expected. */
  loading: boolean;
  /** Report the popover opening and closing, so the caller can stop searching for a shut list. */
  onOpenChange: (open: boolean) => void;
  /** Disable the trigger while the provision run is in flight. */
  disabled?: boolean;
}

/** Search the workspace's pages and pick one. */
export function NotionParentPagePicker({
  pages,
  value,
  onChange,
  query,
  onQueryChange,
  loading,
  onOpenChange,
  disabled = false,
}: NotionParentPagePickerProps): JSX.Element {
  // The selected page is pinned into the option set. Once the query moves on it is no longer in
  // the result wave, and an OptionPicker whose value matches no option renders an empty trigger —
  // so the choice would appear to un-make itself the moment somebody typed again.
  const shown =
    value !== null && !pages.some((page) => page.id === value.id) ? [value, ...pages] : pages;

  const options = shown.map((page) => {
    const edited = relativeTimeLabel(page.lastEditedTime);
    return {
      value: page.id,
      label: page.title,
      icon:
        page.icon !== null ? (
          <span aria-hidden="true">{page.icon}</span>
        ) : (
          <FileText aria-hidden="true" className="size-4 opacity-70" />
        ),
      supporting: pagePlacement(page.parentKind),
      ...(edited !== null ? { hint: edited } : {}),
    };
  });

  return (
    <OptionPicker
      options={options}
      value={value?.id ?? null}
      onChange={(next) => {
        const chosen = shown.find((page) => page.id === next);
        if (chosen) onChange(chosen);
      }}
      placeholder={PAGE_PICKER_PLACEHOLDER}
      searchPlaceholder={PAGE_PICKER_SEARCH}
      query={query}
      onQueryChange={onQueryChange}
      filter="none"
      loading={loading}
      onOpenChange={onOpenChange}
      idleText={PAGE_PICKER_IDLE}
      emptyText={PAGE_PICKER_EMPTY}
      ariaLabel="Notion page"
      triggerVariant="outline"
      disabled={disabled}
    />
  );
}
