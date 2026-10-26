/** Accessible DOM nodes and SVG connectors shared by standalone and embedded graph views. */
export const GRAPH_RENDER_SCRIPT = String.raw`
(() => {
  const d = window.docket;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = (name, attrs) => {
    const node = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
    return node;
  };
  const nodeName = (n) => n.title || d.untitled(n.kind);
  function lineLabel(edge) {
    return edge.kind === 'project_dependency'
      ? 'Project dependency'
      : edge.aggregated
        ? edge.count + ' task ' + (edge.count === 1 ? 'dependency' : 'dependencies')
        : 'Blocks';
  }
  function connection(edge, byKey, state) {
    const a = byKey.get(edge.source),
      b = byKey.get(edge.target);
    if (!a || !b) return null;
    const vertical = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    const lane = edge.kind === 'project_dependency' ? -12 : 0;
    const x1 = vertical ? a.x + a.width / 2 + lane : a.x + a.width;
    const y1 = vertical ? a.y + a.height : a.y + Math.min(a.height / 2, 48) + lane;
    const x2 = vertical ? b.x + b.width / 2 + lane : b.x;
    const y2 = vertical ? b.y : b.y + Math.min(b.height / 2, 48) + lane;
    const path = vertical
      ? 'M ' +
        x1 +
        ' ' +
        y1 +
        ' C ' +
        x1 +
        ' ' +
        (y1 + 32) +
        ', ' +
        x2 +
        ' ' +
        (y2 - 32) +
        ', ' +
        x2 +
        ' ' +
        y2
      : 'M ' +
        x1 +
        ' ' +
        y1 +
        ' C ' +
        (x1 + 45) +
        ' ' +
        y1 +
        ', ' +
        (x2 - 45) +
        ' ' +
        y2 +
        ', ' +
        x2 +
        ' ' +
        y2;
    const curve = svg('path', { d: path, 'marker-end': 'url(#graph-arrow)' });
    curve.dataset.traced = String(state.trace.has(edge.source) && state.trace.has(edge.target));
    const title = svg('title');
    title.textContent = nodeName(a) + ' → ' + nodeName(b) + ': ' + lineLabel(edge);
    curve.appendChild(title);
    return { curve, x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 8 };
  }
  function graphNode(n, state, act) {
    const node = d.el('button', 'graph-node');
    node.type = 'button';
    Object.assign(node.style, {
      left: n.x + 'px',
      top: n.y + 'px',
      width: n.width + 'px',
      height: n.height + 'px',
    });
    node.dataset.key = n.key;
    node.dataset.graphSelect=n.key;
    node.dataset.container = String(state.snapshot.nodes.some((c) => c.parentKey === n.key));
    node.dataset.muted = String(
      !n.matched ||
        (state.search && !nodeName(n).toLowerCase().includes(state.search.toLowerCase())),
    );
    node.dataset.traced = String(state.trace.has(n.key));
    node.setAttribute('aria-pressed', String(state.selected === n.key));
    node.setAttribute(
      'aria-label',
      nodeName(n) +
        ', ' +
        n.kind +
        ', ' +
        n.status +
        (n.external ? ', outside selected scope' : ''),
    );
    node.appendChild(
      d.el('span', 'graph-node-kind', n.kind + (n.external ? ' · Outside scope' : '')),
    );
    node.appendChild(d.el('span', 'graph-node-name', nodeName(n)));
    const meta = d.el('span', 'graph-node-meta');
    const glyph = d.stateGlyph(n.category);
    if (glyph) meta.appendChild(glyph);
    meta.appendChild(
      document.createTextNode(n.status + (n.childCount ? ' · ' + n.childCount + ' inside' : '')),
    );
    node.appendChild(meta);
    node.addEventListener('click', () => act.select(n.key));
    return node;
  }
  function stage(state, act) {
    const snapshot = state.snapshot;
    const stage = d.el('div', 'graph-stage');
    stage.tabIndex = 0;
    stage.setAttribute('role', 'region');
    stage.setAttribute('aria-label', 'Dependency map. Tab to select work; use arrow keys to pan.');
    const world = d.el('div', 'graph-world');
    Object.assign(world.style, { width: snapshot.width + 'px', height: snapshot.height + 'px' });
    const lines = svg('svg', {
      class: 'graph-edges',
      width: snapshot.width,
      height: snapshot.height,
      'aria-hidden': 'true',
    });
    const defs = svg('defs'),
      marker = svg('marker', {
        id: 'graph-arrow',
        markerWidth: 8,
        markerHeight: 8,
        refX: 7,
        refY: 4,
        orient: 'auto',
      });
    marker.appendChild(
      svg('path', {
        d: 'M 0 0 L 8 4 L 0 8 Z',
        style: 'fill:var(--color-text-secondary);stroke:none',
      }),
    );
    defs.appendChild(marker);
    lines.appendChild(defs);
    const byKey = new Map(snapshot.nodes.map((n) => [n.key, n]));
    for (const edge of snapshot.edges) {
      const made = connection(edge, byKey, state);
      if (!made) continue;
      lines.appendChild(made.curve);
      if (edge.aggregated || edge.kind === 'project_dependency') {
        const label = svg('text', {
          x: made.x,
          y: made.y,
          class: 'graph-edge-label',
          'text-anchor': 'middle',
        });
        label.textContent = lineLabel(edge);
        lines.appendChild(label);
      }
    }
    for (const r of snapshot.relations.filter((r) => r.kind === 'contributes')) {
      const made = connection(r, byKey, state);
      if (made) {
        made.curve.removeAttribute('marker-end');
        made.curve.classList.add('contribution');
        lines.appendChild(made.curve);
      }
    }
    world.appendChild(lines);
    for (const n of [...snapshot.nodes].sort((a, b) => b.width * b.height - a.width * a.height))
      world.appendChild(graphNode(n, state, act));
    stage.appendChild(world);
    act.attach(stage, world);
    return stage;
  }
  function inspector(state, act) {
    const node = state.snapshot.nodes.find((n) => n.key === state.selected);
    if (!node) return null;
    const panel = d.el('aside', 'graph-inspector');
    panel.setAttribute('aria-label', 'Selected work');
    panel.appendChild(
      d.el('p', 'graph-meta', node.kind + (node.external ? ' · Outside scope' : '')),
    );
    panel.appendChild(d.el('h2', '', nodeName(node)));
    panel.appendChild(d.el('p', 'graph-meta', node.status));
    const actions = d.el('div', 'graph-actions');
    actions.appendChild(d.button('Open in Docket', () => d.link(node.href)));
    if (node.childCount && node.key !== state.snapshot.scope.key) {
      const expanded = (state.args.expanded || []).includes(node.key);
      actions.appendChild(
        d.button(expanded ? 'Collapse group' : 'Expand group', () => act.expand(node.key)),
      );
    }
    actions.appendChild(
      d.button('Open neighborhood', () => act.scope({ kind: node.kind, id: node.id })),
    );
    panel.appendChild(actions);
    const byKey = new Map(state.snapshot.nodes.map((n) => [n.key, n]));
    const relations = (incoming) => {
      const section = d.el('div');
      section.appendChild(
        d.el('p', 'graph-meta', incoming ? 'Visible prerequisites' : 'Visible downstream work'),
      );
      const list = d.el('ul');
      for (const e of state.snapshot.edges.filter(
        (e) => (incoming ? e.target : e.source) === node.key,
      )) {
        const other = byKey.get(incoming ? e.source : e.target);
        if (!other) continue;
        const item = d.el('li');
        item.appendChild(d.button(nodeName(other), () => act.select(other.key)));
        list.appendChild(item);
      }
      section.appendChild(
        list.childNodes.length ? list : d.el('p', 'graph-meta', 'None in this scene'),
      );
      return section;
    };
    panel.appendChild(relations(true));
    panel.appendChild(relations(false));
    const boundary = state.snapshot.boundaries.find((b) => b.key === node.key);
    if (boundary)
      panel.appendChild(
        d.el(
          'p',
          'graph-meta',
          String(boundary.incoming + boundary.outgoing) +
            ' recorded connections outside this scene. Open the neighborhood to explore.',
        ),
      );
    const traces = d.el('div', 'graph-actions');
    traces.appendChild(d.button('Trace prerequisites', () => act.trace('before')));
    traces.appendChild(d.button('Show what this unlocks', () => act.trace('after')));
    if (state.trace.size) traces.appendChild(d.button('Clear trace', () => act.trace('clear')));
    panel.appendChild(traces);
    panel.appendChild(d.button('Ask about this', () => act.ask(node), { tonal: true }));
    return panel;
  }
  function relationList(state, act) {
    const list = d.el('div', 'graph-relations');
    const byKey = new Map(state.snapshot.nodes.map((n) => [n.key, n]));
    for (const n of state.snapshot.nodes) {
      const row = d.el('div', 'graph-relation');
      const select=d.button(nodeName(n),()=>act.select(n.key));select.dataset.graphSelect=n.key;row.appendChild(select);
      row.appendChild(
        d.el('span', 'graph-meta', n.status + (n.external ? ' · Outside scope' : '')),
      );
      list.appendChild(row);
    }
    for (const e of state.snapshot.edges) {
      const a = byKey.get(e.source),
        b = byKey.get(e.target);
      if (a && b)
        list.appendChild(
          d.el('p', 'graph-meta', nodeName(a) + ' → ' + nodeName(b) + ' · ' + lineLabel(e)),
        );
    }
    byKey.set(state.snapshot.scope.key,state.snapshot.scope);
    for(const relation of state.snapshot.relations){
      const source=byKey.get(relation.source),target=byKey.get(relation.target);if(!source||!target)continue;
      const text=relation.kind==='contains'?nodeName(source)+' contains '+nodeName(target):nodeName(target)+' contributes to '+nodeName(source);
      list.appendChild(d.el('p','graph-meta',text));
    }
    return list;
  }
  window.docketGraphRender = { stage, inspector, relationList };
})();

`;
