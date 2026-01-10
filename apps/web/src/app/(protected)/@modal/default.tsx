/**
 * Default modal slot - renders nothing when no modal is active.
 *
 * This is required for the parallel routes pattern to work correctly.
 * When no intercepted route matches, this default is rendered.
 */
export default function DefaultModal() {
  return null;
}
