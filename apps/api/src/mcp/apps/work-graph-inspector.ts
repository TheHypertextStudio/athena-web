/** Original endpoints and container context prevent collapsed arrows from duplicating prerequisites. */
export const GRAPH_INSPECTOR_SCRIPT = String.raw`
window.docketGraphInspector = function (state, act) {
  const d = window.docket,
    ui = window.docketGraphUi,
    node = state.snapshot.nodes.find((n) => n.key === state.selected);
  if (!node) return null;
  const detail = state.snapshot.details?.find((n) => n.key === node.key);
  const panel = d.el('aside', 'graph-inspector');
  panel.setAttribute('aria-label', 'Work details');
  panel.dataset.expanded = String(state.detailExpanded);
  const peek = d.el('div', 'graph-selection-peek');
  const peekHead = d.el('div', 'graph-peek-heading'),
    peekText = d.el('div', 'graph-peek-title');
  peekText.appendChild(d.el('h2', '', node.title));
  const parent = detail?.trail?.at(-1)?.title || state.snapshot.scope.title;
  peekText.appendChild(d.el('p', 'graph-meta', parent + ' · ' + node.status));
  peekHead.appendChild(peekText);
  peekHead.appendChild(
    ui.button('', 'close', () => act.select(null), { label: 'Close details' }),
  );
  peek.appendChild(peekHead);
  const peekFoot = d.el('div', 'graph-peek-actions'),
    first = detail?.incoming.items[0];
  if (first) {
    const need = d.button('', () => act.reveal(first.work));
    need.classList.add('graph-peek-need');
    need.append(
      d.el('span', 'graph-peek-label', 'Needs first · ' + first.work.status),
      d.el('span', '', first.work.title),
    );
    need.title = 'Show ' + first.work.title + ' on graph';
    peekFoot.appendChild(need);
  } else peekFoot.appendChild(d.el('span', 'graph-meta', 'No dependencies listed'));
  const toggle = ui.button(
    state.detailExpanded ? '' : 'Show details',
    state.detailExpanded ? 'chevron' : 'view',
    act.details,
    { label: state.detailExpanded ? 'Hide details' : 'Show details' },
  );
  toggle.dataset.detailsToggle = 'true';
  toggle.setAttribute('aria-expanded', String(state.detailExpanded));
  if (state.detailExpanded) peekHead.insertBefore(toggle, peekHead.lastChild);
  else {
    peekFoot.appendChild(toggle);
    peek.appendChild(peekFoot);
  }
  panel.appendChild(peek);
  const content = d.el('div', 'graph-inspector-content');
  panel.appendChild(content);

  const heading = d.el('div', 'graph-detail-heading');
  heading.appendChild(ui.location(state, node.key));
  heading.appendChild(
    ui.button('', 'close', () => act.select(null), { label: 'Close details' }),
  );
  content.appendChild(heading);
  const name = d.el('h2', '', node.title);
  if (node.kind !== 'task') {
    const icon = d.kindIcon(node.kind);
    if (icon) name.prepend(icon);
  }
  content.appendChild(name);
  const status = d.el('div', 'graph-detail-status'),
    glyph = d.stateGlyph(node.category);
  if (glyph) status.appendChild(glyph);
  status.appendChild(
    d.el(
      'span',
      'graph-meta',
      node.status + (node.external ? ' · ' + ui.externalLabel(state) : ''),
    ),
  );
  content.appendChild(status);
  const primary = d.el('div', 'graph-actions graph-primary-actions');
  primary.append(
    ui.button('Ask in chat', 'comment', () => act.ask(node), { tonal: true }),
    ui.button('Open in Docket', 'outward', () => d.link(node.href), {
      label: 'Open in Docket',
    }),
  );
  content.appendChild(primary);
  function section(incoming) {
    const side = detail?.[incoming ? 'incoming' : 'outgoing'],
      items = side?.items || [];
    const section = d.el('section', 'graph-detail-section'),
      head = d.el('div', 'graph-detail-heading');
    const title = d.el('h3', '', incoming ? 'Needs first' : 'Depends on this'),
      icon = d.kindIcon('child');
    if (icon) {
      if (incoming) icon.classList.add('graph-icon-incoming');
      title.prepend(icon);
    }
    head.appendChild(title);
    const visibleConnection = state.snapshot.edges.some(
      (edge) => (incoming ? edge.target : edge.source) === node.key,
    );
    if (items.length && visibleConnection)
      head.appendChild(
        d.button('Highlight', () => act.trace(incoming ? 'before' : 'after'), {
          label: incoming
            ? 'Highlight work needed first'
            : 'Highlight work that depends on this',
        }),
      );
    section.appendChild(head);
    for (const item of items) {
      const shown = state.snapshot.nodes.some((n) => n.key === item.work.key);
      const row = d.button('', () =>
        shown ? act.select(item.work.key) : act.reveal(item.work),
      );
      row.classList.add('graph-detail-link');
      const label = d.el('span', 'graph-detail-name'),
        icon =
          item.work.kind === 'task'
            ? d.stateGlyph(item.work.category)
            : d.kindIcon(item.work.kind);
      if (icon) label.appendChild(icon);
      label.appendChild(d.el('span', '', item.work.title));
      row.appendChild(label);
      const context =
        item.kind === 'project_dependency'
          ? 'Project dependency'
          : (item.trailTruncated ? '… / ' : '') + item.trail.map((p) => p.title).join(' / ');
      const meta = d.el('span', 'graph-meta');
      meta.append(
        document.createTextNode(context + (context ? ' · ' : '') + item.work.status + ' · '),
        d.el('span', 'graph-detail-action', shown ? 'View details' : 'Show on graph'),
      );
      row.appendChild(meta);
      if (item.via)
        row.appendChild(
          d.el(
            'span',
            'graph-meta',
            (incoming ? 'Needed for ' : 'Depends on ') + item.via.title,
          ),
        );
      row.dataset.relationshipKey =
        item.kind + ':' + item.work.key + (item.via ? ':' + item.via.key : '');
      section.appendChild(row);
    }
    if ((side?.total || 0) > items.length)
      section.appendChild(
        d.el(
          'p',
          'graph-meta',
          'Showing ' + items.length + ' of ' + side.total + ' connections.',
        ),
      );
    if (!items.length) section.appendChild(d.el('p', 'graph-meta', 'Nothing listed yet'));
    return section;
  }
  content.append(section(true), section(false));
  if (state.trace.size)
    content.appendChild(d.button('Clear highlights', () => act.trace('clear')));
  const navigation = d.el('div', 'graph-actions');
  if (node.childCount)
    navigation.appendChild(
      d.button(ui.childrenLabel(node, (state.args.expanded || []).includes(node.key)), () =>
        act.expand(node.key),
      ),
    );
  if (node.key !== state.snapshot.scope.key)
    navigation.appendChild(
      ui.button(ui.scopeLabel(node), 'expand', () =>
        act.scope({ kind: node.kind, id: node.id }),
      ),
    );
  content.appendChild(navigation);
  return panel;
};
`;
