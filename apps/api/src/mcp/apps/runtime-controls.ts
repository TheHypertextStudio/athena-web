/**
 * `@docket/api` — the pieces a card uses to report an action and to browse a large set.
 *
 * @remarks
 * `runtime-ui.ts` builds what a resource card is made of. A card reporting a write has a
 * different job — say what happened, where it landed, and offer to take it back — so it gets its
 * own structure: a receipt with a status glyph and a one-line summary, and a footer for the action.
 * The browsing pieces serve a card holding more than fits inline: tonal filter tabs, a search
 * field, and rows whose action filters the card instead of leaving it.
 *
 * Runs after the builders in `runtime-ui.ts` and extends the same `window.docket`.
 */
export const CONTROLS_SCRIPT = String.raw`
(() => {
  const d = window.docket;

  function locales() {
    const locale = d.hostContext.locale;
    return typeof locale === 'string' && locale ? [locale] : [];
  }

  /** A calendar day said the way a person plans against it, and whether it has passed. */
  function when(iso) {
    const due = d.due(iso ? String(iso).slice(0, 10) : '');
    if (!due) return null;
    return { text: due.late ? due.text : due.text.replace(/^due /, ''), late: due.late };
  }

  /** How long ago an instant was: "2 days ago", "yesterday", "just now". */
  function ago(iso) {
    const then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    const seconds = Math.round((then - Date.now()) / 1000);
    const format = new Intl.RelativeTimeFormat(locales(), { numeric: 'auto' });
    const steps = [[60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month']];
    const units = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
    const step = steps.find(([limit]) => Math.abs(seconds) < limit);
    const unit = step ? step[1] : 'year';
    if (unit === 'second') return format.format(0, 'second');
    return format.format(Math.round(seconds / units[unit]), unit);
  }

  /** A person's initials on a tonal disc: the anchor for anything someone wrote. */
  function avatar(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    const initials = words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join('');
    const node = d.el('span', 'avatar', initials || '·');
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  /** A ring filled to done/total: a milestone's progress at the size of a glyph. */
  function progressRing(done, total) {
    const SVG = 'http://www.w3.org/2000/svg';
    const span = d.el('span', total > 0 && done >= total ? 'glyph state-completed' : 'glyph state-started');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const circle = (attributes) => {
      const node = document.createElementNS(SVG, 'circle');
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
      svg.appendChild(node);
    };
    const length = 2 * Math.PI * 6;
    const fraction = total > 0 ? Math.min(done / total, 1) : 0;
    circle({ cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, opacity: 0.25 });
    circle({
      cx: 8, cy: 8, r: 6, fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
      'stroke-dasharray': String(length * fraction) + ' ' + String(length),
      transform: 'rotate(-90 8 8)', 'stroke-linecap': 'round',
    });
    span.appendChild(svg);
    return span;
  }

  /**
   * Tonal filter tabs. options: [{ value, label, count }]; the pressed tab is the current value.
   * Only one tab is pressed at a time, and each says how many rows it holds.
   */
  function tabs(options, current, onSelect, label, segmented) {
    const group = d.el('div', segmented ? 'tabs segmented' : 'tabs');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const option of options) {
      const tab = d.button('', () => onSelect(option.value));
      tab.classList.add('tab');
      tab.setAttribute('aria-pressed', option.value === current ? 'true' : 'false');
      tab.appendChild(document.createTextNode(option.label));
      if (option.count !== undefined) tab.appendChild(d.el('span', 'tab-count', option.count));
      group.appendChild(tab);
    }
    return group;
  }

  /** A search field that filters what the card already holds. */
  function search(label, value, onInput) {
    const box = d.el('label', 'search');
    const icon = d.kindIcon('search');
    if (icon) box.appendChild(icon);
    const input = d.el('input');
    input.type = 'search';
    input.value = value;
    input.setAttribute('aria-label', label);
    input.placeholder = label;
    input.addEventListener('input', () => onInput(input.value));
    box.appendChild(input);
    return box;
  }

  /** A removable chip naming a filter that is on. */
  function filterChip(icon, text, onClear) {
    const chip = d.el('span', 'chip filter');
    const glyph = d.kindIcon(icon);
    if (glyph) chip.appendChild(glyph);
    chip.appendChild(document.createTextNode(text));
    const clear = d.button('', onClear, { label: 'Clear ' + text });
    clear.classList.add('chip-clear');
    const x = d.kindIcon('close');
    if (x) clear.appendChild(x);
    chip.appendChild(clear);
    return chip;
  }

  /**
   * Make a row act inside the card rather than open elsewhere: filter a list, switch a view. The row
   * is the focusable target; hint is the word the pointer sees on hover.
   */
  function actionRow(node, label, hint, onAct) {
    node.dataset.href = '';
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', label);
    const cue = d.button(hint, onAct);
    cue.classList.add('open');
    cue.tabIndex = -1;
    cue.setAttribute('aria-hidden', 'true');
    node.appendChild(cue);
    node.addEventListener('click', (event) => {
      if (!event.target.closest('.open')) onAct();
    });
    node.addEventListener('keydown', (event) => {
      if (event.target === node && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onAct();
      }
    });
    return node;
  }

  const STATUS = {
    done: () => d.stateGlyph('completed'),
    partial: () => toned(d.kindIcon('alert'), 'warning'),
    none: () => toned(d.kindIcon('alert'), ''),
    undone: () => toned(d.kindIcon('undo'), ''),
  };

  function toned(node, tone) {
    if (node && tone) node.classList.add('tone-' + tone);
    return node;
  }

  /**
   * What an action did, in one line, and where it landed. options: { status, summary, place, detail }
   * where status is done | partial | none | undone, place is { kind, title, href }, and detail is text.
   */
  function receipt(options) {
    const node = d.el('div', 'receipt');
    node.setAttribute('role', 'status');
    const glyph = d.el('span', 'receipt-glyph');
    const made = (d.own(STATUS, options.status) || STATUS.done)();
    if (made) glyph.appendChild(made);
    node.appendChild(glyph);
    const text = d.el('div', 'receipt-text');
    text.appendChild(d.el('p', 'receipt-summary', options.summary));
    const detail = d.el('div', 'receipt-detail');
    if (options.place) detail.appendChild(placeChip(options.place));
    if (options.detail) detail.appendChild(d.el('span', '', options.detail));
    if (detail.childNodes.length > 0) text.appendChild(detail);
    node.appendChild(text);
    return node;
  }

  /** Where something landed, as a chip that opens it. */
  function placeChip(place) {
    const chip = d.button('', () => d.link(place.href), { label: 'Open ' + place.title + ' in Docket' });
    chip.classList.add('place');
    const icon = d.kindIcon(place.kind);
    if (icon) chip.appendChild(icon);
    chip.appendChild(document.createTextNode(place.title));
    const out = d.kindIcon('outward');
    if (out) chip.appendChild(out);
    if (!place.href) chip.disabled = true;
    return chip;
  }

  /** The row of actions under what they act on. */
  function footer(actions) {
    const list = actions.filter(Boolean);
    if (list.length === 0) return null;
    const node = d.el('div', 'card-foot');
    for (const action of list) node.appendChild(action);
    return node;
  }

  /**
   * Rendered prose cut near options.lines, with a way to read the rest: fullscreen when the host
   * offers it, otherwise Docket. options: { lines, href, more }
   */
  function clamped(rich, options) {
    const box = d.el('div', 'clamped');
    const foot = d.el('div', 'section-foot');
    foot.hidden = true;
    const more = d.fullscreen ? null : d.overflowAction(options.more || 'Read more', options.href);
    if (more) foot.appendChild(more);
    const clamp = d.fullscreen ? {} : { clampLines: options.lines, onOverflow: () => { foot.hidden = !more; } };
    box.appendChild(d.prose(rich, clamp));
    if (d.fullscreen && rich.truncated && options.href) {
      foot.appendChild(d.button('Open in Docket', () => d.link(options.href)));
      foot.hidden = false;
    }
    box.appendChild(foot);
    return box;
  }

  /** A button with a leading icon. */
  function iconButton(icon, text, onClick, options) {
    const node = d.button(text, onClick, options);
    const glyph = d.kindIcon(icon);
    if (glyph) node.prepend(glyph);
    return node;
  }

  /** An icon-only button, named for a screen reader. */
  function iconOnly(icon, label, onClick) {
    const node = d.button('', onClick, { label });
    node.classList.add('icon-only');
    const glyph = d.kindIcon(icon);
    if (glyph) node.appendChild(glyph);
    return node;
  }

  /**
   * Keep an inline card inside the height its host gave it. A card that outgrows the host's
   * maxHeight would be cut off mid-row with no way to see the rest, and an inline card must not
   * scroll. So it is cut to the host's height with a fade, and a pinned button opens fullscreen,
   * where it has room. Checked after every redraw and every change to the host's context.
   */
  function fit() {
    const card = document.querySelector('.card');
    if (!card) return;
    const dims = d.hostContext.containerDimensions;
    const cap = dims && typeof dims.maxHeight === 'number' && !d.fullscreen ? dims.maxHeight : 0;
    card.classList.remove('clipped');
    card.style.removeProperty('max-height');
    const bar = card.querySelector(':scope > .clip-bar');
    if (bar) bar.remove();
    if (!cap || document.body.scrollHeight <= cap) return;
    card.classList.add('clipped');
    card.style.maxHeight = String(cap) + 'px';
    if (d.canDisplay('fullscreen')) {
      const pinned = d.el('div', 'clip-bar');
      pinned.appendChild(d.iconButton('expand', 'Show everything', () => void d.requestDisplayMode('fullscreen'), { tonal: true }));
      card.appendChild(pinned);
    }
    d.resize();
  }

  // Refit after every redraw, and when the host moves the height it allows without a redraw.
  let pending = 0;
  const refit = () => {
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; fit(); });
  };
  const view = document.getElementById('view');
  if (view && 'MutationObserver' in window) new MutationObserver(refit).observe(view, { childList: true, subtree: true });
  window.addEventListener('message', (event) => {
    if (event.data && event.data.method === 'ui/notifications/host-context-changed') refit();
  });

  Object.assign(d, { when, ago, avatar, progressRing, tabs, search, filterChip, actionRow, receipt, footer, iconButton, iconOnly, clamped, fit });
})();
`;
