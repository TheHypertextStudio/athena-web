/**
 * Full page assistant route.
 *
 * This is the full-page view of the assistant, shown when:
 * - Direct navigation to /assistant
 * - Page refresh while on /assistant
 * - Expanding from the modal view
 *
 * Features:
 * - Full-height chat interface
 * - Back navigation to previous page
 * - Keyboard shortcuts (Cmd+K to open palette overlay)
 *
 * @packageDocumentation
 */

'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AssistantChat } from '@/components/assistant';

/**
 * Full page assistant.
 */
export default function AssistantPage() {
  const router = useRouter();

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <div className="bg-surface flex h-screen flex-col">
      {/* Header */}
      <header
        className={cn(
          'flex items-center gap-3 px-4 py-3',
          'border-outline-variant border-b',
          'bg-surface-container',
        )}
      >
        <button
          type="button"
          onClick={handleBack}
          className={cn(
            'rounded-full p-2',
            'text-on-surface-variant hover:text-on-surface',
            'hover:bg-surface-container-highest transition-colors',
            'focus-visible:ring-primary focus-visible:ring-2 focus-visible:outline-none',
          )}
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-title-lg text-on-surface font-medium">Athena Assistant</h1>
      </header>

      {/* Chat area - takes remaining height */}
      <div className="flex-1 overflow-hidden">
        <AssistantChat variant="full" className="h-full rounded-none" />
      </div>
    </div>
  );
}
