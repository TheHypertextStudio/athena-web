/**
 * Zustand store for onboarding state management.
 *
 * Manages the 3-step onboarding flow:
 * 1. Intent - User shares why they're using Athena
 * 2. Integrations - User connects calendar/task sources
 * 3. Agenda - AI generates personalized agenda
 *
 * @packageDocumentation
 */

import { create } from 'zustand';
import type {
  OnboardingStep,
  OnboardingMetadata,
  OnboardingIntent,
  IntentChip,
  OnboardingTimeBlock,
} from '@/lib/api-client';

/**
 * Athena avatar animation state.
 */
export type AthenaState = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * Integration connection status.
 */
export type IntegrationStatus = 'idle' | 'connecting' | 'syncing' | 'success' | 'error';

/**
 * Integration entry in the store.
 */
export interface IntegrationEntry {
  provider: string;
  status: IntegrationStatus;
  error: string | null;
  connectedAt: Date | null;
  syncedEventsCount?: number;
}

/**
 * Athena message in the conversation.
 */
export interface OnboardingMessage {
  id: string;
  role: 'athena' | 'user';
  content: string;
  timestamp: Date;
}

/**
 * Onboarding store state.
 */
interface OnboardingState {
  // Core navigation
  currentStep: OnboardingStep;
  isLoading: boolean;
  error: string | null;
  actionError: string | null;

  // User data
  userName: string | null;
  userEmail: string | null;

  // Intent data
  availableChips: IntentChip[];
  selectedChips: string[];
  customText: string;
  intentConfirmed: boolean;

  // Conversation
  messages: OnboardingMessage[];
  athenaState: AthenaState;

  // Integrations
  integrations: IntegrationEntry[];
  suggestedProviders: string[];

  // Agenda
  agendaEntries: OnboardingTimeBlock[];
  agendaLoading: boolean;
  agendaGenerated: boolean;

  // Meta
  isComplete: boolean;
  isSkipped: boolean;
  hasUnsavedChanges: boolean;
}

/**
 * Onboarding store actions.
 */
