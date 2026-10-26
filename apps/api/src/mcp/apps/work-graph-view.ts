/** A contained workspace header and a full available canvas keep the work at the center. */
export const GRAPH_VIEW_SCRIPT = String.raw`
window.docketGraphView = function (state, act) {
  const d = window.docket,
    s = state.snapshot,
    expanded = state.exploring || d.fullscreen;
  const root = d.canvas(),
    shell = d.el('div', 'graph-shell');
  shell.dataset.exploring = String(expanded);
  root.appendChild(shell);
  window.docketGraphWorkspace.resize();
  shell.appendChild(window.docketGraphWorkspace.header(state, act, expanded));
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
        d.button('Show all work', () => act.read({ completion: 'all', page: 0 })),
      );
    else empty.appendChild(d.button('Open in Docket', () => d.link(s.scope.href)));
    body.appendChild(empty);
  } else
    body.appendChild(
      state.list
        ? window.docketGraphRender.relationList(state, act)
        : expanded
          ? window.docketGraphRender.stage(state, act)
          : window.docketGraphInline(state, act),
    );
  const details = window.docketGraphInspector(state, act);
  if (details) body.appendChild(details);
  if (expanded && !state.list && s.nodes.length) {
    const controls = d.el('div', 'graph-map-controls');
    controls.setAttribute('aria-label', 'Graph controls');
    controls.append(
      d.button('−', () => act.zoom(0.8), { label: 'Zoom out' }),
      d.button('+', () => act.zoom(1.25), { label: 'Zoom in' }),
    );
    if (state.selected)
      controls.appendChild(
        window.docketGraphUi.button('', 'center', () => act.frame(state.selected), {
          label: 'Show selection',
        }),
      );
    controls.appendChild(
      window.docketGraphUi.button('', 'expand', act.fit, { label: 'Zoom to fit' }),
    );
    for (const button of controls.children) button.title = button.getAttribute('aria-label');
    body.appendChild(controls);
  }
  if (expanded) {
    const paging = window.docketGraphWorkspace.paging(state, act);
    if (paging) body.appendChild(paging);
  }
  shell.appendChild(body);
  if (!expanded) {
    const foot = d.el('div', 'graph-inline-foot');
    if (s.omitted) foot.appendChild(d.el('span', 'graph-meta', 'More work in graph'));
    foot.appendChild(window.docketGraphWorkspace.options(state, act, true));
    shell.appendChild(foot);
  }
  d.resize();
};
`;
