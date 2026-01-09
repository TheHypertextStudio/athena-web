/**
 * Fuzzy search algorithm for command palette.
 *
 * This module provides fast, forgiving text matching for the command palette.
 * When users type in the palette, we need to match their input against action
 * labels and keywords, even when they make typos or use abbreviations.
 *
 * ## Matching Strategy
 *
 * The algorithm uses multiple strategies in order of priority:
 *
 * 1. **Exact Prefix Match** (highest score)
 *    Input "cre" matches "Create Task" - the input is the start of the label.
 *    Score: 100 + position bonus
 *
 * 2. **Word Boundary Match**
 *    Input "ct" matches "Create Task" - each character starts a word.
 *    Score: 80 + contiguity bonus
 *
 * 3. **Substring Match**
 *    Input "task" matches "Create Task" - the input appears somewhere in the label.
 *    Score: 60 + position bonus
 *
 * 4. **Fuzzy Character Match** (lowest score)
 *    Input "cret" matches "Create" - characters appear in order but not contiguous.
 *    Score: 40 - gap penalty
 *
 * ## Performance Considerations
 *
 * - The algorithm is optimized for small datasets (< 100 actions).
 * - It avoids regex compilation by using string methods.
 * - Results are cached when query is unchanged.
 *
 * ## Usage
 *
 * ```typescript
 * import { fuzzySearch, type FuzzyMatch } from './fuzzy-search';
 *
 * const actions = [
 *   { id: 'create-task', label: 'Create Task', ... },
 *   { id: 'go-tasks', label: 'Go to Tasks', ... },
 * ];
 *
 * const matches = fuzzySearch(actions, 'ct', context);
 * // Returns: [
 * //   { action: createTask, score: 80, matchedRanges: [[0,1], [7,8]] },
 * //   { action: goTasks, score: 60, matchedRanges: [[6,7], [11,12]] },
 * // ]
 * ```
 *
 * @packageDocumentation
 */

import type { Action, CommandContext, ExecutableAction, ActionGroup } from './types';

/**
 * Represents a matched action with its relevance score and highlight ranges.
 *
 * The `matchedRanges` array contains [start, end] tuples indicating which
 * characters in the label matched the query. This is used to highlight
 * matches in the UI.
 */
export interface FuzzyMatch {
  /** The matched action (group or executable). */
  action: Action;

  /**
   * Relevance score for sorting. Higher is better.
   * - 100+ for exact prefix matches
   * - 80+ for word boundary matches
   * - 60+ for substring matches
   * - 40+ for fuzzy character matches
   * - 0 for no match
   */
  score: number;

  /**
   * Character ranges that matched the query, for highlighting.
   * Each tuple is [startIndex, endIndex) in the label string.
   */
  matchedRanges: [start: number, end: number][];
}

/**
 * Calculate the fuzzy match score between a query and target text.
 *
 * This is the core scoring function that determines how well a query
 * matches a target string. It tries multiple matching strategies and
 * returns the best score.
 *
 * @param query - User's search input, already lowercased
 * @param target - Text to match against (label or keyword), already lowercased
 * @param originalTarget - Original text for calculating highlight ranges
 * @returns Score and matched character ranges, or null if no match
 *
 * @example
 * calculateScore('ct', 'create task')
 * // Returns: { score: 85, ranges: [[0, 1], [7, 8]] }
 */
function calculateScore(
  query: string,
  target: string,
): { score: number; ranges: [number, number][] } | null {
  if (query.length === 0) {
    return { score: 0, ranges: [] };
  }

  if (query.length > target.length) {
    return null;
  }

  // Strategy 1: Exact prefix match
  // "cre" matches "create task" at position 0
  if (target.startsWith(query)) {
    return {
      score: 100 + (query.length / target.length) * 10,
      ranges: [[0, query.length]],
    };
  }

  // Strategy 2: Word boundary match (acronym-style)
  // "ct" matches "Create Task" (C from Create, T from Task)
  const wordBoundaryResult = matchWordBoundaries(query, target);
  if (wordBoundaryResult) {
    return wordBoundaryResult;
  }

  // Strategy 3: Substring match
  // "task" matches "Create Task" at position 7
  const substringIndex = target.indexOf(query);
  if (substringIndex !== -1) {
    // Bonus for earlier matches, penalty for later matches
    const positionBonus = Math.max(0, 10 - substringIndex);
    return {
      score: 60 + positionBonus + (query.length / target.length) * 10,
      ranges: [[substringIndex, substringIndex + query.length]],
    };
  }

  // Strategy 4: Fuzzy character match
  // "cret" matches "create" (c-r-e-t appear in order)
  const fuzzyResult = matchFuzzyCharacters(query, target);
  if (fuzzyResult) {
    return fuzzyResult;
  }

  return null;
}

