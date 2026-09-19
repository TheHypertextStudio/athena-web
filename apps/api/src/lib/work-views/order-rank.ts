/**
 * `@docket/api` — the fractional-rank arithmetic a work-view reorder stores.
 *
 * @remarks
 * A work item's position in a context is one short string, ordered lexicographically, so moving an
 * item writes one row rather than renumbering the list. The whole cost of that design is here:
 * finding a string strictly between two others, and admitting when there is no room left so the
 * caller can widen the gap and ask again.
 */

/** The rank alphabet, in ascending lexicographic order. */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * The rank that sorts strictly between two neighbors.
 *
 * @param lower - The rank to sort after, or `null` at the head of the list.
 * @param upper - The rank to sort before, or `null` at the tail.
 * @returns A rank between them.
 * @throws {TypeError} When the neighbors are reversed, or leave no room.
 */
export function betweenRanks(lower: string | null, upper: string | null): string {
  if (lower === null && upper === null) return 'V';
  if (upper === null) return `${lower}V`;
  if (lower === null) return rankBefore(upper);
  if (lower >= upper) throw new TypeError('Order neighbors are reversed.');
  return rankBetween(lower, upper);
}

/**
 * The rank that sorts before the current first one.
 *
 * @param upper - The current first rank.
 * @returns A rank strictly below it.
 * @throws {TypeError} When the first rank is already the alphabet's floor.
 */
function rankBefore(upper: string): string {
  if (upper.length > 1) return upper.slice(0, -1).replace(/\.$/, '');
  const upperIndex = ALPHABET.indexOf(upper);
  if (upperIndex > 0) return ALPHABET[Math.floor(upperIndex / 2)] ?? '0';
  throw new TypeError('The first stored rank has no predecessor.');
}

/**
 * The rank that sorts strictly between two existing ones.
 *
 * @remarks
 * Takes the midpoint of the first differing character where there is room, and otherwise extends
 * the lower rank — first plainly, then with a separator — so two adjacent ranks can still be split
 * without renumbering the list.
 *
 * @param lower - The rank to sort after.
 * @param upper - The rank to sort before, already known to be greater.
 * @returns A rank strictly between them.
 * @throws {TypeError} When the ranks use an unsupported alphabet, or have no room left.
 */
function rankBetween(lower: string, upper: string): string {
  const index = commonPrefixLength(lower, upper);
  const low = index < lower.length ? ALPHABET.indexOf(lower[index] ?? '') : -1;
  const high = index < upper.length ? ALPHABET.indexOf(upper[index] ?? '') : ALPHABET.length;
  if (low < -1 || high < 0) throw new TypeError('Stored ranks use an unsupported alphabet.');
  if (high - low > 1) {
    return `${lower.slice(0, index)}${ALPHABET[Math.floor((low + high) / 2)] ?? 'V'}`;
  }
  return extendLower(lower, upper);
}

/** How many leading characters two ranks share. */
function commonPrefixLength(lower: string, upper: string): number {
  let index = 0;
  while (lower[index] === upper[index] && index < lower.length && index < upper.length) {
    index += 1;
  }
  return index;
}

/**
 * Lengthen the lower rank until it still sorts below the upper one.
 *
 * @param lower - The rank to sort after.
 * @param upper - The rank to sort before.
 * @returns The extended rank.
 * @throws {TypeError} When neither extension fits, so the neighborhood needs rebalancing.
 */
function extendLower(lower: string, upper: string): string {
  const candidate = `${lower}V`;
  if (candidate < upper) return candidate;
  const dotted = `${lower}.V`;
  if (dotted < upper) return dotted;
  throw new TypeError('Stored ranks need bounded rebalancing.');
}
