/**
 * Intercepted modal route for the assistant.
 *
 * When navigating to /assistant from within the app (soft navigation),
 * this intercepted route is rendered as a modal overlay instead of
 * navigating to the full page.
 *
 * Features:
 * - Modal overlay with backdrop
 * - Close returns to previous route
 * - Expand navigates to full page (/assistant)
 * - Preserves conversation state from command palette
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { cn } from '@/lib/utils';
import { AssistantChat, AssistantErrorBoundary } from '@/components/assistant';

/**
 * Assistant modal page (intercepted route).
 */
export default function AssistantModalPage() {
  const router = useRouter();

  const handleClose = useCallback(() => {
    router.back();
  }, [router]);

  const handleExpand = useCallback(() => {
    // Navigate to full page (not intercepted)
    router.push('/assistant');
  }, [router]);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <Dialog.Content
          className={cn(
            'fixed top-[10%] left-1/2 z-50 w-full max-w-2xl -translate-x-1/2',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'duration-200 outline-none',
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
          }}
        >
          <VisuallyHidden asChild>
            <Dialog.Title>Athena Assistant</Dialog.Title>
          </VisuallyHidden>
          <VisuallyHidden asChild>
            <Dialog.Description>
              Chat with Athena, your AI assistant for managing tasks, events, and productivity.
            </Dialog.Description>
          </VisuallyHidden>

          <AssistantErrorBoundary variant="modal">
            <AssistantChat variant="modal" onClose={handleClose} onExpand={handleExpand} />
          </AssistantErrorBoundary>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
