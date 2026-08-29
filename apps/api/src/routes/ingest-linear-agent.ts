/** Compatibility mount for Linear's existing Agent webhook URL. */
import {
  agentSurfaceVerificationFromEnv,
  createFixedAgentSurfaceIngestRouter,
} from './ingest-agent-surface';

/** Linear Agent webhook receiver backed by the shared verified inbox. */
const ingestLinearAgent = createFixedAgentSurfaceIngestRouter(
  'linear',
  agentSurfaceVerificationFromEnv(),
  '/linear-agent',
);

export default ingestLinearAgent;
