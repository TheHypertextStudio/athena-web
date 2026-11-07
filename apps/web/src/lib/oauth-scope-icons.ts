import { Cable, Edit, Play, RefreshCw, TaskAlt } from '@docket/ui/icons';
import type { ComponentType } from 'react';

/** Icons for permissions Docket can grant; unknown permissions use the screen's fallback. */
export const OAUTH_SCOPE_ICON: Readonly<Record<string, ComponentType<{ className?: string }>>> = {
  'work:read': TaskAlt,
  'work:write': Edit,
  'time:progress': TaskAlt,
  'agents:run': Play,
  'connectors:link': Cable,
  offline_access: RefreshCw,
};
