/** Reversible search visits preserve the prior view and paginate matching work without changing scope. */
export const GRAPH_NAVIGATION_SCRIPT = String.raw`
window.docketGraphNavigation = function (state, act) {
  const d = window.docket;
  function capture() {
    return {
      snapshot: state.snapshot,
      args: { ...state.args, expanded: [...(state.args.expanded || [])] },
      camera: state.camera ? { ...state.camera } : null,
      cameraTouched: state.cameraTouched,
      selected: state.selected,
      detailExpanded: state.detailExpanded,
      trace: new Set(state.trace),
      list: state.list,
      search: state.search,
      searchResult: state.searchResult,
      searchReturn: state.searchReturn,
      matchNav: state.matchNav,
    };
  }
  function restore(previous) {
    state.serial++;
    state.searchSerial++;
    state.busy = false;
    state.frame = null;
    const display = d.fullscreen || state.exploring ? 'fullscreen' : 'inline',
      viewport = act.viewport();
    if (previous.args.display !== display || previous.args.viewport !== viewport) {
      const focus =
        display === 'inline'
          ? { focus: previous.selected || previous.args.focus, page: 0 }
          : {};
      void act
        .read({ ...previous.args, display, viewport, ...focus }, state.searchSerial)
        .then((loaded) => {
          if (loaded !== true) return;
          const snapshot = state.snapshot,
            args = state.args;
          Object.assign(state, previous, {
            snapshot,
            args,
            camera: null,
            cameraTouched: false,
            frame: previous.selected,
          });
          d.notice('');
          act.draw();
          act.syncContext();
        });
      return;
    }
    Object.assign(state, previous);
    d.notice('');
    act.draw();
    act.syncContext();
    requestAnimationFrame(() =>
      (
        document.querySelector('.graph-stage') ||
        document.querySelector(
          '[data-graph-select="' + CSS.escape(state.selected || '') + '"]',
        )
      )?.focus({ preventScroll: true }),
    );
  }
  async function jump(node, result) {
    const previous = state.searchReturn || {
      ...capture(),
      search: '',
      searchResult: null,
      matchNav: null,
    };
    const loaded = await act.read(
      {
        focus: node.key,
        page: 0,
        completion: ['completed', 'canceled'].includes(node.category)
          ? 'all'
          : state.args.completion,
      },
      state.searchSerial,
    );
    if (loaded !== true) return;
    state.searchReturn = previous;
    if (result) {
      const start = Math.max(
        0,
        result.offset + Math.min(20, result.total - result.offset) - result.results.length,
      );
      state.matchNav = {
        ...result,
        start,
        index: result.results.findIndex((n) => n.key === node.key),
      };
    } else state.matchNav = null;
    act.select(node.key);
  }
  async function moveMatch(delta) {
    const nav = state.matchNav;
    if (!nav) return;
    const index = nav.index + delta,
      absolute = nav.start + index;
    if (absolute < 0 || absolute >= nav.total) return;
    if (index >= 0 && index < nav.results.length) {
      await jump(nav.results[index], nav);
      return;
    }
    const serial = ++state.searchSerial;
    try {
      const result = await d.call('view_work_graph', {
        ...state.args,
        search: nav.query,
        searchOffset: Math.floor(absolute / 20) * 20,
      });
      if (serial !== state.searchSerial || state.matchNav !== nav || !state.active) return;
      const matches = result.structuredContent?.search;
      if (result.isError || !matches?.results.length) throw new Error('unavailable');
      const next = matches.results[absolute - matches.offset];
      if (!next) throw new Error('unavailable');
      await jump(next, matches);
    } catch {
      if (serial === state.searchSerial)
        d.notice('Couldn’t load that result. Try again.', 'error');
    }
  }
  function returnSearch() {
    if (state.searchReturn) restore(state.searchReturn);
  }
  return { capture, restore, searchJump: jump, moveMatch, returnSearch };
};
`;
