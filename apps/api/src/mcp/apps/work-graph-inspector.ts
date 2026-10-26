/** Original endpoints and container context prevent collapsed arrows from duplicating prerequisites. */
export const GRAPH_INSPECTOR_SCRIPT = String.raw`
window.docketGraphInspector = function (state, act) {
  const d = window.docket,
    ui = window.docketGraphUi,
    node = state.snapshot.nodes.find((n) => n.key === state.selected);
  if (!node) return null;
  const detail = state.snapshot.details?.find((n) => n.key === node.key);
  const panel = d.el('aside', 'graph-inspector');
  panel.setAttribute('aria-label', 'Selected work');
  const heading = d.el('div', 'graph-detail-heading');
  heading.appendChild(ui.location(state, node.key));
  heading.appendChild(
    ui.button('', 'close', () => act.select(null), { label: 'Close selected work' }),
  );
  panel.appendChild(heading);
  const name = d.el('h2', '', node.title);
  if (node.kind !== 'task') {
    const icon = d.kindIcon(node.kind);
    if (icon) name.prepend(icon);
  }
  panel.appendChild(name);
  const status = d.el('div', 'graph-detail-status'),
    glyph = d.stateGlyph(node.category);
  if (glyph) status.appendChild(glyph);
  status.appendChild(
    d.el('span', 'graph-meta', node.status + (node.external ? ' · Outside scope' : '')),
  );
  panel.appendChild(status);
  const primary = d.el('div', 'graph-actions');
  primary.append(
    ui.button('Ask about this', 'comment', () => act.ask(node), { tonal: true }),
    ui.button('Open', 'outward', () => d.link(node.href), { label: 'Open in Docket' }),
  );
  panel.appendChild(primary);
  function section(incoming) {
    const side = detail?.[incoming ? 'incoming' : 'outgoing'],
      items = side?.items || [];
    const section = d.el('section', 'graph-detail-section'),
      head = d.el('div', 'graph-detail-heading');
    const title = d.el('h3', '', incoming ? 'Prerequisites' : 'Downstream work'),
      icon = d.kindIcon('child');
    if (icon) {
      if (incoming) icon.classList.add('graph-icon-incoming');
      title.prepend(icon);
    }
    head.appendChild(title);
    if (items.length)
      head.appendChild(
        d.button('Trace', () => act.trace(incoming ? 'before' : 'after'), {
          label: incoming ? 'Trace prerequisites' : 'Show what this unlocks',
        }),
      );
    section.appendChild(head);
    for (const item of items) {
      const shown = state.snapshot.nodes.some((n) => n.key === item.work.key);
      const row = d.button('', () => (shown ? act.select(item.work.key) : act.reveal(item.work)));
      row.classList.add('graph-detail-link');
      const label = d.el('span', 'graph-detail-name'),
        icon =
          item.work.kind === 'task' ? d.stateGlyph(item.work.category) : d.kindIcon(item.work.kind);
      if (icon) label.appendChild(icon);
      label.appendChild(d.el('span', '', item.work.title));
      row.appendChild(label);
      const context =
        item.kind === 'project_dependency'
          ? 'Saved project dependency'
          : (item.trailTruncated ? '… / ' : '') + item.trail.map((p) => p.title).join(' / ');
      row.appendChild(
        d.el(
          'span',
          'graph-meta',
          context + (context ? ' · ' : '') + item.work.status + (shown ? '' : ' · Reveal'),
        ),
      );
      if (item.via)
        row.appendChild(
          d.el('span', 'graph-meta', (incoming ? 'Before ' : 'After ') + item.via.title),
        );
      row.dataset.relationshipKey =
        item.kind + ':' + item.work.key + (item.via ? ':' + item.via.key : '');
      section.appendChild(row);
    }
    if ((side?.total || 0) > items.length)
      section.appendChild(
        d.button(side.total - items.length + ' more connections · Open neighborhood', () =>
          act.scope({ kind: node.kind, id: node.id }),
        ),
      );
    if (!items.length) section.appendChild(d.el('p', 'graph-meta', 'No recorded relationships'));
    return section;
  }
  panel.append(section(true), section(false));
  if (state.trace.size) panel.appendChild(d.button('Clear trace', () => act.trace('clear')));
  const navigation = d.el('div', 'graph-actions');
  if (node.childCount)
    navigation.appendChild(
      d.button(
        (state.args.expanded || []).includes(node.key) ? 'Collapse group' : 'Expand group',
        () => act.expand(node.key),
      ),
    );
  navigation.appendChild(
    ui.button('Open neighborhood', 'expand', () => act.scope({ kind: node.kind, id: node.id })),
  );
  panel.appendChild(navigation);
  return panel;
};
`;
