/** Scope-wide search keeps typing local and explicitly reveals a chosen authorized match. */
export const GRAPH_SEARCH_SCRIPT = String.raw`
window.docketGraphSearch = function (state, act) {
  const d = window.docket,
    wrap = d.el('div', 'graph-search-wrap'),
    results = d.el('div', 'graph-search-results');
  let timer,
    active = -1,
    items = [];
  const field = d.search('Find work in this scope', state.search, (value) => {
    state.search = value;
    state.searchResult = null;
    items = [];
    state.searchSerial++;
    clearTimeout(timer);
    if (!value.trim()) {
      state.searchResult = null;
      paint(null);
      return;
    }
    results.hidden = false;
    results.replaceChildren(d.el('p', 'graph-meta', 'Searching…'));
    input.setAttribute('aria-expanded', 'true');
    timer = setTimeout(() => search(0, false), 180);
  });
  const input = field.querySelector('input');
  input.maxLength = 160;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', 'graph-search-options');
  input.setAttribute('aria-expanded', 'false');
  results.id = 'graph-search-options';
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', 'Matching work');
  results.hidden = true;
  function paint(result) {
    results.replaceChildren();
    active = -1;
    input.removeAttribute('aria-activedescendant');
    results.hidden = !result;
    input.setAttribute('aria-expanded', String(Boolean(result)));
    items = result?.results || [];
    if (!result) return;
    const summary = d.el(
      'p',
      'graph-search-summary',
      result.total +
        ' ' +
        (result.total === 1 ? 'match' : 'matches') +
        ' · includes completed work',
    );
    summary.setAttribute('role', 'presentation');
    results.appendChild(summary);
    items.forEach((n, i) => {
      const row = d.button('', () => choose(n));
      row.id = 'graph-match-' + i;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.tabIndex = -1;
      row.appendChild(d.el('strong', '', n.title));
      row.appendChild(
        d.el(
          'span',
          'graph-meta',
          (n.trail.map((p) => p.title).join(' / ') || state.snapshot.scope.title) +
            ' · ' +
            n.status,
        ),
      );
      results.appendChild(row);
    });
    if (!items.length)
      results.appendChild(d.el('p', 'graph-search-summary', 'Try a title or work ID.'));
    if (result.hasMore) {
      const more = d.button('More matches', () => search(result.offset + 20, true));
      more.setAttribute('role', 'option');
      more.setAttribute('aria-selected', 'false');
      results.appendChild(more);
    }
  }
  async function search(offset, append) {
    const serial = ++state.searchSerial,
      query = state.search,
      scope = JSON.stringify(state.args.scope);
    try {
      const response = await d.call('view_work_graph', {
        ...state.args,
        search: query,
        searchOffset: offset,
      });
      if (
        serial !== state.searchSerial ||
        !state.active ||
        scope !== JSON.stringify(state.args.scope) ||
        !wrap.isConnected
      )
        return;
      const result = response.structuredContent?.search;
      if (response.isError || !result) throw new Error('unavailable');
      if (append) result.results = [...items, ...result.results];
      state.searchResult = result;
      if (wrap.contains(document.activeElement)) paint(result);
      if (append) input.focus();
    } catch {
      if (serial !== state.searchSerial || !wrap.isConnected) return;
      results.replaceChildren(
        d.el('p', 'graph-search-summary', 'Search is unavailable.'),
        d.button('Retry search', () => search(offset, append)),
      );
    }
  }
  function choose(n) {
    state.searchSerial++;
    state.searchResult = null;
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    void act.reveal(n);
  }
  input.addEventListener('focus', () => {
    if (state.searchResult) paint(state.searchResult);
    else if (state.search.trim()) void search(0, false);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      state.searchSerial++;
      clearTimeout(timer);
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      event.stopPropagation();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.hidden && state.searchResult) paint(state.searchResult);
      if (!items.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      results
        .querySelectorAll('[role=option]')
        .forEach((row, i) => row.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', 'graph-match-' + active);
      results.querySelector('#graph-match-' + active)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && items.length && !results.hidden) {
      event.preventDefault();
      choose(items[Math.max(0, active)]);
    }
  });
  wrap.addEventListener('focusout', () =>
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) {
        results.hidden = true;
        input.setAttribute('aria-expanded', 'false');
      }
    }, 0),
  );
  wrap.append(field, results);
  return wrap;
};
`;
