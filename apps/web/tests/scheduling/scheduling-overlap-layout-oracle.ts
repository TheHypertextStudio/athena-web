import type { ScheduleOverlapInput, ScheduleOverlapPlacement } from '@/components/scheduling';

interface OracleInterval extends ScheduleOverlapInput {
  readonly effectiveEndMinutes: number;
}

function compareOptionalExact(
  left: number | undefined,
  right: number | undefined,
  direction: 1 | -1,
): number {
  const leftRank = left === undefined ? 2 : Number.isNaN(left) ? 1 : 0;
  const rightRank = right === undefined ? 2 : Number.isNaN(right) ? 1 : 0;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (leftRank !== 0 || left === undefined || right === undefined || left === right) return 0;
  return left < right ? -direction : direction;
}

function compareIntervals(left: OracleInterval, right: OracleInterval): number {
  if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
  const exactStartOrder = compareOptionalExact(left.exactStartMinutes, right.exactStartMinutes, 1);
  if (exactStartOrder !== 0) return exactStartOrder;
  if (left.effectiveEndMinutes !== right.effectiveEndMinutes) {
    return right.effectiveEndMinutes - left.effectiveEndMinutes;
  }
  const exactEndOrder = compareOptionalExact(left.exactEndMinutes, right.exactEndMinutes, -1);
  if (exactEndOrder !== 0) return exactEndOrder;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function conflicts(left: OracleInterval, right: OracleInterval): boolean {
  const visuallyOverlap =
    left.startMinutes < right.effectiveEndMinutes && right.startMinutes < left.effectiveEndMinutes;
  const exactlyOverlap =
    left.exactStartMinutes !== undefined &&
    left.exactEndMinutes !== undefined &&
    right.exactStartMinutes !== undefined &&
    right.exactEndMinutes !== undefined &&
    left.exactStartMinutes < right.exactEndMinutes &&
    right.exactStartMinutes < left.exactEndMinutes;
  return visuallyOverlap || exactlyOverlap;
}

function colorComponent(
  component: readonly number[],
  conflictMatrix: readonly (readonly boolean[])[],
): number[] {
  for (let columnCount = 1; columnCount <= component.length; columnCount += 1) {
    const colors = new Array<number>(component.length).fill(-1);
    const search = (position: number, greatestColor: number): boolean => {
      if (position === component.length) return true;
      const vertex = component[position];
      if (vertex === undefined) return false;
      const unavailable = new Set<number>();
      for (let previous = 0; previous < position; previous += 1) {
        const previousVertex = component[previous];
        if (previousVertex !== undefined && conflictMatrix[vertex]?.[previousVertex]) {
          unavailable.add(colors[previous] ?? -1);
        }
      }
      const greatestCandidate = Math.min(columnCount - 1, greatestColor + 1);
      for (let color = 0; color <= greatestCandidate; color += 1) {
        if (unavailable.has(color)) continue;
        colors[position] = color;
        if (search(position + 1, Math.max(greatestColor, color))) return true;
      }
      colors[position] = -1;
      return false;
    };
    if (search(0, -1)) return colors;
  }
  return component.map((_, index) => index);
}

/** Deliberately quadratic reference used to protect the optimized production layout. */
export function quadraticOverlapLayoutOracle(
  inputs: readonly ScheduleOverlapInput[],
  pixelsPerHour: number,
  minimumInteractivePixels: number,
): ScheduleOverlapPlacement[] {
  if (inputs.length === 0) return [];
  const minimumMinutes = (Math.max(0, minimumInteractivePixels) / Math.max(1, pixelsPerHour)) * 60;
  const sorted: OracleInterval[] = inputs
    .map((input) => ({
      ...input,
      effectiveEndMinutes: Math.max(input.endMinutes, input.startMinutes + minimumMinutes),
    }))
    .sort(compareIntervals);
  const conflictMatrix = sorted.map((left, leftIndex) =>
    sorted.map((right, rightIndex) => leftIndex !== rightIndex && conflicts(left, right)),
  );
  const placements = new Map<number, ScheduleOverlapPlacement>();
  const visited = new Set<number>();

  for (let startIndex = 0; startIndex < sorted.length; startIndex += 1) {
    if (visited.has(startIndex)) continue;
    const component: number[] = [];
    const pending = [startIndex];
    visited.add(startIndex);
    for (const index of pending) {
      component.push(index);
      for (let candidate = 0; candidate < sorted.length; candidate += 1) {
        if (!visited.has(candidate) && conflictMatrix[index]?.[candidate]) {
          visited.add(candidate);
          pending.push(candidate);
        }
      }
    }

    component.sort((left, right) => left - right);
    const colors = colorComponent(component, conflictMatrix);
    const columnCount = Math.max(0, ...colors) + 1;
    for (let position = 0; position < component.length; position += 1) {
      const index = component[position];
      if (index === undefined) continue;
      const item = sorted[index];
      if (!item) continue;
      placements.set(index, {
        id: item.id,
        columnIndex: colors[position] ?? 0,
        columnCount,
      });
    }
  }

  return sorted.flatMap((_, index) => {
    const placement = placements.get(index);
    return placement ? [placement] : [];
  });
}
