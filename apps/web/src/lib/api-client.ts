/**
 * API client for communicating with the Athena backend.
 *
 * @packageDocumentation
 */

import { env } from './env';

const API_BASE_URL = env.API_URL;
type EmptyResponse = Record<string, never>;

/**
 * API error with status code and message.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorResponse {
  message?: string;
  error?: string;
}

/**
 * Make an authenticated API request.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  if (options.headers) {
    const optionHeaders = new Headers(options.headers);
    optionHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!response.ok) {
    let errorMessage = 'Request failed';
    try {
      const errorData = (await response.json()) as ErrorResponse;
      if (errorData.message) {
        errorMessage = errorData.message;
      } else if (errorData.error) {
        errorMessage = errorData.error;
      }
    } catch {
      // Use default error message if JSON parsing fails
    }
    throw new ApiError(response.status, errorMessage);
  }

  // Handle empty responses (204 No Content, etc.)
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return {} as T;
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

// ============================================================================
// Task Status Types
// ============================================================================

export type TaskStatusCategory = 'not_started' | 'in_progress' | 'done' | 'cancelled';

export interface CustomTaskStatus {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  category: TaskStatusCategory;
  color: string;
  icon: string | null;
  position: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GroupedTaskStatuses {
  not_started: CustomTaskStatus[];
  in_progress: CustomTaskStatus[];
  done: CustomTaskStatus[];
  cancelled: CustomTaskStatus[];
}

export interface CreateTaskStatusInput {
  name: string;
  description?: string;
  category: TaskStatusCategory;
  color: string;
  icon?: string;
  workspaceId?: string;
}

export interface UpdateTaskStatusInput {
  name?: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
}

export interface ReorderTaskStatusesInput {
  category: TaskStatusCategory;
  statusIds: string[];
  workspaceId?: string;
}

// ============================================================================
// Task Types
// ============================================================================

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  deadline: string | null;
  estimatedMinutes: number | null;
  projectId: string | null;
  assigneeId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: Task['status'];
  priority?: Task['priority'];
  deadline?: string;
  estimatedMinutes?: number;
  projectId?: string;
  tagIds?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: Task['status'];
  priority?: Task['priority'];
  deadline?: string | null;
  estimatedMinutes?: number | null;
  projectId?: string | null;
  assigneeId?: string | null;
  tagIds?: string[];
}

// ============================================================================
// Project Types
// ============================================================================

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  initiativeId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Initiative Types
// ============================================================================

export interface Initiative {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'completed' | 'archived';
  parentId: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Event Types
// ============================================================================

export type EventSource = 'local' | 'external';

export interface Event {
  id: string;
  title: string;
  description: string | null;
  startTime: string;
  endTime: string | null;
  location: string | null;
  isAllDay: boolean;
  recurrenceRule: string | null;
  ownerId: string;
  /** Source of the event: 'local' for Athena-native, 'external' for synced calendars */
  source: EventSource;
  /** Integration ID for external events (null for local events) */
  sourceIntegrationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  startTime: string;
  endTime?: string;
  location?: string;
  isAllDay?: boolean;
}

// ============================================================================
// Time Block Types
// ============================================================================

export interface TimeBlockLinkedTask {
  id: string;
  title: string;
  status: Task['status'];
  priority: Task['priority'];
  position: number;
}

