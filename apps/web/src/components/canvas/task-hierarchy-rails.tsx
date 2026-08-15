/** Visible connective rails for a task hierarchy branch. */

/** Props for {@link TaskHierarchyRails}. */
export interface TaskHierarchyRailsProps {
  /** Vertical center of each direct child, relative to the branch container. */
  childYs: readonly number[];
  /** Width of the parent task card. */
  cardWidth: number;
  /** Height of the parent task card. */
  cardHeight: number;
}

/** Draw curved parent-to-child rails without creating graph edges. */
export function TaskHierarchyRails({
  childYs,
  cardWidth,
  cardHeight,
}: TaskHierarchyRailsProps): React.JSX.Element | null {
  if (childYs.length === 0) return null;
  const originX = Math.min(24, cardWidth / 10);
  const childX = 48;
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      data-testid="task-hierarchy-rails"
    >
      {childYs.map((childY) => (
        <path
          key={childY}
          d={`M ${originX} ${cardHeight} V ${childY - 12} Q ${originX} ${childY} ${childX} ${childY}`}
          fill="none"
          stroke="var(--color-outline-variant)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path
        d={`M ${originX} ${cardHeight - 6} V ${Math.max(cardHeight, childYs.at(-1) ?? cardHeight)}`}
        fill="none"
        stroke="var(--color-outline-variant)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <title>Subtask hierarchy</title>
      <desc>Curved rails connect this task to its direct subtasks.</desc>
    </svg>
  );
}
