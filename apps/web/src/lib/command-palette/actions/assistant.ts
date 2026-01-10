/**
 * Assistant action for command palette.
 *
 * Provides the "Talk to Athena" action that switches the command palette
 * to assistant mode, enabling natural language interaction.
 *
 * @packageDocumentation
 */

import { Sparkles } from 'lucide-react';
import type { ExecutableAction } from '../types';

/**
 * "Talk to Athena" action.
 *
 * When executed, switches the command palette to assistant mode.
 * This is a special action that doesn't execute normally - it's
 * intercepted by the command palette to trigger mode switching.
 */
export const talkToAthenaAction: ExecutableAction = {
  type: 'action',
  id: 'talk-to-athena',
  label: 'Talk to Athena',
  icon: Sparkles,
  category: 'ai',
  keywords: ['assistant', 'ai', 'help', 'ask', 'chat', 'athena'],
  priority: 100,
  shortcut: {
    id: 'talk-to-athena',
    keys: 'mod+shift+a',
    scope: 'global',
    preventDefault: true,
  },
  execute: () => {
    // This action is intercepted by the command palette provider
    // to switch to assistant mode, so execute is a no-op
    return Promise.resolve({ success: true });
  },
};

/**
 * All assistant-related actions.
 */
export const assistantActions = [talkToAthenaAction];
