/**
 * API client for communicating with the Athena backend.
 *
 * @packageDocumentation
 */

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

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
      }
    } catch {
      // Use default error message if JSON parsing fails
    }
    throw new ApiError(response.status, errorMessage);
  }

  return response.json() as Promise<T>;
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
  createdAt: string;
  updatedAt: string;
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