interface OnboardingActions {
  // Initialization
  initialize: (data: {
    currentStep: OnboardingStep;
    metadata: OnboardingMetadata;
    user: { name: string; email: string } | null;
    isComplete: boolean;
    isSkipped: boolean;
  }) => void;
  setAvailableChips: (chips: IntentChip[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setActionError: (error: string | null) => void;

  // Step navigation
  setStep: (step: OnboardingStep) => void;
  nextStep: () => void;
  prevStep: () => void;

  // Intent actions
  toggleChip: (chipId: string) => void;
  setCustomText: (text: string) => void;
  confirmIntent: () => void;

  // Conversation actions
  addMessage: (role: 'athena' | 'user', content: string) => void;
  setAthenaState: (state: AthenaState) => void;

  // Integration actions
  setSuggestedProviders: (providers: string[]) => void;
  setIntegrationStatus: (provider: string, status: IntegrationStatus, error?: string) => void;
  setIntegrationConnected: (provider: string, syncedCount?: number) => void;

  // Agenda actions
  setAgendaLoading: (loading: boolean) => void;
  addAgendaEntry: (entry: OnboardingTimeBlock) => void;
  setAgendaEntries: (entries: OnboardingTimeBlock[]) => void;
  updateAgendaEntry: (id: string, updates: Partial<OnboardingTimeBlock>) => void;
  removeAgendaEntry: (index: number) => void;
  setAgendaGenerated: (generated: boolean) => void;

  // Completion actions
  complete: () => void;
  skip: () => void;
  reset: () => void;

  // Helpers
  getIntent: () => OnboardingIntent;
  canProceed: () => boolean;
}

const STEP_ORDER: OnboardingStep[] = ['intent', 'integrations', 'agenda'];

const initialState: OnboardingState = {
  currentStep: 'intent',
  isLoading: true,
  error: null,
  actionError: null,
  userName: null,
  userEmail: null,
  availableChips: [],
  selectedChips: [],
  customText: '',
  intentConfirmed: false,
  messages: [],
  athenaState: 'idle',
  integrations: [],
  suggestedProviders: ['google_calendar', 'outlook_calendar', 'apple_calendar'],
  agendaEntries: [],
  agendaLoading: false,
  agendaGenerated: false,
  isComplete: false,
  isSkipped: false,
  hasUnsavedChanges: false,
};

/**
 * Onboarding Zustand store.
 */
export const useOnboardingStore = create<OnboardingState & OnboardingActions>((set, get) => ({
  ...initialState,

  // Initialization
  initialize: (data) => {
    const { currentStep, metadata, user, isComplete, isSkipped } = data;

    // Restore integrations from metadata
    const integrations: IntegrationEntry[] =
      metadata.integrations?.map((i) => ({
        provider: i.provider,
        status: 'success' as IntegrationStatus,
        error: null,
        connectedAt: new Date(i.connectedAt),
        syncedEventsCount: i.syncedEventsCount,
      })) ?? [];

    set({
      currentStep,
      isLoading: false,
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
      selectedChips: metadata.intent?.selectedChips ?? [],
      customText: metadata.intent?.customText ?? '',
      intentConfirmed: !!metadata.intent?.confirmedAt,
      integrations,
      agendaGenerated: metadata.agendaGenerated ?? false,
      isComplete,
      isSkipped,
      actionError: null,
    });
  },

  setAvailableChips: (chips) => {
    set({ availableChips: chips });
  },
  setLoading: (loading) => {
    set({ isLoading: loading });
  },
  setError: (error) => {
    set({ error });
  },
  setActionError: (error) => {
    set({ actionError: error });
  },

  // Step navigation
  setStep: (step) => {
    set({ currentStep: step });
  },

  nextStep: () => {
    const { currentStep } = get();
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      set({ currentStep: STEP_ORDER[currentIndex + 1] });
    }
  },

  prevStep: () => {
    const { currentStep } = get();
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      set({ currentStep: STEP_ORDER[currentIndex - 1] });
    }
  },

  // Intent actions
  toggleChip: (chipId) => {
    const { selectedChips } = get();
    const newChips = selectedChips.includes(chipId)
      ? selectedChips.filter((id) => id !== chipId)
      : [...selectedChips, chipId];
    set({ selectedChips: newChips, hasUnsavedChanges: true });
  },

  setCustomText: (text) => {
    set({ customText: text, hasUnsavedChanges: true });
  },

  confirmIntent: () => {
    set({ intentConfirmed: true });
  },

  // Conversation actions
  addMessage: (role, content) => {
    const message: OnboardingMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: new Date(),
    };
    set((state) => ({ messages: [...state.messages, message] }));
  },

  setAthenaState: (state) => {
    set({ athenaState: state });
  },

  // Integration actions
  setSuggestedProviders: (providers) => {
    set({ suggestedProviders: providers });
  },

  setIntegrationStatus: (provider, status, error) => {
    set((state) => {
      const existing = state.integrations.find((i) => i.provider === provider);
      if (existing) {
        return {
          integrations: state.integrations.map((i) =>
            i.provider === provider ? { ...i, status, error: error ?? null } : i,
          ),
        };
      }
      return {
        integrations: [
          ...state.integrations,
          { provider, status, error: error ?? null, connectedAt: null },
        ],
      };
    });
  },

  setIntegrationConnected: (provider, syncedCount) => {
    set((state) => ({
      integrations: state.integrations.map((i) =>
        i.provider === provider
          ? { ...i, status: 'success', connectedAt: new Date(), syncedEventsCount: syncedCount }
          : i,
      ),
      hasUnsavedChanges: true,
    }));
  },

  // Agenda actions
  setAgendaLoading: (loading) => {
    set({ agendaLoading: loading });
  },

  addAgendaEntry: (entry) => {
    set((state) => ({
      agendaEntries: [...state.agendaEntries, entry].sort((a, b) =>
        a.startTime.localeCompare(b.startTime),
      ),
    }));
  },

  setAgendaEntries: (entries) => {
    set({ agendaEntries: entries.sort((a, b) => a.startTime.localeCompare(b.startTime)) });
  },

  updateAgendaEntry: (id, updates) => {
    // ID format is 'onboarding-{index}'
    const index = parseInt(id.replace('onboarding-', ''), 10);
    if (isNaN(index)) return;

    set((state) => {
      const entries = [...state.agendaEntries];
      const entry = entries[index];
      if (!entry) return state;

      entries[index] = { ...entry, ...updates };
      return {
        agendaEntries: entries.sort((a, b) => a.startTime.localeCompare(b.startTime)),
        hasUnsavedChanges: true,
      };
    });
  },

  removeAgendaEntry: (index) => {
    set((state) => ({
      agendaEntries: state.agendaEntries.filter((_, i) => i !== index),
      hasUnsavedChanges: true,
    }));
  },

  setAgendaGenerated: (generated) => {
    set({ agendaGenerated: generated });
  },

  // Completion actions
  complete: () => {
    set({ isComplete: true });
  },
  skip: () => {
    set({ isSkipped: true });
  },
  reset: () => {
    set(initialState);
  },

  // Helpers
  getIntent: () => ({
    selectedChips: get().selectedChips,
    customText: get().customText || null,
    confirmedAt: get().intentConfirmed ? new Date().toISOString() : null,
  }),

  canProceed: () => {
    const state = get();
    switch (state.currentStep) {
      case 'intent':
        return state.selectedChips.length > 0 || state.customText.trim().length > 0;
      case 'integrations':
        return true; // Can always proceed (integrations are optional)
      case 'agenda':
        return state.agendaGenerated;
      default:
        return false;
    }
  },
}));
