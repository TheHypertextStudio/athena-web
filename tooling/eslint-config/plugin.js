import noBespokeOverlay from './rules/no-bespoke-overlay.js';
import noAppOwnedColumnheader from './rules/no-app-owned-columnheader.js';
import noOverlayStyleOverride from './rules/no-overlay-style-override.js';
import noRawSurfaceRole from './rules/no-raw-surface-role.js';
import noServerQueryImport from './rules/no-server-query-import.js';

/** Custom policy rules that keep Docket UI composition inside shared primitives. */
export default {
  rules: {
    'no-app-owned-columnheader': noAppOwnedColumnheader,
    'no-bespoke-overlay': noBespokeOverlay,
    'no-overlay-style-override': noOverlayStyleOverride,
    'no-raw-surface-role': noRawSurfaceRole,
    'no-server-query-import': noServerQueryImport,
  },
};
