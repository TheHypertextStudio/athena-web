/**
 * Test support: write helpers called the way their production entry points call them.
 *
 * @remarks
 * Each export is the real helper, wrapped in the provenance its entry point declares, for tests
 * that drive the helper directly rather than through the route, sync pass, or agent loop.
 */
import { routeInboundItemToTask as route } from '../../src/lib/automation/route-task';
import { appProvenance, athenaProvenance, ruleProvenance } from '../../src/lib/provenance/context';
import { dispatchAthenaWork as dispatch } from '../../src/routes/agent-dispatch';
import { reconcileTasks as reconcile } from '../../src/routes/integration-reconcile';
import { pullBackEntity as pullBack } from '../../src/routes/notion-mirror-reconcile';
import {
  ensureElicitationTask as ensureTask,
  raiseElicitation as raise,
} from '../../src/services/elicitation-service';
import { scoped, syncPass } from './provenance';

/** `routeInboundItemToTask`, as the automation engine runs a `task.route` action. */
export const routeInboundItemToTask = scoped(ruleProvenance('routing'), route);

/** `dispatchAthenaWork`, as `POST /v1/me/athena/sessions` calls it: as the app. */
export const dispatchAthenaWork = scoped(appProvenance(), dispatch);

/** `reconcileTasks`, as a connector sync pass calls it. */
export const reconcileTasks = scoped(syncPass('gtasks'), reconcile);

/** `pullBackEntity`, as a Notion mirror sync pass calls it. */
export const pullBackEntity = scoped(syncPass('notion'), pullBack);

/** `raiseElicitation`, as Athena's `ask_user` tool calls it. */
export const raiseElicitation = scoped(athenaProvenance('chat'), raise);

/** `ensureElicitationTask`, as Athena raising a question calls it. */
export const ensureElicitationTask = scoped(athenaProvenance('chat'), ensureTask);
