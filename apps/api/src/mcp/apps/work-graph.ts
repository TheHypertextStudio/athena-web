/** Shared controller for the standalone graph and graph views opened from existing cards. */
import { appDocument } from './runtime';
import { GRAPH_CSS } from './work-graph-style';
import { GRAPH_RENDER_SCRIPT } from './work-graph-render';
import { GRAPH_CAMERA_SCRIPT } from './work-graph-camera';
import { GRAPH_SEARCH_SCRIPT } from './work-graph-search';
import { GRAPH_INLINE_SCRIPT } from './work-graph-inline';
import { GRAPH_INSPECTOR_SCRIPT } from './work-graph-inspector';
import { GRAPH_VIEW_SCRIPT } from './work-graph-view';

const CONTROLLER = String.raw`
(() => {
  const d = window.docket;
  const css = document.createElement('style');
  css.textContent = window.__docketGraphCss;
  document.head.appendChild(css);
  function create() {
    const state = {
      active: false,
      snapshot: null,
      args: {},
      selected: null,
      trace: new Set(),
      search: '',
      searchSerial: 0,
      searchResult: null,
      frame: null,
      list: false,
      exploring: false,
      camera: null,
      cameraTouched: false,
      back: null,
      history: [],
      serial: 0,
      busy: false,
    };
    let resizeTimer = null;
    const camera = window.docketGraphCamera(state);
    const viewport = () =>
      document.documentElement.clientWidth < 480
        ? 'portrait'
        : document.documentElement.clientWidth < 800
          ? 'square'
          : 'landscape';
    function draw() {
      if (!state.active || !state.snapshot) return;
      document.body.dataset.workGraph = 'active';
      window.docketGraphView(state, actions);
    }
    async function explore() {
      state.exploring = true;
      const mode = await d.requestDisplayMode('fullscreen');
      state.exploring = mode !== 'fullscreen';
      await read({ display: 'fullscreen', viewport: viewport() });
    }
    async function reveal(node) {
      const loaded = await read({
        focus: node.key,
        page: 0,
        completion: ['completed', 'canceled'].includes(node.category)
          ? 'all'
          : state.args.completion,
      });
      if (loaded) select(node.key);
    }
    async function read(changes) {
      const serial = ++state.serial;
      const args = Object.assign({}, state.args, changes);
      state.busy = true;
      d.notice('Loading graph…');
      try {
        const result = await d.call('view_work_graph', args);
        if (serial !== state.serial) return;
        const snapshot = result && result.structuredContent;
        if (result.isError || !snapshot || !Array.isArray(snapshot.nodes))
          throw new Error('unavailable');
        const modeChanged =
          args.display !== state.args.display || args.viewport !== state.args.viewport;
        state.args = { ...args, expanded: snapshot.expanded };
        state.snapshot = snapshot;
        if (typeof changes.focus === 'string') {
          state.selected = changes.focus;
          state.frame = changes.focus;
        }
        if (modeChanged && !state.cameraTouched) state.camera = null;
        state.active = true;
        state.busy = false;
        d.notice('');
        draw();
        return true;
      } catch {
        if (serial !== state.serial) return;
        state.busy = false;
        d.notice(
          'The graph could not be loaded. Your previous view is preserved. Try Refresh or reopen the graph.',
          'error',
        );
        return false;
      }
    }
    function select(key) {
      const previous = state.selected;
      state.selected = key;
      state.trace.clear();
      draw();
      const n = state.snapshot.nodes.find((n) => n.key === key);
      if (n)
        void d
          .updateContext({
            structuredContent: {
              orgId: state.args.orgId,
              scope: state.args.scope,
              selected: { kind: n.kind, id: n.id, title: n.title },
              asOf: state.snapshot.asOf,
            },
          })
          .catch(() => {});
      requestAnimationFrame(() => {
        if (document.activeElement?.closest('.graph-search-wrap')) return;
        document
          .querySelector('[data-graph-select="' + CSS.escape(key || previous || '') + '"]')
          ?.focus({ preventScroll: true });
      });
    }
    function trace(direction) {
      state.trace.clear();
      if (direction !== 'clear' && state.selected) {
        state.trace.add(state.selected);
        let frontier = [state.selected];
        while (frontier.length) {
          const next = [];
          for (const e of state.snapshot.edges) {
            const from = direction === 'before' ? e.target : e.source,
              to = direction === 'before' ? e.source : e.target;
            if (frontier.includes(from) && !state.trace.has(to)) {
              state.trace.add(to);
              next.push(to);
            }
          }
          frontier = next;
        }
      }
      draw();
    }
    async function expand(key) {
      const expanded = new Set(state.args.expanded || []);
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      if (!state.exploring && !d.fullscreen) await explore();
      const loaded = await read({
        expanded: [...expanded],
        focus: key,
        display: 'fullscreen',
        page: 0,
      });
      if (loaded !== true) return;
      camera.frame(key);
      requestAnimationFrame(() =>
        document
          .querySelector('[data-graph-toggle="' + CSS.escape(key) + '"]')
          ?.focus({ preventScroll: true }),
      );
    }
    async function scope(next) {
      const previous = {
        snapshot: state.snapshot,
        args: { ...state.args },
        camera: state.camera,
        selected: state.selected,
        search: state.search,
        searchResult: state.searchResult,
        trace: new Set(state.trace),
        list: state.list,
      };
      state.camera = null;
      state.search = '';
      state.trace.clear();
      state.searchResult = null;
      state.searchSerial++;
      const loaded = await read({
        scope: next,
        page: 0,
        expanded: [],
        focus: next.kind + ':' + next.id,
      });
      if (loaded === true) {
        state.history.push(previous);
        draw();
      } else if (loaded === false) Object.assign(state, previous);
    }
    function back() {
      state.serial++;
      state.searchSerial++;
      state.frame = null;
      state.busy = false;
      const previous = state.history.pop();
      if (previous) {
        Object.assign(state, previous);
        draw();
        return;
      }
      state.active = false;
      delete document.body.dataset.workGraph;
      if (state.back) state.back();
    }
    async function ask(n) {
      try {
        await d.say(
          'What would unblock “' +
            n.title +
            '”, and what would completing it unlock? Docket ' +
            n.kind +
            ' ' +
            n.id +
            ' in workspace ' +
            state.args.orgId +
            '. Graph snapshot ' +
            state.snapshot.asOf +
            '.',
        );
      } catch {
        d.notice(
          'Your host could not send the question. Ask about “' + n.title + '” in the conversation.',
          'error',
        );
      }
    }
    const actions = {
      select,
      expand,
      scope,
      trace,
      ask,
      read,
      draw,
      back,
      explore,
      reveal,
      ...camera,
    };
    document.addEventListener('keydown', (event) => {
      if (state.active && event.key === 'Escape' && !event.defaultPrevented) {
        select(null);
      }
    });
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.active && state.args.viewport !== viewport()) void read({ viewport: viewport() });
      }, 180);
    });
    return {
      get active() {
        return state.active;
      },
      draw,
      async open(scopeValue, orgId, onBack, focusKeys, listInput) {
        state.back = onBack;
        state.history = [];
        state.selected = null;
        state.search = '';
        state.searchResult = null;
        state.searchSerial++;
        state.trace.clear();
        state.cameraTouched = false;
        state.exploring = false;
        state.list = false;
        state.args = {
          orgId,
          scope: scopeValue,
          completion: 'collapsed',
          expanded: [],
          display: d.fullscreen ? 'fullscreen' : 'inline',
          viewport: viewport(),
          focusKeys: focusKeys || [],
        };
        if (listInput) {
          const {
            orgId: ignoredOrg,
            entity: ignoredEntity,
            limit: ignoredLimit,
            cursor: ignoredCursor,
            ...filters
          } = listInput;
          state.args.focusFilter = filters;
        }
        state.camera = null;
        await read({});
      },
      show(snapshot, args) {
        state.snapshot = snapshot;
        state.args = Object.assign(
          { completion: 'collapsed', expanded: [], display: 'inline', viewport: 'landscape' },
          args,
        );
        state.args.expanded = snapshot.expanded;
        state.active = true;
        state.selected = args.focus || null;
        draw();
        if (state.args.viewport !== viewport()) void read({ viewport: viewport() });
      },
      mode() {
        if (!state.active) return false;
        const mode = d.fullscreen || state.exploring ? 'fullscreen' : 'inline';
        if (state.args.display !== mode || state.args.viewport !== viewport())
          void read({ display: mode, viewport: viewport() });
        else draw();
        return true;
      },
    };
  }
  window.docketGraph = { create };
})();
`;

/** Install the same renderer/controller in graph, entity and scoped-list resources. */
export const GRAPH_SCRIPT = `window.__docketGraphCss=${JSON.stringify(GRAPH_CSS)};\n${GRAPH_RENDER_SCRIPT}\n${GRAPH_CAMERA_SCRIPT}\n${GRAPH_SEARCH_SCRIPT}\n${GRAPH_INLINE_SCRIPT}\n${GRAPH_INSPECTOR_SCRIPT}\n${GRAPH_VIEW_SCRIPT}\n${CONTROLLER}`;
/** Standalone graph resource, using the existing host protocol and loading shell. */
export const WORK_GRAPH_HTML = appDocument(
  'Work graph',
  `${GRAPH_SCRIPT}\n(() => {
  const graph=window.docketGraph.create();
  window.docket.onDisplayMode(()=>graph.mode());
  window.docket.onData(data=>graph.show(data,window.docket.input));
})();`,
  { skeletonRows: 4 },
);
