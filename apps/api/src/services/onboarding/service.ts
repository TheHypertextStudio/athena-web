/**
 * Onboarding service.
 *
 * Manages onboarding progress and conversation state.
 * AI conversation is now handled by the general AI service with context: "onboarding".
 * Agenda generation is handled by the time-blocks service.
 *
 * @packageDocumentation
 */

import { db } from '../../db/index.js';
import { onboardingProgress, conversations } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { getAIService } from '../ai/service.js';

/**
 * Get or create an onboarding conversation.
 *
 * This is used when the frontend calls /api/ai/chat with context: "onboarding"
 * to ensure there's a conversation associated with the onboarding flow.
 */
export async function getOrCreateOnboardingConversation(userId: string): Promise<string> {
  const progress = await db.query.onboardingProgress.findFirst({
    where: eq(onboardingProgress.userId, userId),
  });

  // Check if there's already a conversation ID in metadata
  const metadata = progress?.metadata as Record<string, unknown> | null;
  const existingConversationId = metadata?.conversationId;
  if (typeof existingConversationId === 'string') {
    return existingConversationId;
  }

  // Create a new conversation
  const aiService = getAIService();
  const conversationId = await aiService.createConversation(userId, 'Onboarding');

  // Store the conversation ID in onboarding progress
  const now = new Date();
  if (progress) {
    await db
      .update(onboardingProgress)
      .set({
        metadata: { ...(metadata ?? {}), conversationId },
        updatedAt: now,
      })
      .where(eq(onboardingProgress.id, progress.id));
  } else {
    await db.insert(onboardingProgress).values({
      id: crypto.randomUUID(),
      userId,
      currentStep: 'intent',
      metadata: { conversationId },
      createdAt: now,
      updatedAt: now,
    });
  }

  return conversationId;
}

/**
 * Update conversation timestamp.
 */
export async function updateConversationTimestamp(conversationId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}
