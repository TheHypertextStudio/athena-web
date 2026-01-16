/**
 * Animated avatar for Athena during onboarding.
 *
 * States:
 * - idle: Subtle breathing animation with random blinks
 * - listening: Engaged, waiting for input
 * - thinking: Processing user input
 * - speaking: Delivering a message
 *
 * Respects prefers-reduced-motion for accessibility.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { AthenaState } from '@/lib/onboarding';
import { cn } from '@/lib/utils';

interface AthenaAvatarProps {
  state: AthenaState;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'w-12 h-12',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
};

/**
 * AthenaAvatar component with animated states.
 */
export function AthenaAvatar({ state, size = 'md' }: AthenaAvatarProps) {
  const prefersReducedMotion = useReducedMotion();
  const [isBlinking, setIsBlinking] = useState(false);

  // Random blink effect (3-7 second intervals, 150ms duration)
  useEffect(() => {
    if (prefersReducedMotion) return;

    const scheduleBlink = (): ReturnType<typeof setTimeout> => {
      const delay = 3000 + Math.random() * 4000; // 3-7 seconds
      return setTimeout(() => {
        setIsBlinking(true);
        setTimeout(() => {
          setIsBlinking(false);
        }, 150);
        scheduleBlink();
      }, delay);
    };

    const timeoutId = scheduleBlink();
    return () => {
      clearTimeout(timeoutId);
    };
  }, [prefersReducedMotion]);

  // Breathing animation config
  const breathingAnimation = prefersReducedMotion
    ? { scale: 1 }
    : state === 'idle'
      ? { scale: [1, 1.02, 1] }
      : { scale: 1 };

  const breathingTransition = prefersReducedMotion
    ? { duration: 0 }
    : state === 'idle'
      ? { duration: 4, repeat: Infinity, ease: 'easeInOut' as const }
      : { duration: 0.2 };

  return (
    <motion.div
      className={cn(
        'relative flex items-center justify-center rounded-full',
        'bg-primary-container',
        sizeClasses[size],
      )}
      animate={breathingAnimation}
      transition={breathingTransition}
    >
      {/* Face container */}
      <div className="flex flex-col items-center justify-center gap-2">
        {/* Eyes */}
        <div className="flex gap-3">
          <Eye
            state={state}
            isBlinking={isBlinking}
            reducedMotion={prefersReducedMotion ?? false}
          />
          <Eye
            state={state}
            isBlinking={isBlinking}
            reducedMotion={prefersReducedMotion ?? false}
          />
        </div>

        {/* Mouth */}
        <Mouth state={state} reducedMotion={prefersReducedMotion ?? false} />
      </div>

      {/* Thinking indicator */}
      {state === 'thinking' && !prefersReducedMotion && (
        <motion.div
          className="absolute -top-1 -right-1 flex gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.span
            className="bg-primary h-1.5 w-1.5 rounded-full"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
          />
          <motion.span
            className="bg-primary h-1.5 w-1.5 rounded-full"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
          />
          <motion.span
            className="bg-primary h-1.5 w-1.5 rounded-full"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
          />
        </motion.div>
      )}
      {/* Static thinking indicator for reduced motion */}
      {state === 'thinking' && prefersReducedMotion && (
        <div className="absolute -top-1 -right-1 flex gap-1">
          <span className="bg-primary h-1.5 w-1.5 rounded-full" />
          <span className="bg-primary h-1.5 w-1.5 rounded-full" />
          <span className="bg-primary h-1.5 w-1.5 rounded-full" />
        </div>
      )}
    </motion.div>
  );
}

interface EyeProps {
  state: AthenaState;
  isBlinking: boolean;
  reducedMotion: boolean;
}

function Eye({ state, isBlinking, reducedMotion }: EyeProps) {
  const eyeVariants = {
    idle: { scaleY: 1 },
    listening: { scaleY: 1.1 },
    thinking: { scaleY: 0.8 },
    speaking: { scaleY: 1 },
    blinking: { scaleY: 0.1 },
  };

  // Determine the current animation state
  const animateState = isBlinking ? 'blinking' : state;

  return (
    <motion.div
      className="bg-on-primary-container h-2 w-2 rounded-full"
      variants={eyeVariants}
      animate={animateState}
      transition={{ duration: reducedMotion ? 0 : 0.15 }}
    />
  );
}

interface MouthProps {
  state: AthenaState;
  reducedMotion: boolean;
}

function Mouth({ state, reducedMotion }: MouthProps) {
  const getMouthPath = () => {
    switch (state) {
      case 'idle':
        return 'M 0 4 Q 8 8 16 4'; // Gentle smile
      case 'listening':
        return 'M 0 4 Q 8 8 16 4'; // Same smile
      case 'thinking':
        return 'M 0 4 L 16 4'; // Neutral line
      case 'speaking':
        return 'M 0 4 Q 8 0 16 4'; // Open for speaking
      default:
        return 'M 0 4 Q 8 8 16 4';
    }
  };

  return (
    <motion.svg width="16" height="8" viewBox="0 0 16 8" className="text-on-primary-container">
      <motion.path
        d={getMouthPath()}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
        initial={false}
        animate={{ d: getMouthPath() }}
        transition={{ duration: reducedMotion ? 0 : 0.2 }}
      />
    </motion.svg>
  );
}
