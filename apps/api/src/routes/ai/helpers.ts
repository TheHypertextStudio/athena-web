/**
 * AI route helpers.
 *
 * @packageDocumentation
 */

import { KNOWN_MODELS, type AIProvider } from '../../services/ai/types.js';

export function getProviderModels(provider: AIProvider) {
  return Object.values(KNOWN_MODELS)
    .filter((model) => model.provider === provider)
    .map((model) => model.id)
    .sort();
}
