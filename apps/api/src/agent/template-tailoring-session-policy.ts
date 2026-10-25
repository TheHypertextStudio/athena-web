import type { SessionRow } from '../routes/agent-session-helpers';
import { mailSessionAuthorized } from '../services/athena-mail/session-auth';
import { notificationTriageBrief } from '../services/device-notifications/triage-context';
import { tailoredSessionAuthorized } from './template-tailoring';

/** Recheck each persisted execution policy without widening the runner's admission state machine. */
export async function sessionGenerationAuthorized(session: SessionRow): Promise<boolean> {
  return (await mailSessionAuthorized(session)) && (await tailoredSessionAuthorized(session));
}
/** Recheck source context after a provider turn and before persisting its proposed actions. */
export async function turnContextAuthorized(session: SessionRow): Promise<boolean> {
  return (
    (await notificationTriageBrief(session)) !== null && (await tailoredSessionAuthorized(session))
  );
}
