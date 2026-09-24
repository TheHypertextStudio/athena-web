/** Width at which a calendar can first give two date lanes useful room. */
const MULTI_DAY_CANVAS_WIDTH = 600;
/** The seven-day desktop target begins once the canvas has this much room. */
const WEEK_CANVAS_WIDTH = 1200;
const FOLDABLE_LANE_WIDTH = 260;
const DESKTOP_LANE_WIDTH = 144;

/** Choose a readable date-lane floor from the calendar's measured canvas width. */
export function calendarMinimumLaneWidth(canvasWidth: number): number {
  if (canvasWidth < MULTI_DAY_CANVAS_WIDTH) return Math.max(1, canvasWidth);
  if (canvasWidth >= WEEK_CANVAS_WIDTH) return DESKTOP_LANE_WIDTH;

  const progress =
    (canvasWidth - MULTI_DAY_CANVAS_WIDTH) / (WEEK_CANVAS_WIDTH - MULTI_DAY_CANVAS_WIDTH);
  return Math.round(FOLDABLE_LANE_WIDTH + progress * (DESKTOP_LANE_WIDTH - FOLDABLE_LANE_WIDTH));
}
