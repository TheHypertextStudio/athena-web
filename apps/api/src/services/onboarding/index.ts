/**
 * Onboarding service exports.
 *
 * @packageDocumentation
 */

export {
  getOrCreateOnboardingConversation,
  getOnboardingMessages,
  sendOnboardingMessage,
  generateOnboardingGreeting,
  generateAgendaForUser,
  type AgendaChunk,
} from './service.js';

export { ONBOARDING_TOOLS, executeOnboardingTool, type OnboardingToolContext } from './tools.js';
