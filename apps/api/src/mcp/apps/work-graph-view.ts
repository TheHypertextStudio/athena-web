/** Conversation and explorer composition share the same navigation and selection state. */
export const GRAPH_VIEW_SCRIPT = String.raw`
window.docketGraphView = function (state, act) {
  const d = window.docket,
    s = state.snapshot,
    expanded = state.exploring || d.fullscreen;
  const root = d.canvas(),
    shell = d.el('div', 'graph-shell');
  shell.dataset.exploring = String(expanded);
  root.appendChild(shell);
  const header = d.el('div', 'graph-heading');
  if (state.back || state.history.length) header.appendChild(d.button('Back', act.back));
  const title = d.el('div', 'graph-title');
  title.appendChild(d.el('p', 'graph-kicker', s.scope.kind + ' · Work graph'));
  const name = d.el('h1', '', s.scope.title);
  name.title = s.scope.title;
  title.appendChild(name);
  header.appendChild(title);
  if (!expanded) header.appendChild(d.button('Explore graph', act.explore, { tonal: true }));
  shell.appendChild(header);
  const summary = d.el('div', 'graph-summary');
  for (const key of ['remaining', 'completed', 'canceled']) {
    if (key === 'canceled' && !s.totals[key]) continue;
    const item = d.el('span');
    item.append(d.el('strong', '', String(s.totals[key])), document.createTextNode(' ' + key));
    summary.appendChild(item);
  }
  if (state.history.length)
    summary.appendChild(
      d.el('span', 'graph-meta', state.history.map((h) => h.snapshot.scope.title).join(' / ')),
    );
  shell.appendChild(summary);
  const toolbar = d.el('div', 'graph-toolbar');
  function options() {
    const items = d.el('div', 'graph-actions');
    const select = d.el('select');
    select.setAttribute('aria-label', 'Completed work display');
    for (const [value, label] of [
      ['collapsed', 'Completed collapsed'],
      ['all', 'Show everything'],
      ['remaining', 'Remaining work'],
    ]) {
      const option = d.el('option', '', label);
      option.value = value;
      select.appendChild(option);
    }
    select.value = state.args.completion || 'collapsed';
    select.addEventListener('change', () => act.read({ completion: select.value, page: 0 }));
    items.appendChild(select);
    items.appendChild(
      d.button(state.list ? 'Map' : 'Relationship list', () => {
        state.list = !state.list;
        act.draw();
      }),
    );
    items.appendChild(
      d.button(state.busy ? 'Refreshing…' : 'Refresh', () => act.read({}), {
        label: 'Refresh graph',
      }),
    );
    return items;
  }
  if (expanded) {
    toolbar.appendChild(window.docketGraphSearch(state, act));
    toolbar.appendChild(options());
  } else {
    const details = d.el('details', 'graph-options');
    details.appendChild(d.el('summary', '', 'View options'));
    details.appendChild(options());
    toolbar.appendChild(details);
  }
  shell.appendChild(toolbar);
  const body = d.el('div', 'graph-body');
  if (!s.nodes.length) {
    const empty = d.el('div', 'graph-empty');
    empty.appendChild(
      d.el(
        'p',
        '',
        s.totals.total ? 'No remaining work in this view' : 'No work recorded here yet',
      ),
    );
    if (s.totals.total)
      empty.appendChild(
        d.button('Show everything', () => act.read({ completion: 'all', page: 0 })),
      );
    if (!s.totals.total) empty.appendChild(d.button('Open in Docket', () => d.link(s.scope.href)));
    body.appendChild(empty);
  } else
    body.appendChild(
      state.list
        ? window.docketGraphRender.relationList(state, act)
        : expanded
          ? window.docketGraphRender.stage(state, act)
          : window.docketGraphInline(state, act),
    );
  const detail = window.docketGraphInspector(state, act);
  if (detail) body.appendChild(detail);
  if (expanded && !state.list && s.nodes.length) {
    const controls = d.el('div', 'graph-map-controls');
    controls.setAttribute('aria-label', 'Map controls');
    controls.append(
      d.button('−', () => act.zoom(0.8), { label: 'Zoom out' }),
      d.button('+', () => act.zoom(1.25), { label: 'Zoom in' }),
      d.button('Fit all', act.fit),
    );
    body.appendChild(controls);
  }
  shell.appendChild(body);
  const foot = d.el('div', 'graph-caption');
  const count = expanded
    ? s.nodes.length + ' shown' + (s.omitted ? ' · ' + s.omitted + ' outside this view' : '')
    : 'Showing ' + s.nodes.length + ' work items' + (s.omitted ? ' · More in Explore' : '');
  foot.appendChild(d.el('span', '', count));
  if (expanded) foot.appendChild(d.el('span', '', '→ Blocks · Dashed groups contain work'));
  if (s.page > 0) foot.appendChild(d.button('Previous page', () => act.read({ page: s.page - 1 })));
  if (expanded && s.hasNextPage)
    foot.appendChild(d.button('Next page', () => act.read({ page: s.page + 1, focus: undefined })));
  if (!s.nodes.length && s.completedGroups.length)
    foot.appendChild(d.el('span', '', s.totals.completed + ' completed'));
  shell.appendChild(foot);
  d.resize();
};
`;
