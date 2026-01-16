/**
 * Panel displaying Athena's avatar and conversation messages.
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useOnboardingStore, type OnboardingMessage } from '@/lib/onboarding';
import type { OnboardingStep } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { AthenaAvatar } from './AthenaAvatar';
import { ONBOARDING_TEST_IDS } from './test-ids';

interface AthenaPanelProps {
  step: OnboardingStep;
  className?: string;
}

/**
 * Athena panel component showing avatar and conversation.
 */
export function AthenaPanel({ step: _step, className }: AthenaPanelProps) {
  const { messages, athenaState } = useOnboardingStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center p-6 lg:p-8',
        'bg-surface-container-low',
        className,
      )}
      data-testid={ONBOARDING_TEST_IDS.athenaPanel}
    >
      {/* Avatar */}
      <div className="mb-6 flex-shrink-0">
        <AthenaAvatar state={athenaState} size="lg" />
      </div>

      {/* Messages area - accessible log region */}
      <div
        className="flex w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto"
        role="log"
        aria-label="Conversation with Athena"
        aria-live="polite"
        aria-relevant="additions"
        data-testid={ONBOARDING_TEST_IDS.athenaMessages}
      >
        <AnimatePresence mode="popLayout">
          {messages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              isLatest={index === messages.length - 1}
            />
          ))}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  message: OnboardingMessage;
  isLatest: boolean;
}

function MessageBubble({ message, isLatest }: MessageBubbleProps) {
  const isAthena = message.role === 'athena';
  const speakerLabel = isAthena ? 'Athena' : 'You';
  const prefersReducedMotion = useReducedMotion();
  const { setAthenaState } = useOnboardingStore();

  // Use typewriter effect for latest Athena message
  const useTypewriter = isAthena && isLatest && !prefersReducedMotion;

  const handleTypewriterComplete = useCallback(() => {
    setAthenaState('idle');
  }, [setAthenaState]);

  // Set speaking state when typewriter starts
  useEffect(() => {
    if (useTypewriter) {
      setAthenaState('speaking');
    }
  }, [useTypewriter, setAthenaState]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
      className={cn('flex', isAthena ? 'justify-start' : 'justify-end')}
      role="article"
      aria-label={`${speakerLabel} said`}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3',
          'text-body-medium',
          isAthena
            ? 'bg-surface-container text-on-surface rounded-bl-md'
            : 'bg-primary text-on-primary rounded-br-md',
        )}
      >
        {useTypewriter ? (
          <TypewriterText text={message.content} onComplete={handleTypewriterComplete} />
        ) : (
          message.content
        )}
      </div>
    </motion.div>
  );
}

interface TypewriterTextProps {
  text: string;
  speed?: number;
  onComplete?: () => void;
}

function TypewriterText({ text, speed = 25, onComplete }: TypewriterTextProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    if (isComplete) return;

    let currentIndex = 0;
    const intervalId = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        clearInterval(intervalId);
        setIsComplete(true);
        onComplete?.();
      }
    }, speed);

    return () => {
      clearInterval(intervalId);
    };
  }, [text, speed, onComplete, isComplete]);

  return <span>{displayedText}</span>;
}
