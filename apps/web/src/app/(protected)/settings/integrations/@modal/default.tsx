/**
 * Default modal slot.
 *
 * Returns null when no modal is active (e.g., on the main list page).
 * This is required for parallel routes to work correctly.
 */
export default function Default() {
  return null;
}
