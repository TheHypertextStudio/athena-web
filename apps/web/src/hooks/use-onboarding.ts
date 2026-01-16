/**
 * Hook for managing onboarding state and API interactions.
 *
 * Supports AI-driven conversation where Athena uses tool calls to:
 * - Acknowledge user intent
 * - Suggest and manage integrations
 * - Generate time blocks
 * - Advance through the onboarding flow
 *
 * @packageDocumentation
 */

'use client';

import { useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  onboardingApi,
  onboardingKeys,
  type OnboardingStep,
  type OnboardingTimeBlock,
} from '@/lib/api-client';
import { useOnboardingStore } from '@/lib/onboarding';

/**
 * Tool call result from the AI.
 */
interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown> & { _result?: unknown };
}

/**
 * Hook for checking if onboarding is required.
 * Returns whether the user needs to complete onboarding.
 */
export function useOnboardingRequired() {
  const { data, isLoading, error } = useQuery({
    queryKey: onboardingKeys.status(),
    queryFn: onboardingApi.getStatus,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
  });

  const isRequired = data && !data.completedAt && !data.skippedAt;

  return {
    isRequired,
    isLoading,
    error,
    status: data,
  };
}

/**
 * Main hook for managing onboarding flow.
 */
export function useOnboarding() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const initialized = useRef(false);

  // Get store state and actions
  const store = useOnboardingStore();

  // Fetch onboarding status
  const statusQuery = useQuery({
    queryKey: onboardingKeys.status(),
    queryFn: onboardingApi.getStatus,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch intent chips
  const chipsQuery = useQuery({
    queryKey: onboardingKeys.intentChips(),
    queryFn: onboardingApi.getIntentChips,
    staleTime: Infinity,
  });

  // Initialize store when data is loaded
  useEffect(() => {
    if (statusQuery.data && !initialized.current) {
      initialized.current = true;
      store.initialize({
        currentStep: statusQuery.data.currentStep,
        metadata: statusQuery.data.metadata,
        user: statusQuery.data.user,
        isComplete: !!statusQuery.data.completedAt,
        isSkipped: !!statusQuery.data.skippedAt,
      });
    }
  }, [statusQuery.data, store]);

  // Set chips when loaded
  useEffect(() => {
    if (chipsQuery.data?.chips) {
      store.setAvailableChips(chipsQuery.data.chips);
    }
  }, [chipsQuery.data, store]);

  // Update step mutation
  const updateStepMutation = useMutation({
    mutationFn: async ({
      step,
      metadata,
    }: {
      step: OnboardingStep;
      metadata?: Record<string, unknown>;
    }) => {
      return onboardingApi.updateStep(step, metadata);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: onboardingKeys.status() });
    },
    onError: () => {
      store.setActionError('Failed to save your progress. Please try again.');
    },
  });

  // Complete mutation
  const completeMutation = useMutation({
    mutationFn: onboardingApi.complete,
    onSuccess: (data) => {
      store.complete();
      // Set cookie to cache onboarding status
      document.cookie = 'athena-onboarding-complete=true; path=/; max-age=31536000';
      router.push(data.redirectTo);
    },
    onError: () => {
      store.setActionError('Failed to finish onboarding. Please try again.');
    },
  });

  // Skip mutation
  const skipMutation = useMutation({
    mutationFn: onboardingApi.skip,
    onSuccess: (data) => {
      store.skip();
      // Set cookie to cache onboarding status
      document.cookie = 'athena-onboarding-complete=true; path=/; max-age=31536000';
      router.push(data.redirectTo);
    },
    onError: () => {
      store.setActionError('Failed to skip onboarding. Please try again.');
    },
  });

  // Navigate to next step
  const goToNextStep = useCallback(async () => {
    const { currentStep, getIntent } = store;
    store.setActionError(null);
    const steps: OnboardingStep[] = ['intent', 'integrations', 'agenda'];
    const currentIndex = steps.indexOf(currentStep);
    const nextStep = steps[currentIndex + 1];

    if (currentIndex < steps.length - 1 && nextStep) {
      // Build metadata based on current step
      let metadata: Record<string, unknown> = {};
      if (currentStep === 'intent') {
        metadata = { intent: getIntent() };
      }

      try {
        await updateStepMutation.mutateAsync({ step: nextStep, metadata });
        store.nextStep();
      } catch {
        store.setActionError('Failed to save your progress. Please try again.');
      }
    }
  }, [store, updateStepMutation]);

  // Navigate to previous step
  const goToPrevStep = useCallback(async () => {
    const { currentStep } = store;
    store.setActionError(null);
    const steps: OnboardingStep[] = ['intent', 'integrations', 'agenda'];
    const currentIndex = steps.indexOf(currentStep);
    const prevStep = steps[currentIndex - 1];

    if (currentIndex > 0 && prevStep) {
      try {
        await updateStepMutation.mutateAsync({ step: prevStep });
        store.prevStep();
      } catch {
        store.setActionError('Failed to save your progress. Please try again.');
      }
    }
  }, [store, updateStepMutation]);

  // Complete onboarding
  const completeOnboarding = useCallback(async () => {
    store.setActionError(null);
    try {
      await completeMutation.mutateAsync();
    } catch {
      store.setActionError('Failed to finish onboarding. Please try again.');
    }
  }, [completeMutation, store]);

  // Skip onboarding
  const skipOnboarding = useCallback(async () => {
    store.setActionError(null);
    try {
      await skipMutation.mutateAsync();
    } catch {
      store.setActionError('Failed to skip onboarding. Please try again.');
    }
  }, [skipMutation, store]);

  // Generate agenda
  const generateAgenda = useCallback(
    async (date: string) => {
      const {
        getIntent,
        addAgendaEntry,
        setAgendaLoading,
        setAgendaGenerated,
        setAgendaEntries,
        setActionError,
      } = store;

      setActionError(null);
      setAgendaLoading(true);
      setAgendaEntries([]);

      const isTimeBlock = (value: unknown): value is OnboardingTimeBlock => {
        if (!value || typeof value !== 'object') {
          return false;
        }
        return (value as { type?: unknown }).type === 'time_block';
      };

      try {
        const response = await onboardingApi.generateAgendaStream(date, getIntent());
        if (!response.ok) {
          throw new Error('Failed to generate agenda');
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        let readResult = await reader.read();
        while (!readResult.done) {
          const { value } = readResult;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: block')) {
              // Next line should be data
              continue;
            }
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              try {
                const parsed: unknown = JSON.parse(data);
                if (isTimeBlock(parsed)) {
                  addAgendaEntry(parsed);
                }
              } catch {
                // Ignore parse errors
              }
            }
            if (line.startsWith('event: done')) {
              setAgendaGenerated(true);
            }
          }

          readResult = await reader.read();
        }
      } catch (error) {
        console.error('Failed to generate agenda:', error);
        setActionError('Failed to generate agenda. Please try again.');
      } finally {
        setAgendaLoading(false);
      }
    },
    [store],
  );

  // ============================================================================
  // AI Conversation Methods
  // ============================================================================

  /**
   * Handle tool calls from Athena.
   * Updates store state based on what Athena decides to do.
   */
  const handleToolCall = useCallback(
    (toolCall: ToolCallResult) => {
      const { name, arguments: args } = toolCall;
      const result = args._result as Record<string, unknown> | undefined;

      switch (name) {
        case 'acknowledge_intent':
          // Athena acknowledged the user's intent - confirm it
          store.confirmIntent();
          break;

        case 'suggest_integrations':
          // Athena suggested integrations to show
          if (result && Array.isArray(result.suggested)) {
            store.setSuggestedProviders(result.suggested as string[]);
          }
          break;

        case 'get_oauth_url':
          // Athena wants to connect a calendar - open OAuth popup
          if (result && typeof result.authUrl === 'string') {
            window.open(result.authUrl, 'oauth', 'width=600,height=700');
          }
          break;

        case 'check_integration_status':
          // Athena checked integration status - update store
          if (result && Array.isArray(result.connections)) {
            for (const conn of result.connections as { provider: string; status: string }[]) {
              if (conn.status === 'connected') {
                store.setIntegrationConnected(conn.provider);
              }
            }
          }
          break;

        case 'generate_time_block':
          // Athena generated a time block - add to agenda
          if (result?.timeBlock) {
            const block = result.timeBlock as OnboardingTimeBlock;
            store.addAgendaEntry(block);
          }
          break;

        case 'get_calendar_events':
          // Athena fetched calendar events - could display them
          // For now, this is informational for Athena
          break;

        case 'advance_onboarding_step':
          // Athena decided to advance to next step
          if (result && typeof result.newStep === 'string') {
            store.setStep(result.newStep as OnboardingStep);
          }
          break;

        case 'complete_onboarding':
          // Athena completed onboarding
          if (result?.success) {
            void completeMutation.mutateAsync();
          }
          break;

        default:
          console.log('Unknown tool call:', name, args);
      }
    },
    [store, completeMutation],
  );

  /**
   * Parse SSE stream and handle events.
   */
  const parseSSEStream = useCallback(
    async (
      response: Response,
      onContent: (content: string) => void,
      onToolCall: (toolCall: ToolCallResult) => void,
      onDone: () => void,
    ) => {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

      let readResult = await reader.read();
      while (!readResult.done) {
        const { value } = readResult;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;

              switch (currentEvent) {
                case 'content':
                  if (typeof parsed.content === 'string') {
                    onContent(parsed.content);
                  }
                  break;

                case 'tool_call':
                  if (parsed.id && parsed.name) {
                    onToolCall(parsed as unknown as ToolCallResult);
                  }
                  break;

                case 'done':
                  onDone();
                  break;

                case 'error':
                  console.error('Stream error:', parsed.error);
                  break;
              }
            } catch {
              // For non-JSON data lines (like simple content)
              if (currentEvent === 'content') {
                onContent(data);
              }
            }
          } else if (line === '') {
            currentEvent = '';
          }
        }

        readResult = await reader.read();
      }
    },
    [],
  );

  /**
   * Fetch the initial greeting from Athena.
   * Uses streaming to display the message progressively.
   */
  const fetchGreeting = useCallback(async () => {
    const { setAthenaState, addMessage } = store;

    setAthenaState('thinking');

    try {
      const response = await onboardingApi.getGreetingStream();
      if (!response.ok) {
        throw new Error('Failed to fetch greeting');
      }

      setAthenaState('speaking');
      let fullContent = '';

      await parseSSEStream(
        response,
        (content) => {
          fullContent += content;
        },
        handleToolCall,
        () => {
          if (fullContent) {
            addMessage('athena', fullContent);
          }
          setAthenaState('idle');
        },
      );
    } catch (error) {
      console.error('Failed to fetch greeting:', error);
      // Fallback to default greeting
      store.addMessage('athena', 'Hey there. What brings you to Athena?');
      setAthenaState('idle');
    }
  }, [store, parseSSEStream, handleToolCall]);

  /**
   * Send a message to Athena and handle the streaming response.
   */
  const sendMessageToAthena = useCallback(
    async (message: string) => {
      const { setAthenaState, addMessage } = store;

      // Add user message to conversation
      addMessage('user', message);
      setAthenaState('thinking');

      try {
        const response = await onboardingApi.sendMessage(message);
        if (!response.ok) {
          throw new Error('Failed to send message');
        }

        setAthenaState('speaking');
        let fullContent = '';

        await parseSSEStream(
          response,
          (content) => {
            fullContent += content;
          },
          handleToolCall,
          () => {
            if (fullContent) {
              addMessage('athena', fullContent);
            }
            setAthenaState('idle');
          },
        );
      } catch (error) {
        console.error('Failed to send message:', error);
        store.addMessage('athena', "Sorry, I had trouble processing that. Let's continue.");
        setAthenaState('idle');
      }
    },
    [store, parseSSEStream, handleToolCall],
  );

  /**
   * Notify Athena about user actions (chip selection, integration connect, etc.)
   * This lets Athena respond naturally to user interactions.
   */
  const notifyAthena = useCallback(
    async (action: string, details: Record<string, unknown> = {}) => {
      // Build a natural language message describing what the user did
      let message = '';

      switch (action) {
        case 'intent_selected': {
          const chips = Array.isArray(details.chips)
            ? (details.chips as string[]).join(', ')
            : 'some options';
          message = `I selected: ${chips}`;
          if (typeof details.customText === 'string' && details.customText) {
            message += `. ${details.customText}`;
          }
          break;
        }

        case 'integration_connected': {
          const provider = typeof details.provider === 'string' ? details.provider : 'my';
          message = `I connected my ${provider} calendar.`;
          break;
        }

        case 'integration_skipped':
          message = "I'll skip connecting calendars for now.";
          break;

        case 'ready_for_agenda':
          message = "I'm ready to see my agenda.";
          break;

        case 'agenda_approved':
          message = "This looks good, let's go!";
          break;

        default:
          return; // Unknown action, don't send
      }

      await sendMessageToAthena(message);
    },
    [sendMessageToAthena],
  );

  return {
    // State
    ...store,
    isLoading: statusQuery.isLoading || store.isLoading,
    error: statusQuery.error?.message ?? store.error,

    // Actions
    goToNextStep,
    goToPrevStep,
    completeOnboarding,
    skipOnboarding,
    generateAgenda,

    // AI Conversation Actions
    fetchGreeting,
    sendMessageToAthena,
    notifyAthena,

    // Mutation states
    isUpdating: updateStepMutation.isPending,
    isCompleting: completeMutation.isPending,
    isSkipping: skipMutation.isPending,
  };
}
