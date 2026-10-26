/** Workspace chrome groups scope, search and secondary actions without consuming the map. */
export const GRAPH_WORKSPACE_SCRIPT = String.raw`
window.docketGraphWorkspace = {
  resize() {
    const d = window.docket,
      shell = document.querySelector('.graph-shell');
    if (!shell) return;
    const dims = d.hostContext.containerDimensions || {},
      padding = getComputedStyle(shell.closest('.card') || shell),
      available =
        (dims.height || dims.maxHeight || window.innerHeight || 720) -
        parseFloat(padding.paddingTop || 0) -
        parseFloat(padding.paddingBottom || 0);
    shell.style.setProperty(
      '--graph-explorer-height',
      Math.max(0, typeof dims.height === 'number' ? available : Math.min(720, available)) +
        'px',
    );
  },
  options(state, act, inline) {
    const d = window.docket,
      ui = window.docketGraphUi,
      s = state.snapshot;
    const menu = d.el('details', 'graph-menu' + (inline ? ' graph-menu-inline' : ''));
    const summary = d.el('summary');
    summary.setAttribute('aria-label', 'Graph options');
    summary.title = 'Graph options';
    if (inline) summary.appendChild(document.createTextNode('View options'));
    else {
      const icon = d.kindIcon('more');
      if (icon) summary.appendChild(icon);
    }
    const panel = d.el('div', 'graph-menu-panel');
    const label = d.el('label', 'graph-menu-field', 'Show');
    const select = d.el('select');
    select.setAttribute('aria-label', 'Work to show');
    for (const [value, text] of [
      ['collapsed', 'Remaining work'],
      ['all', 'All work'],
    ]) {
      const option = d.el('option', '', text);
      option.value = value;
      select.appendChild(option);
    }
    select.value = state.args.completion === 'all' ? 'all' : 'collapsed';
    select.addEventListener('change', () => {
      menu.open = false;
      void act.read({ completion: select.value, page: 0 });
    });
    label.appendChild(select);
    panel.appendChild(label);
    panel.appendChild(
      ui.button(
        state.list ? 'View as graph' : 'View as list',
        state.list ? 'expand' : 'view',
        () => {
          state.list = !state.list;
          act.draw();
        },
      ),
    );
    panel.appendChild(
      ui.button(
        'Refresh',
        'cycle',
        () => {
          menu.open = false;
          void act.read({});
        },
        { label: 'Refresh graph' },
      ),
    );
    panel.appendChild(ui.button('Open in Docket', 'outward', () => d.link(s.scope.href)));
    const counts = d.el('div', 'graph-menu-counts');
    for (const key of ['remaining', 'completed', 'canceled']) {
      if (key === 'canceled' && !s.totals[key]) continue;
      counts.appendChild(d.el('span', '', s.totals[key] + ' ' + key));
    }
    counts.appendChild(d.el('span', '', s.nodes.length + ' items displayed'));
    panel.appendChild(counts);
    panel.appendChild(
      d.el('p', 'graph-menu-help', 'Arrows show what each item is needed for.'),
    );
    if (s.boundaries.length)
      panel.appendChild(
        d.el(
          'p',
          'graph-menu-help',
          'Some connections continue outside this view. Select an item for details.',
        ),
      );
    menu.append(summary, panel);
    menu.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        menu.open = false;
        summary.focus();
        event.stopPropagation();
      }
    });
    return menu;
  },
  header(state, act, expanded) {
    const d = window.docket,
      ui = window.docketGraphUi,
      s = state.snapshot;
    const head = d.el('header', expanded ? 'graph-workspace-header' : 'graph-inline-header');
    head.setAttribute('aria-label', 'Work dependencies');
    head.setAttribute('aria-busy', String(state.busy));
    const scope = d.el('div', 'graph-scope');
    if (state.searchReturn || state.history.length || state.back) {
      const back = ui.button('', 'undo', state.searchReturn ? act.returnSearch : act.back, {
        label: state.searchReturn ? 'Back to previous view' : 'Back',
      });
      back.title = back.getAttribute('aria-label');
      scope.appendChild(back);
    }
    const identity = d.el('div', 'graph-scope-identity'),
      icon = d.kindIcon(s.scope.kind);
    if (icon) identity.appendChild(icon);
    const text = d.el('div', 'graph-scope-text');
    if (!expanded) text.appendChild(d.el('p', 'graph-kicker', 'Dependencies'));
    const title = d.el('h1', '', s.scope.title);
    title.title = s.scope.title;
    text.appendChild(title);
    text.appendChild(
      d.el(
        'p',
        'graph-scope-summary',
        expanded
          ? 'Dependencies · ' + s.totals.remaining + ' remaining'
          : s.totals.remaining + ' remaining · ' + s.totals.completed + ' completed',
      ),
    );
    identity.appendChild(text);
    scope.appendChild(identity);
    if (!expanded)
      scope.appendChild(ui.button('Open graph', 'expand', act.explore, { tonal: true }));
    head.appendChild(scope);
    if (expanded) {
      const row = d.el('div', 'graph-search-row');
      row.appendChild(window.docketGraphSearch(state, act));
      const nav = state.matchNav;
      if (nav && nav.total > 1 && state.search === nav.query) {
        const pager = d.el('div', 'graph-match-nav');
        pager.setAttribute('aria-label', 'Search results');
        const previous = ui.button('', 'child', () => act.moveMatch(-1), {
          label: 'Previous result',
        });
        previous.classList.add('graph-icon-incoming');
        previous.disabled = nav.start + nav.index === 0;
        const next = ui.button('', 'child', () => act.moveMatch(1), { label: 'Next result' });
        next.disabled = nav.start + nav.index + 1 >= nav.total;
        pager.append(
          previous,
          d.el('span', 'graph-meta', nav.start + nav.index + 1 + ' / ' + nav.total),
          next,
        );
        row.appendChild(pager);
      }
      head.appendChild(row);
      head.appendChild(this.options(state, act, false));
    }
    return head;
  },
  paging(state, act) {
    const d = window.docket,
      s = state.snapshot;
    if (!s.nodes.length || !(s.omitted || s.hasNextPage || s.page)) return null;
    const nav = d.el('nav', 'graph-paging');
    nav.setAttribute('aria-label', 'More work');
    if (s.page > 0) {
      const prev = window.docketGraphUi.button(
        '',
        'child',
        () => act.read({ page: s.page - 1 }),
        {
          label: 'Previous page',
        },
      );
      prev.classList.add('graph-icon-incoming');
      nav.appendChild(prev);
    }
    nav.appendChild(
      d.el(
        'span',
        'graph-meta',
        s.nodes.length + ' shown' + (s.omitted ? ' · ' + s.omitted + ' more' : ''),
      ),
    );
    if (s.hasNextPage)
      nav.appendChild(
        window.docketGraphUi.button(
          '',
          'child',
          () => act.read({ page: s.page + 1, focus: undefined }),
          { label: 'Next page' },
        ),
      );
    return nav;
  },
};
`;
