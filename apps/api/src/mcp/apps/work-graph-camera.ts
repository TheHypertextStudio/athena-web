/** Local viewport gestures and readable framing; only structural changes ask the server for layout. */
export const GRAPH_CAMERA_SCRIPT = String.raw`
window.docketGraphCamera = function (state) {
  let stage, world;
  function transform() {
    if (world && state.camera)
      world.style.transform =
        'translate(' +
        state.camera.x +
        'px,' +
        state.camera.y +
        'px) scale(' +
        state.camera.scale +
        ')';
  }
  function frame(key) {
    if (!stage) return;
    const n =
      state.snapshot.nodes.find((n) => n.key === key) ||
      state.snapshot.nodes.find((n) => !n.parentKey && !n.external) ||
      state.snapshot.nodes[0];
    if (!n) return;
    const scale = Math.min(1, Math.max(0.86, (stage.clientWidth - 40) / 238));
    const container = n.childCount > 0;
    const panel = stage.parentElement.querySelector('.graph-inspector');
    const usableHeight =
      stage.clientHeight -
      (window.innerWidth < 800 && panel
        ? Math.min(panel.offsetHeight, stage.clientHeight * 0.46)
        : 0);
    state.camera = {
      scale,
      x: container ? 24 - n.x * scale : (stage.clientWidth - n.width * scale) / 2 - n.x * scale,
      y: container
        ? 24 - n.y * scale
        : Math.max(20, (usableHeight - n.height * scale) / 2) - n.y * scale,
    };
    transform();
  }
  function ensureVisible(key) {
    if (!stage || !key) return;
    const element = world.querySelector('[data-graph-select="' + CSS.escape(key) + '"]');
    if (!element) return;
    const box = element.getBoundingClientRect(),
      bounds = stage.getBoundingClientRect();
    const panel = stage.parentElement.querySelector('.graph-inspector');
    const bottom =
      window.innerWidth < 800 && panel ? panel.getBoundingClientRect().top : bounds.bottom;
    if (
      box.left < bounds.left ||
      box.right > bounds.right ||
      box.top < bounds.top ||
      box.bottom > bottom
    )
      frame(key);
  }
  function fit() {
    if (!stage) return;
    const scale = Math.max(
      0.08,
      Math.min(
        1,
        (stage.clientWidth - 48) / state.snapshot.width,
        (stage.clientHeight - 48) / state.snapshot.height,
      ),
    );
    state.camera = {
      scale,
      x: (stage.clientWidth - state.snapshot.width * scale) / 2,
      y: (stage.clientHeight - state.snapshot.height * scale) / 2,
    };
    state.cameraTouched = true;
    transform();
  }
  function zoom(factor) {
    if (!stage || !state.camera) return;
    const c = state.camera,
      scale = Math.max(0.08, Math.min(2, c.scale * factor)),
      x = stage.clientWidth / 2,
      y = stage.clientHeight / 2;
    state.camera = {
      scale,
      x: x - ((x - c.x) * scale) / c.scale,
      y: y - ((y - c.y) * scale) / c.scale,
    };
    state.cameraTouched = true;
    transform();
  }
  function attach(nextStage, nextWorld) {
    stage = nextStage;
    world = nextWorld;
    let drag = null;
    stage.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button') || !state.camera) return;
      state.cameraTouched = true;
      drag = { x: event.clientX, y: event.clientY, camera: { ...state.camera } };
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove', (event) => {
      if (!drag) return;
      state.camera = {
        ...drag.camera,
        x: drag.camera.x + event.clientX - drag.x,
        y: drag.camera.y + event.clientY - drag.y,
      };
      transform();
    });
    for (const type of ['pointerup', 'pointercancel'])
      stage.addEventListener(type, () => {
        drag = null;
      });
    stage.addEventListener('keydown', (event) => {
      if (event.target !== stage || !state.camera) return;
      const delta = {
        ArrowLeft: [40, 0],
        ArrowRight: [-40, 0],
        ArrowUp: [0, 40],
        ArrowDown: [0, -40],
      }[event.key];
      if (delta) {
        event.preventDefault();
        state.cameraTouched = true;
        state.camera.x += delta[0];
        state.camera.y += delta[1];
        transform();
      }
    });
    requestAnimationFrame(() => {
      if (state.frame) {
        frame(state.frame);
        state.frame = null;
      } else if (!state.camera) frame(state.selected);
      else transform();
    });
  }
  return { attach, frame, fit, zoom, ensureVisible };
};
`;
