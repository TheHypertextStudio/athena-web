'use client';

import { ChevronLeft, ChevronRight } from '@docket/ui/icons';
import { Button, ControlGroup, Row, Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for {@link AdminPagination}. */
export interface AdminPaginationProps {
  /** Index of the first row on this page, zero-based. */
  readonly offset: number;
  /** How many rows a page holds. */
  readonly pageSize: number;
  /** How many rows are on the current page. */
  readonly pageCount: number;
  /**
   * How many rows match the current filters across every page, when the endpoint reports one.
   *
   * @remarks
   * Optional because not every admin endpoint returns a total — the audit feed does not. Where it
   * is absent the readout says what it can honestly say and a next page is inferred from the
   * current page being full, rather than inventing a count.
   */
  readonly total?: number | undefined;
  /** Move to a new offset. */
  readonly onOffsetChange: (next: number) => void;
  /** What the rows are, for the position readout and the control labels. */
  readonly noun: string;
}

/**
 * Page controls with a position readout.
 *
 * @remarks
 * Every list in this console hard-coded `offset: '0'` while rendering the matched total, so a
 * search that turned up 300 organizations showed "300 organizations total" above the first 50 and
 * offered no way to reach the rest. The API has always accepted `limit`/`offset`; only the controls
 * were missing.
 *
 * @param props - See {@link AdminPaginationProps}.
 * @returns the pager, or `null` when there is only one page.
 */
export function AdminPagination({
  offset,
  pageSize,
  pageCount,
  total,
  onOffsetChange,
  noun,
}: AdminPaginationProps): JSX.Element | null {
  const hasPrevious = offset > 0;
  // With a total, the last page is the one that reaches it. Without, a full page is the only
  // evidence that more rows might exist — and a short page is proof they do not.
  const hasNext = total === undefined ? pageCount === pageSize : offset + pageCount < total;

  if (!hasPrevious && !hasNext) return null;

  const first = offset + 1;
  const last = offset + pageCount;

  return (
    <Row align="center" justify="between" gap={4}>
      <Text as="p" token="body-small" tone="muted">
        {total === undefined
          ? `Showing ${first.toLocaleString()}–${last.toLocaleString()}`
          : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${noun}`}
      </Text>
      <ControlGroup controlSize="sm">
        <Button
          variant="ghost"
          disabled={!hasPrevious}
          aria-label={`Previous page of ${noun}`}
          onClick={() => {
            onOffsetChange(Math.max(0, offset - pageSize));
          }}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          Previous
        </Button>
        <Button
          variant="ghost"
          disabled={!hasNext}
          aria-label={`Next page of ${noun}`}
          onClick={() => {
            onOffsetChange(offset + pageSize);
          }}
        >
          Next
          <ChevronRight aria-hidden="true" className="size-4" />
        </Button>
      </ControlGroup>
    </Row>
  );
}
