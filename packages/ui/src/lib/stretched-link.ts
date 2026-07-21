/**
 * `@docket/ui` — the shared "stretched link" class recipe.
 *
 * @remarks
 * A card-shaped surface often wants its *entire* body to be one navigation
 * target while still hosting smaller independently-clickable controls (buttons,
 * pickers, menus, secondary links). The stretched-link pattern achieves this
 * without nesting interactive elements: a single real `<a>` grows an empty
 * `::after` pseudo-element that is absolutely positioned to cover the nearest
 * positioned ancestor, turning the whole card into the anchor's hit area.
 */

/**
 * Class string that stretches an anchor's `::after` pseudo-element to fill its
 * positioned ancestor, making the whole card the anchor's click target.
 *
 * @remarks
 * The recipe has three cooperating parts — all three are required:
 *
 * 1. **Card container** gets `relative` so it becomes the positioned ancestor
 *    the overlay resolves against.
 * 2. **Primary navigation anchor** gets this class and MUST stay statically
 *    positioned (no `relative`/`absolute` of its own), so its `::after`
 *    resolves to the card rather than to the anchor itself.
 * 3. **Every inner interactive control** (buttons, pickers, other links, menus)
 *    gets `relative z-10` so it sits above the overlay and stays independently
 *    clickable.
 *
 * @example
 * ```tsx
 * <article className="relative ...">
 *   <a href={href} className={cn('font-medium', STRETCHED_LINK)}>{title}</a>
 *   <button className="relative z-10" onClick={onArchive}>Archive</button>
 * </article>
 * ```
 */
export const STRETCHED_LINK = "after:absolute after:inset-0 after:content-['']";
