/**
 * `@docket/api` — the builders every Docket card draws its structure with.
 *
 * @remarks
 * Every card is made of the same five pieces — a header, sections, rows, chips, and prose — and
 * the classes in `runtime-css.ts` style exactly those. A widget that hand-built its own DOM is how
 * each card ended up as text stacked on text, so the pieces are built here, once, and widgets only
 * say what goes in them.
 *
 * Runs after `RUNTIME_JS` and extends `window.docket`. Nothing here uses `innerHTML` on anything a
 * payload supplied: text goes in through text nodes, and the only markup parsed is the static icon
 * and glyph paths defined in this file and `icons.ts`.
 */
import { KIND_ICON_PATHS } from './icons';
import { RENDER_META_KEY } from './rich-text';
import { CONTROLS_SCRIPT } from './runtime-controls';

const UI_SCRIPT = String.raw`
  const d = window.docket;
  const SVG = 'http://www.w3.org/2000/svg';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null && text !== '') node.textContent = String(text);
    return node;
  }

  function svg(children) {
    const root = document.createElementNS(SVG, 'svg');
    root.setAttribute('viewBox', '0 0 24 24');
    root.setAttribute('aria-hidden', 'true');
    for (const child of children) root.appendChild(child);
    return root;
  }

  function shape(tag, attributes) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }

  /** The kind's icon, or null for a kind with none. */
  function kindIcon(kind) {
    const path = d.own(ICONS, kind);
    if (!path) return null;
    const span = el('span', 'icon');
    span.appendChild(svg([shape('path', { d: path, fill: 'currentColor' })]));
    return span;
  }

  /** Three bars, filled to the priority's level, the way the app draws priority. */
  function priorityGlyph(priority) {
    const level = d.own({ urgent: 3, high: 3, medium: 2, low: 1 }, priority) || 0;
    const span = el('span', priority === 'urgent' ? 'icon tone-danger' : 'icon');
    const bars = [0, 1, 2].map((index) =>
      shape('rect', {
        x: 4 + index * 6, y: 16 - index * 5, width: 4, height: 4 + index * 5, rx: 1,
        fill: 'currentColor', opacity: index < level ? 1 : 0.25,
      }));
    span.appendChild(svg(bars));
    return span;
  }

  /** A checklist tick: a filled check when done, an open ring when not. */
  function checkGlyph(checked) {
    return d.stateGlyph(checked ? 'completed' : 'unstarted');
  }

  const HEALTH_TONE = { on_track: 'success', at_risk: 'warning', off_track: 'danger' };

  function healthTone(health) {
    return d.own(HEALTH_TONE, health) || '';
  }

  /** A tonal chip; a tone adds its colour and a leading dot. */
  function chip(text, tone) {
    const value = text === null || text === undefined ? '' : String(text);
    if (!value) return null;
    const node = el('span', 'chip');
    if (tone) {
      node.dataset.tone = tone;
      node.appendChild(el('span', 'dot'));
    }
    node.appendChild(document.createTextNode(value));
    return node;
  }

  function chipRow(list) {
    const row = el('div', 'chips');
    for (const item of list || []) {
      if (!item) continue;
      const node = item.nodeType ? item : chip(item);
      if (node) row.appendChild(node);
    }
    return row.childElementCount > 0 ? row : null;
  }

  /** A health chip, coloured by the host's own success, warning, and danger. */
  function healthChip(health) {
    return health ? chip(d.label(health), healthTone(health)) : null;
  }

  /**
   * The card's header: kind and icon, title, qualifying chips, a one-line lede, and actions.
   * options: { kind, kicker, title, chips, lede, actions }
   */
  function header(options) {
    const head = el('header', 'head');
    const icon = kindIcon(options.kind);
    const title = el('h1', 'title', options.title);
    title.setAttribute('aria-live', 'polite');
    // The kind leads the kicker when there is one; with no kicker it leads the title instead.
    if (options.kicker) {
      const kicker = el('div', 'kicker');
      if (icon) kicker.appendChild(icon);
      kicker.appendChild(document.createTextNode(options.kicker));
      head.appendChild(kicker);
    } else if (icon) {
      title.prepend(icon);
    }
    head.appendChild(title);
    const actions = (options.actions || []).filter(Boolean);
    if (actions.length > 0) {
      const box = el('div', 'head-actions');
      for (const action of actions) box.appendChild(action);
      head.appendChild(box);
    }
    const chips = chipRow(options.chips);
    if (chips) head.appendChild(chips);
    if (options.lede) head.appendChild(el('p', 'lede', options.lede));
    return head;
  }

  /** A text button, or a filled tonal one for the card's primary action. */
  function button(text, onClick, options) {
    const node = el('button', options && options.tonal ? 'tonal' : '', text);
    node.type = 'button';
    if (options && options.label) node.setAttribute('aria-label', options.label);
    node.addEventListener('click', onClick);
    return node;
  }

  /**
   * Make a row the link to what it names. The row is the focusable target, for keyboard, touch, and
   * screen reader alike; the Open button it carries is only the pointer's hover hint.
   */
  function linkRow(node, title, href) {
    node.dataset.href = href;
    node.tabIndex = 0;
    node.setAttribute('role', 'link');
    node.setAttribute('aria-label', 'Open ' + (title || 'this') + ' in Docket');
    const hint = button('Open', () => d.link(href));
    hint.classList.add('open');
    hint.tabIndex = -1;
    hint.setAttribute('aria-hidden', 'true');
    node.appendChild(hint);
    node.addEventListener('click', (event) => {
      if (event.target.closest('select, input, a, .tick')) return;
      if (!event.target.closest('.open')) d.link(href);
    });
    node.addEventListener('keydown', (event) => {
      if (event.target === node && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        d.link(href);
      }
    });
  }

  /**
   * A tonal container with a label, a count, and an optional action. Returns { node, body }.
   * options: { label, count, action }
   */
  function section(options) {
    const node = el('section', 'section');
    // A section that is only a container for prose (an update's body) has no head at all.
    if (options.label || options.action) node.appendChild(sectionHead(options));
    const body = el('div', 'section-body');
    node.appendChild(body);
    return { node, body };
  }

  function sectionHead(options) {
    const head = el('div', 'section-head');
    const label = el('h2', 'section-label', options.label);
    if (options.count !== undefined && options.count !== null && options.count !== '') {
      label.appendChild(el('span', 'section-count', options.count));
    }
    head.appendChild(label);
    if (options.action) head.appendChild(options.action);
    return head;
  }

  /** A fact is a string, or { text, tone } where tone colours it, or { text, late }. */
  function factClass(fact) {
    if (fact.tone) return 'tone-' + fact.tone;
    return fact.late ? 'late' : '';
  }

  function metaLine(meta) {
    const facts = (meta || [])
      .map((fact) => (typeof fact === 'string' ? { text: fact } : fact))
      .filter((fact) => fact && fact.text);
    if (facts.length === 0) return null;
    const line = el('div', 'row-meta');
    facts.forEach((fact, index) => {
      if (index > 0) line.appendChild(el('span', 'sep', '·'));
      line.appendChild(el('span', factClass(fact), fact.text));
    });
    return line;
  }

  /**
   * One row. options: { anchor, title, meta, note, trailing, href, depth, dim, done, extra }
   * anchor is a node (glyph or icon); trailing is text or a node; extra is appended under the meta.
   */
  function row(options) {
    const node = el('div', 'row');
    if (options.dim) node.classList.add('dim');
    if (options.done) node.classList.add('done');
    if (options.depth) node.style.paddingLeft = String(8 + Math.min(options.depth, 3) * 28) + 'px';
    const anchor = el('span', 'row-anchor');
    if (options.anchor) anchor.appendChild(options.anchor);
    node.appendChild(anchor);
    const title = el('div', 'row-title', options.title || d.untitled(options.kind));
    title.title = options.title || '';
    node.appendChild(title);
    const meta = metaLine(options.meta);
    if (meta) node.appendChild(meta);
    if (options.note) node.appendChild(el('div', 'row-note', options.note));
    if (options.extra) node.appendChild(options.extra);
    const trailing = el('span', 'row-trailing');
    if (options.trailing) trailing.appendChild(options.trailing.nodeType ? options.trailing : document.createTextNode(options.trailing));
    if (trailing.childNodes.length > 0) node.appendChild(trailing);
    if (options.href) linkRow(node, options.title, options.href);
    return node;
  }

  function inlines(parent, list) {
    for (const inline of list || []) {
      if (inline.kind === 'text') parent.appendChild(document.createTextNode(inline.text));
      else if (inline.kind === 'break') parent.appendChild(el('br'));
      else if (inline.kind === 'code') parent.appendChild(el('code', '', inline.text));
      else if (inline.kind === 'link') parent.appendChild(link(inline));
      else if (inline.kind === 'strong' || inline.kind === 'em' || inline.kind === 'del') {
        const node = el(inline.kind === 'strong' ? 'strong' : inline.kind);
        inlines(node, inline.inlines);
        parent.appendChild(node);
      }
    }
    return parent;
  }

  function link(inline) {
    const anchor = el('a');
    anchor.setAttribute('href', inline.href);
    anchor.addEventListener('click', (event) => {
      event.preventDefault();
      d.link(inline.href);
    });
    return inlines(anchor, inline.inlines);
  }

  function listItem(item) {
    if (typeof item.checked !== 'boolean') return blocks(el('li'), item.blocks);
    const node = el('li', item.checked ? 'task checked' : 'task');
    const glyph = checkGlyph(item.checked);
    if (glyph) node.appendChild(glyph);
    node.appendChild(blocks(el('div'), item.blocks));
    return node;
  }

  function table(block) {
    const node = el('table');
    const head = el('thead');
    const headRow = el('tr');
    for (const cell of block.header) headRow.appendChild(inlines(el('th'), cell));
    head.appendChild(headRow);
    node.appendChild(head);
    const body = el('tbody');
    for (const cells of block.rows) {
      const tr = el('tr');
      for (const cell of cells) tr.appendChild(inlines(el('td'), cell));
      body.appendChild(tr);
    }
    node.appendChild(body);
    return node;
  }

  const BLOCKS = {
    heading: (block) => inlines(el('h' + String(block.level + 2), 'h' + String(block.level)), block.inlines),
    paragraph: (block) => inlines(el('p'), block.inlines),
    list: (block) => {
      const node = el(block.ordered ? 'ol' : 'ul');
      if (block.ordered && typeof block.start === 'number' && block.start !== 1) node.setAttribute('start', String(block.start));
      for (const item of block.items) node.appendChild(listItem(item));
      return node;
    },
    quote: (block) => blocks(el('blockquote', 'quote'), block.blocks),
    code: (block) => {
      const pre = el('pre');
      pre.appendChild(el('code', '', block.text));
      return pre;
    },
    table,
    divider: () => el('div', 'gap'),
  };

  function blocks(parent, list) {
    for (const block of list || []) {
      const build = d.own(BLOCKS, block.kind);
      if (build) parent.appendChild(build(block));
    }
    return parent;
  }

  /**
   * Where to cut clamped prose: after the last block that fits whole, so a card never ends on half a
   * line or a heading with nothing under it. A first block taller than the limit is cut at the limit.
   */
  function cutAt(node, limit) {
    let bottom = 0;
    for (const child of node.children) {
      const end = child.offsetTop + child.offsetHeight;
      if (end > limit) break;
      if (!/^H[3-5]$/.test(child.tagName)) bottom = end;
    }
    return bottom > 0 ? bottom : limit;
  }

  /**
   * Authored writing from the server's block model. With clampLines, the prose is cut near that many
   * lines, at a block boundary, and onOverflow(node) runs once it is known to hold more.
   */
  function prose(rich, options) {
    const node = blocks(el('div', 'prose'), rich && rich.blocks);
    const lines = options && options.clampLines;
    if (lines) {
      node.dataset.clamp = '';
      node.style.maxHeight = 'calc(' + String(lines) + ' * 1.55em + 12px)';
      requestAnimationFrame(() => {
        const overflowing = node.scrollHeight > node.clientHeight + 1;
        if (overflowing) {
          const limit = node.clientHeight;
          const cut = cutAt(node, limit);
          // A clean cut between blocks needs no fade; a cut through one long block keeps it.
          if (cut < limit) node.style.maxHeight = String(cut + 8) + 'px';
          else node.dataset.clamp = 'fade';
        }
        if ((overflowing || (rich && rich.truncated)) && options.onOverflow) options.onOverflow(node);
      });
    }
    return node;
  }

  /** The render model this result carries, or an empty one. */
  function renderModel() {
    const meta = d.result && d.result._meta;
    const model = meta && d.own(meta, RENDER_KEY);
    return model && typeof model === 'object' ? model : {};
  }

  /** One item's rendered field, or null when the host sent none. */
  function rich(itemId, path) {
    const items = renderModel().items;
    const fields = items && d.own(items, itemId);
    const value = fields && d.own(fields, path);
    return value && Array.isArray(value.blocks) ? value : null;
  }

  /**
   * The action for what does not fit inline: fullscreen when the host offers it, Docket otherwise,
   * nothing when neither is possible.
   */
  function overflowAction(text, href) {
    if (d.displayMode === 'fullscreen') return null;
    if (d.canDisplay('fullscreen')) return button(text, () => void d.requestDisplayMode('fullscreen'));
    return href ? button('Open in Docket', () => d.link(href)) : null;
  }

  /** Each record kind's name as a person reads it. Every plural adds an s. */
  const NOUNS = {
    task: 'task', project: 'project', program: 'program', initiative: 'initiative', cycle: 'cycle',
    team: 'team', update: 'update', comment: 'comment', session: 'session', agent: 'agent',
    view: 'saved view', org: 'organization', milestone: 'milestone', label: 'label',
    label_group: 'label group', template: 'template',
  };

  /** A record kind's name in lower case: 'task', 'saved view', or 'item' for a kind it does not know. */
  function noun(kind) {
    return d.own(NOUNS, kind) || 'item';
  }

  /** A count with its word: '1 task', '3 tasks'. */
  function plural(count, word) {
    return String(count) + ' ' + word + (count === 1 ? '' : 's');
  }

  /** The text with its first letter in upper case. */
  function capital(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  /** Clear the content region and return it, so a widget can redraw from scratch. */
  function canvas() {
    const root = document.getElementById('view');
    root.replaceChildren();
    return root;
  }

  Object.assign(d, {
    el, kindIcon, priorityGlyph, checkGlyph, healthTone, chip, healthChip, header, button,
    section, row, prose, rich, renderModel, overflowAction, canvas, noun, plural, capital,
  });
  // A live getter. Object.assign would read it once and copy the value, pinning every card to the
  // display mode it had when this script ran.
  Object.defineProperty(d, 'fullscreen', { get: () => d.displayMode === 'fullscreen' });
`;

/**
 * The builders' script, with the icon table and render key it reads bound in, followed by the
 * receipt and browsing controls that build on it.
 */
export const UI_JS = `(() => {
  const ICONS = ${JSON.stringify(KIND_ICON_PATHS)};
  const RENDER_KEY = ${JSON.stringify(RENDER_META_KEY)};
${UI_SCRIPT}
})();
${CONTROLS_SCRIPT}`;