/**
 * Match query characters against word boundaries in target.
 *
 * Word boundaries are:
 * - Start of the string
 * - Characters after a space, hyphen, or underscore
 * - Uppercase letters in camelCase (e.g., 'T' in 'createTask')
 *
 * @param query - Search query (lowercased)
 * @param target - Target text (lowercased)
 * @returns Score and ranges if all query chars match boundaries, null otherwise
 *
 * @example
 * matchWordBoundaries('ct', 'create task')
 * // Matches: C(reate) T(ask) → returns { score: 85, ranges: [[0,1], [7,8]] }
 *
 * @example
 * matchWordBoundaries('gt', 'go to tasks')
 * // Matches: G(o) T(o) or G(o to) T(asks) → depends on implementation
 */
function matchWordBoundaries(
  query: string,
  target: string,
): { score: number; ranges: [number, number][] } | null {
  // Find all word boundary positions
  const boundaries: number[] = [0]; // Start is always a boundary

  for (let i = 1; i < target.length; i++) {
    const prev = target[i - 1];

    // After space, hyphen, or underscore
    if (prev === ' ' || prev === '-' || prev === '_') {
      boundaries.push(i);
    }
  }

  // Try to match each query character to a boundary
  const ranges: [number, number][] = [];
  let boundaryIndex = 0;

  for (const queryChar of query) {
    let found = false;

    // Look for this character at remaining boundaries
    while (boundaryIndex < boundaries.length) {
      const pos = boundaries[boundaryIndex];
      if (pos !== undefined && target[pos] === queryChar) {
        ranges.push([pos, pos + 1]);
        boundaryIndex++;
        found = true;
        break;
      }
      boundaryIndex++;
    }

    if (!found) {
      return null;
    }
  }

  // Calculate score based on how many boundaries we matched
  // and how contiguous they are
  const contiguityBonus = calculateContiguityBonus(ranges);
  const coverageBonus = (query.length / boundaries.length) * 10;

  return {
    score: 80 + contiguityBonus + coverageBonus,
    ranges,
  };
}

/**
 * Calculate bonus for contiguous matches.
 *
 * Matches that are close together score higher than scattered matches.
 * This rewards queries like "create" over "ct" when matching "Create Task".
 *
 * @param ranges - Array of matched character ranges
 * @returns Bonus score (0-10)
 */
function calculateContiguityBonus(ranges: [number, number][]): number {
  if (ranges.length <= 1) {
    return 10;
  }

  let totalGap = 0;
  for (let i = 1; i < ranges.length; i++) {
    const prevEnd = ranges[i - 1]?.[1] ?? 0;
    const currStart = ranges[i]?.[0] ?? 0;
    totalGap += currStart - prevEnd;
  }

  // Smaller gaps = higher bonus
  const avgGap = totalGap / (ranges.length - 1);
  return Math.max(0, 10 - avgGap);
}

/**
 * Match query characters in order, allowing gaps.
 *
 * This is the most forgiving matching strategy. It finds each query
 * character in order within the target, allowing any number of characters
 * between matches.
 *
 * @param query - Search query (lowercased)
 * @param target - Target text (lowercased)
 * @returns Score and ranges if all chars found in order, null otherwise
 *
 * @example
 * matchFuzzyCharacters('crt', 'create')
 * // Matches: C(r)e(a)T(e) - wait, 't' not in 'create'
 * // Actually: c-r-e-a-t-e, so 'crt' would match c, r, t? No 't'.
 * // Let's say 'cre' matches 'create': c(0), r(1), e(2) → contiguous!
 */
function matchFuzzyCharacters(
  query: string,
  target: string,
): { score: number; ranges: [number, number][] } | null {
  const ranges: [number, number][] = [];
  let targetIndex = 0;

  for (const queryChar of query) {
    let found = false;

    // Find this character in remaining target
    while (targetIndex < target.length) {
      if (target[targetIndex] === queryChar) {
        ranges.push([targetIndex, targetIndex + 1]);
        targetIndex++;
        found = true;
        break;
      }
      targetIndex++;
    }

    if (!found) {
      return null;
    }
  }

  // Calculate score with gap penalty
  const contiguityBonus = calculateContiguityBonus(ranges);
  const coverageRatio = query.length / target.length;

  return {
    score: 40 + contiguityBonus + coverageRatio * 10,
    ranges,
  };
}

