/**
 * `@docket/ui` — `Input` compatibility re-export.
 *
 * @remarks
 * The input primitive now lives in `./field` alongside {@link Textarea}, {@link Select}, and the
 * shared {@link fieldSurface} recipe they all render from — because "the input primitive" was
 * never really about `<input>`, it was about every field in the product looking like one system.
 * Splitting them across files is how the textarea and the select drifted in the first place.
 *
 * This module stays so the existing `@docket/ui/primitives/input` import path keeps resolving. New
 * code should import from `@docket/ui/primitives` (the barrel) or `./field` directly.
 */
export { Input, type InputProps } from './field';