export interface TimeBlock {
  id: string;
  label: string;
  description: string | null;
  startTime: string;
  endTime: string;
  color: string | null;
  recurrenceRule: string | null;
  ownerId: string;
  linkedTasks: TimeBlockLinkedTask[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTimeBlockInput {
  label: string;
  description?: string;
  startTime: string;
  endTime: string;
  color?: string;
  recurrenceRule?: string;
  taskIds?: string[];
}

export interface UpdateTimeBlockInput {
  label?: string;
  description?: string | null;
  startTime?: string;
  endTime?: string;
  color?: string | null;
  recurrenceRule?: string | null;
}

// ============================================================================
// Activity Types
// ============================================================================

export interface Activity {
  id: string;
  streamId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Task Statuses API
 */
export const taskStatusesApi = {
  list: (params?: { workspaceId?: string; category?: TaskStatusCategory }) => {
    const searchParams = new URLSearchParams();
    if (params?.workspaceId) searchParams.set('workspaceId', params.workspaceId);
    if (params?.category) searchParams.set('category', params.category);
    const query = searchParams.toString();
    return request<{ data: CustomTaskStatus[] }>(`/api/task-statuses${query ? `?${query}` : ''}`);
  },
  listGrouped: (workspaceId?: string) => {
    const query = workspaceId ? `?workspaceId=${workspaceId}` : '';
    return request<{ data: GroupedTaskStatuses }>(`/api/task-statuses/grouped${query}`);
  },
  get: (id: string) => request<{ data: CustomTaskStatus }>(`/api/task-statuses/${id}`),
  create: (data: CreateTaskStatusInput) =>
    request<{ data: CustomTaskStatus }>('/api/task-statuses', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateTaskStatusInput) =>
    request<{ data: CustomTaskStatus }>(`/api/task-statuses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<EmptyResponse>(`/api/task-statuses/${id}`, {
      method: 'DELETE',
    }),
  reorder: (data: ReorderTaskStatusesInput) =>
    request<{ data: CustomTaskStatus[] }>('/api/task-statuses/reorder', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  setDefault: (id: string, workspaceId?: string) =>
    request<{ data: CustomTaskStatus }>(`/api/task-statuses/${id}/set-default`, {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),
};

/**
 * Query keys for task statuses.
 */
export const taskStatusKeys = {
  all: ['task-statuses'] as const,
  lists: () => [...taskStatusKeys.all, 'list'] as const,
  list: (params?: { workspaceId?: string; category?: TaskStatusCategory }) =>
    [...taskStatusKeys.lists(), params] as const,
  grouped: (workspaceId?: string) => [...taskStatusKeys.all, 'grouped', workspaceId] as const,
  details: () => [...taskStatusKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskStatusKeys.details(), id] as const,
};

/**
 * Tasks API
 */
export const tasksApi = {
  list: (params?: { status?: Task['status']; priority?: Task['priority']; projectId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.priority) searchParams.set('priority', params.priority);
    if (params?.projectId) searchParams.set('projectId', params.projectId);
    const query = searchParams.toString();
    return request<{ data: Task[] }>(`/api/tasks${query ? `?${query}` : ''}`);
  },
  get: (id: string) => request<{ data: Task }>(`/api/tasks/${id}`),
  create: (data: CreateTaskInput) =>
    request<{ data: Task }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateTaskInput) =>
    request<{ data: Task }>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/tasks/${id}`, {
      method: 'DELETE',
    }),
  getDependencies: (id: string) => request<{ data: Task[] }>(`/api/tasks/${id}/dependencies`),
  addDependency: (id: string, dependsOnId: string) =>
    request<EmptyResponse>(`/api/tasks/${id}/dependencies/${dependsOnId}`, {
      method: 'POST',
    }),
  removeDependency: (id: string, dependsOnId: string) =>
    request<EmptyResponse>(`/api/tasks/${id}/dependencies/${dependsOnId}`, {
      method: 'DELETE',
    }),
};

/**
 * Projects API
 */
export const projectsApi = {
  list: (params?: { status?: Project['status']; initiativeId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    if (params?.initiativeId) searchParams.set('initiativeId', params.initiativeId);
    const query = searchParams.toString();
    return request<{ data: Project[] }>(`/api/projects${query ? `?${query}` : ''}`);
  },
  get: (id: string) => request<{ data: Project }>(`/api/projects/${id}`),
};

/**
 * Initiatives API
 */
export const initiativesApi = {
  list: (params?: { status?: Initiative['status'] }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.set('status', params.status);
    const query = searchParams.toString();
    return request<{ data: Initiative[] }>(`/api/initiatives${query ? `?${query}` : ''}`);
  },
  get: (id: string) => request<{ data: Initiative }>(`/api/initiatives/${id}`),
};

/**
 * Events API
 */
export const eventsApi = {
  list: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    const query = searchParams.toString();
    return request<{ data: Event[] }>(`/api/events${query ? `?${query}` : ''}`);
  },
  get: (id: string) => request<{ data: Event }>(`/api/events/${id}`),
  create: (data: CreateEventInput) =>
    request<{ data: Event }>('/api/events', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<CreateEventInput>) =>
    request<{ data: Event }>(`/api/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<EmptyResponse>(`/api/events/${id}`, {
      method: 'DELETE',
    }),
};

/**
 * Query keys for events.
 */
export const eventKeys = {
  all: ['events'] as const,
  lists: () => [...eventKeys.all, 'list'] as const,
  list: (params?: { startDate?: string; endDate?: string }) =>
    [...eventKeys.lists(), params] as const,
  details: () => [...eventKeys.all, 'detail'] as const,
  detail: (id: string) => [...eventKeys.details(), id] as const,
};

/**
 * Activities API
 */
export const activitiesApi = {
  list: (streamId: string, params?: { limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const query = searchParams.toString();
    return request<{ data: Activity[] }>(`/api/activities/${streamId}${query ? `?${query}` : ''}`);
  },
};

// ============================================================================
// Settings Types
// ============================================================================

export interface UserSettings {
  preferredName: string | null;
  timezone: string;
  dailyPlanningTime: string | null;
  dailyReviewTime: string | null;
  encryptionEnabled: boolean;
}

export interface UpdateSettingsInput {
  preferredName?: string | null;
  timezone?: string;
  dailyPlanningTime?: string | null;
  dailyReviewTime?: string | null;
  encryptionEnabled?: boolean;
}

// ============================================================================
// Account Types
// ============================================================================

export interface AccountOverview {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  stats: {
    initiatives: number;
    projects: number;
    tasks: number;
    events: number;
  };
}

// ============================================================================
// Billing Types
// ============================================================================

export type PlanTier = 'free' | 'pro' | 'team';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'paused';

export interface Subscription {
  planTier: PlanTier;
  status: SubscriptionStatus;
  entitlements: string[];
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  limits: Record<string, number | undefined>;
}

export interface Invoice {
  id: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  amountDue: number;
  amountPaid: number;
  currency: string;
  invoicePdfUrl?: string;
  hostedInvoiceUrl?: string;
  createdAt: string;
  paidAt?: string;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account' | 'other';
  isDefault: boolean;
  card?: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
  };
}

// ============================================================================
// Integration Types
// ============================================================================

export type IntegrationProvider =
  | 'linear'
  | 'github'
  | 'todoist'
  | 'asana'
  | 'jira'
  | 'trello'
  | 'google_calendar'
  | 'outlook_calendar'
  | 'apple_calendar'
  | 'caldav_calendar'
  | 'slack'
  | 'zoom'
  | 'google_drive'
  | 'dropbox'
  | 'figma';

export interface Integration {
  id: string;
  provider: IntegrationProvider;
  externalAccountId: string;
  scopes: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Notification Types
// ============================================================================

export interface NotificationPreferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  slackEnabled: boolean;
  inAppEnabled: boolean;
  emailAddress?: string;
  phoneNumber?: string;
  slackWebhookUrl?: string;
  slackChannel?: string;
  quietHoursEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  quietHoursTimezone?: string;
  taskDeadlineReminders: boolean;
  taskAssignmentNotifications: boolean;
  taskCompletionNotifications: boolean;
  eventReminders: boolean;
  dailyPlanningReminder: boolean;
  weeklyReviewReminder: boolean;
}

// ============================================================================
// AI Types
// ============================================================================

export type AIProvider = 'openai' | 'anthropic';

export interface AIPreferences {
  preferredProvider?: AIProvider;
  preferredModel?: string;
}

export interface AIProviderInfo {
  providers: AIProvider[];
  default: AIProvider;
}

// ============================================================================
// Auth/Session Types
// ============================================================================

export interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export interface LinkedAccount {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
}

export interface BackupCodesInfo {
  hasBackupCodes: boolean;
  remainingCount: number;
  generatedAt?: string;
}

export interface Passkey {
  id: string;
  name: string | null;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
}

// ============================================================================
// Settings API
// ============================================================================

export const settingsApi = {
  get: () => request<{ data: UserSettings }>('/api/settings'),
  update: (data: UpdateSettingsInput) =>
    request<{ data: UserSettings }>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

// ============================================================================
// Account API
// ============================================================================

export const accountApi = {
  get: () => request<{ data: AccountOverview }>('/api/account'),
  export: () => request<Blob>('/api/account/export'),
  delete: (confirmation: string) =>
    request<EmptyResponse>('/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ confirmation }),
    }),
};

// ============================================================================
// Billing API
// ============================================================================

export const billingApi = {
  getSubscription: () => request<{ data: Subscription }>('/api/billing/subscription'),
  getPlans: () => request<{ data: { plans: Plan[] } }>('/api/billing/plans'),
  getInvoices: (limit?: number) => {
    const params = limit ? `?limit=${String(limit)}` : '';
    return request<{ data: { invoices: Invoice[] } }>(`/api/billing/invoices${params}`);
  },
  getPaymentMethods: () =>
    request<{ data: { paymentMethods: PaymentMethod[] } }>('/api/billing/payment-methods'),
  createCheckout: (data: {
    planTier: 'pro' | 'team';
    billingInterval?: 'month' | 'year';
    successUrl: string;
    cancelUrl: string;
  }) =>
    request<{ data: { checkoutUrl: string; sessionId: string } }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  createPortal: (returnUrl: string) =>
    request<{ data: { portalUrl: string } }>('/api/billing/portal', {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    }),
  cancel: () => request<{ data: { message: string } }>('/api/billing/cancel', { method: 'POST' }),
  resume: () => request<{ data: { message: string } }>('/api/billing/resume', { method: 'POST' }),
  setDefaultPaymentMethod: (id: string) =>
    request<{ data: { message: string } }>(`/api/billing/payment-methods/${id}/default`, {
      method: 'POST',
    }),
  deletePaymentMethod: (id: string) =>
    request<EmptyResponse>(`/api/billing/payment-methods/${id}`, { method: 'DELETE' }),
};

// ============================================================================
// Integrations API
// ============================================================================

export const integrationsApi = {
  list: () => request<{ data: Integration[] }>('/api/integrations'),
  get: (id: string) => request<{ data: Integration }>(`/api/integrations/${id}`),
  getOAuthUrl: (provider: IntegrationProvider, redirectUri: string) =>
    request<{ data: { authorizationUrl: string; configured: boolean } }>(
      `/api/integrations/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`,
    ),
  disconnect: (id: string) =>
    request<EmptyResponse>(`/api/integrations/${id}`, { method: 'DELETE' }),
};

// ============================================================================
// Notifications API
// ============================================================================

export const notificationsApi = {
  getPreferences: () =>
    request<{ success: boolean; data: NotificationPreferences }>('/api/notifications/preferences'),
  updatePreferences: (data: Partial<NotificationPreferences>) =>
    request<{ success: boolean; data: NotificationPreferences }>('/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
};

// ============================================================================
// AI API
// ============================================================================

export const aiApi = {
  getPreferences: () => request<{ data: AIPreferences }>('/api/ai/preferences'),
  updatePreferences: (data: Partial<AIPreferences>) =>
    request<{ success: boolean }>('/api/ai/preferences', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  getProviders: () => request<{ data: AIProviderInfo }>('/api/ai/providers'),
};

// ============================================================================
// Auth API (for settings)
// ============================================================================

export const authApi = {
  getSessions: () => request<{ sessions: Session[]; count: number }>('/api/auth/sessions'),
  revokeSession: (sessionId: string) =>
    request<EmptyResponse>(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' }),
  revokeAllSessions: () =>
    request<{ success: boolean; message: string }>('/api/auth/sessions/revoke-all', {
      method: 'POST',
    }),
  getLinkedAccounts: () =>
    request<{ accounts: LinkedAccount[]; count: number }>('/api/auth/linked-accounts'),
  unlinkAccount: (accountId: string) =>
    request<EmptyResponse>(`/api/auth/linked-accounts/${accountId}`, { method: 'DELETE' }),
  getBackupCodes: () => request<BackupCodesInfo>('/api/auth/backup-codes'),
  generateBackupCodes: () =>
    request<{ codes: string[]; message: string; count: number }>(
      '/api/auth/backup-codes/generate',
      {
        method: 'POST',
      },
    ),
  getPasskeys: () => request<{ passkeys: Passkey[]; count: number }>('/api/auth/passkeys'),
  renamePasskey: (passkeyId: string, name: string) =>
    request<{ success: boolean; name: string }>(`/api/auth/passkeys/${passkeyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deletePasskey: (passkeyId: string) =>
    request<EmptyResponse>(`/api/auth/passkeys/${passkeyId}`, { method: 'DELETE' }),
};

// ============================================================================
// Time Blocks API
// ============================================================================

/**
 * Time Blocks API
 */
export const timeBlocksApi = {
  list: (params?: { startDate?: string; endDate?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);
    const query = searchParams.toString();
    return request<{ data: TimeBlock[] }>(`/api/time-blocks${query ? `?${query}` : ''}`);
  },
  get: (id: string) => request<{ data: TimeBlock }>(`/api/time-blocks/${id}`),
  create: (data: CreateTimeBlockInput) =>
    request<{ data: TimeBlock }>('/api/time-blocks', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateTimeBlockInput) =>
    request<{ data: TimeBlock }>(`/api/time-blocks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    request<EmptyResponse>(`/api/time-blocks/${id}`, {
      method: 'DELETE',
    }),
  linkTask: (id: string, taskId: string, position?: number) =>
    request<{ success: boolean }>(`/api/time-blocks/${id}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ taskId, position }),
    }),
  unlinkTask: (id: string, taskId: string) =>
    request<EmptyResponse>(`/api/time-blocks/${id}/tasks/${taskId}`, {
      method: 'DELETE',
    }),
  reorderTasks: (id: string, taskIds: string[]) =>
    request<{ success: boolean }>(`/api/time-blocks/${id}/tasks/order`, {
      method: 'PUT',
      body: JSON.stringify({ taskIds }),
    }),
};

/**
 * Query keys for time blocks.
 */
export const timeBlockKeys = {
  all: ['time-blocks'] as const,
  lists: () => [...timeBlockKeys.all, 'list'] as const,
  list: (params?: { startDate?: string; endDate?: string }) =>
    [...timeBlockKeys.lists(), params] as const,
  details: () => [...timeBlockKeys.all, 'detail'] as const,
  detail: (id: string) => [...timeBlockKeys.details(), id] as const,
};

// ============================================================================
// Calendar Sync Types
// ============================================================================

export type CalendarProvider = 'google' | 'outlook' | 'icloud' | 'caldav';
export type SyncDirection = 'pull' | 'push' | 'bidirectional';

export interface SyncedCalendar {
  id: string;
  externalId: string;
  name: string;
  color?: string;
  isPrimary: boolean;
  canEdit?: boolean;
  syncEnabled: boolean;
  syncDirection: SyncDirection;
}

export interface CalendarConnection {
  id: string;
  provider: CalendarProvider;
  /** User-defined label for this account (e.g., "Work", "Personal") */
  accountLabel: string | null;
  /** Email address from OAuth profile for display */
  accountEmail: string | null;
  /** Color for account indicator in calendar view (hex code) */
  accountColor: string | null;
  /** Whether this is the primary account for the provider (used for event creation default) */
  isPrimary: boolean;
  /** Display order for account list UI (0 = first) */
  displayOrder: number;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'success' | 'error' | null;
  lastSyncError: string | null;
  calendars: SyncedCalendar[];
  createdAt: string;
}

export interface AccountSettingsUpdate {
  accountLabel?: string;
  accountColor?: string;
  isPrimary?: boolean;
  displayOrder?: number;
}

export interface SyncResult {
  success: boolean;
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
  errors: { eventId?: string; operation: string; error: string }[];
  syncedAt?: string;
}

export interface SyncAllResult {
  connectionId: string;
  provider: CalendarProvider;
  success: boolean;
  eventsCreated?: number;
  eventsUpdated?: number;
  eventsDeleted?: number;
  errors?: { eventId?: string; operation: string; error: string }[];
  error?: string;
}

// ============================================================================
// Calendar Sync API
// ============================================================================

/**
 * Calendar Sync API
 */
export const calendarSyncApi = {
  /**
   * Get all calendar connections.
   */
  getConnections: () =>
    request<{ success: boolean; data: CalendarConnection[] }>('/api/calendar-sync/connections'),

  /**
   * Get OAuth URL for a provider.
   */
  getAuthUrl: (provider: CalendarProvider) =>
    request<{ success: boolean; data: { authUrl: string } }>(`/api/calendar-sync/auth/${provider}`),

  /**
   * Handle OAuth callback.
   */
  handleCallback: (provider: CalendarProvider, code: string, state: string) =>
    request<{
      success: boolean;
      data: {
        id: string;
        provider: CalendarProvider;
        accountLabel: string | null;
        accountEmail: string | null;
        accountColor: string | null;
        isPrimary: boolean;
        displayOrder: number;
        calendars: SyncedCalendar[];
      };
    }>('/api/calendar-sync/callback', {
      method: 'POST',
      body: JSON.stringify({ provider, code, state }),
    }),

  /**
   * Update sync settings for a connection.
   */
  updateSettings: (
    connectionId: string,
    calendars: { id: string; syncEnabled: boolean; syncDirection: SyncDirection }[],
  ) =>
    request<{ success: boolean }>(`/api/calendar-sync/connections/${connectionId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ calendars }),
    }),

  /**
   * Update account settings (label, color, primary status).
   */
  updateAccountSettings: (connectionId: string, settings: AccountSettingsUpdate) =>
    request<{ success: boolean }>(`/api/calendar-sync/connections/${connectionId}/account`, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),

  /**
   * Reorder accounts by updating displayOrder.
   */
  reorderAccounts: (connectionIds: string[]) =>
    request<{ success: boolean }>('/api/calendar-sync/connections/reorder', {
      method: 'PUT',
      body: JSON.stringify({ connectionIds }),
    }),

  /**
   * Trigger sync for a connection.
   */
  triggerSync: (connectionId: string) =>
    request<{ success: boolean; data: SyncResult }>(
      `/api/calendar-sync/connections/${connectionId}/sync`,
      { method: 'POST' },
    ),

  /**
   * Sync all connections.
   */
  syncAll: () =>
    request<{ success: boolean; data: SyncAllResult[] }>('/api/calendar-sync/sync-all', {
      method: 'POST',
    }),

  /**
   * Push a local event to external calendar.
   */
  pushEvent: (connectionId: string, eventId: string) =>
    request<{ success: boolean }>(`/api/calendar-sync/connections/${connectionId}/push`, {
      method: 'POST',
      body: JSON.stringify({ eventId }),
    }),

  /**
   * Sync (create/update) an event to a specific external calendar connection.
   */
  syncEventToConnection: (connectionId: string, eventId: string) =>
    request<{ success: boolean }>(
      `/api/calendar-sync/connections/${connectionId}/events/${eventId}`,
      { method: 'PUT' },
    ),

  /**
   * Delete an event from a specific external calendar connection.
   */
  deleteEventFromConnection: (connectionId: string, eventId: string) =>
    request<EmptyResponse>(`/api/calendar-sync/connections/${connectionId}/events/${eventId}`, {
      method: 'DELETE',
    }),

  /**
   * Sync an event to all bidirectional connections.
   */
  syncEventToAll: (eventId: string) =>
    request<{ success: boolean }>(`/api/calendar-sync/events/${eventId}`, {
      method: 'PUT',
    }),

  /**
   * Delete an event from all bidirectional connections.
   */
  deleteEventFromAll: (eventId: string) =>
    request<EmptyResponse>(`/api/calendar-sync/events/${eventId}`, {
      method: 'DELETE',
    }),

  /**
   * Disconnect a calendar provider.
   */
  disconnect: (connectionId: string) =>
    request<EmptyResponse>(`/api/calendar-sync/connections/${connectionId}`, {
      method: 'DELETE',
    }),
};

/**
 * Query keys for calendar sync.
 */
export const calendarSyncKeys = {
  all: ['calendar-sync'] as const,
  connections: () => [...calendarSyncKeys.all, 'connections'] as const,
};