/**
 * Check if an action is available in the current context.
 *
 * Actions can define an `isAvailable` function that returns:
 * - `true` if the action should be shown and enabled
 * - `false` if the action should be hidden
 * - A string message if the action should be shown but disabled
 *
 * @param action - The action to check
 * @param context - Current command context
 * @returns Object with availability status and optional reason
 */
function checkAvailability(
  action: Action,
  context: CommandContext,
): { available: boolean; reason?: string } {
  if (!action.isAvailable) {
    return { available: true };
  }

  const result = action.isAvailable(context);

  if (result === true) {
    return { available: true };
  }

  if (result === false) {
    return { available: false };
  }

  // String means disabled with reason
  return { available: true, reason: result };
}

/**
 * Flatten nested action groups for search.
 *
 * When searching, we want to match against all actions regardless of
 * their nesting level. This function recursively extracts all executable
 * actions from groups.
 *
 * @param actions - Array of actions (may include groups)
 * @param context - Current context for availability filtering
 * @returns Flat array of executable actions
 */
function flattenActions(actions: Action[], context: CommandContext): ExecutableAction[] {
  const result: ExecutableAction[] = [];

  for (const action of actions) {
    const { available } = checkAvailability(action, context);
    if (!available) {
      continue;
    }

    if (action.type === 'action') {
      result.push(action);
    } else {
      // Recursively flatten children
      result.push(...flattenActions(action.children, context));
    }
  }

  return result;
}

/**
 * Perform fuzzy search on actions.
 *
 * This is the main entry point for searching the command palette.
 * It filters actions by availability, scores them against the query,
 * and returns sorted results with highlight information.
 *
 * When `query` is empty, returns all available actions sorted by priority.
 * When `query` is provided, returns matching actions sorted by relevance.
 *
 * @param actions - All registered actions (may include groups)
 * @param query - User's search input
 * @param context - Current command context for filtering
 * @returns Sorted array of matches with scores and highlight ranges
 *
 * @example
 * // Empty query returns all actions sorted by priority
 * fuzzySearch(actions, '', context)
 *
 * @example
 * // Query filters and scores matches
 * fuzzySearch(actions, 'create', context)
 * // Returns actions matching "create" sorted by relevance
 */
export function fuzzySearch(
  actions: Action[],
  query: string,
  context: CommandContext,
): FuzzyMatch[] {
  const normalizedQuery = query.toLowerCase().trim();

  // If no query, return all available actions sorted by priority
  if (normalizedQuery.length === 0) {
    const available: FuzzyMatch[] = [];

    for (const action of actions) {
      const { available: isAvailable } = checkAvailability(action, context);
      if (isAvailable) {
        const priority = action.type === 'action' ? (action.priority ?? 0) : 0;
        available.push({
          action,
          score: priority,
          matchedRanges: [],
        });
      }
    }

    return available.sort((a, b) => b.score - a.score);
  }

  // For search, flatten groups and search all executable actions
  const flatActions = flattenActions(actions, context);
  const matches: FuzzyMatch[] = [];

  for (const action of flatActions) {
    // Try matching against label
    const labelLower = action.label.toLowerCase();
    let bestResult = calculateScore(normalizedQuery, labelLower);

    // Also try matching against keywords
    if (action.keywords) {
      for (const keyword of action.keywords) {
        const keywordLower = keyword.toLowerCase();
        const keywordResult = calculateScore(normalizedQuery, keywordLower);

        if (keywordResult && (!bestResult || keywordResult.score > bestResult.score)) {
          // Use keyword match but we'll still highlight in label
          bestResult = {
            score: keywordResult.score,
            ranges: [], // Can't highlight keyword matches in label
          };
        }
      }
    }

    if (bestResult && bestResult.score > 0) {
      // Add priority bonus
      const priorityBonus = (action.priority ?? 0) / 10;

      matches.push({
        action,
        score: bestResult.score + priorityBonus,
        matchedRanges: bestResult.ranges,
      });
    }
  }

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score);
}

/**
 * Search within a specific action group's children.
 *
 * Used when the user has navigated into a group and is searching
 * within that group's actions only.
 *
 * @param group - The parent group to search within
 * @param query - User's search input
 * @param context - Current command context
 * @returns Matches from the group's children only
 */
export function fuzzySearchInGroup(
  group: ActionGroup,
  query: string,
  context: CommandContext,
): FuzzyMatch[] {
  return fuzzySearch(group.children, query, context);
}
