/**
 * Settings OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  UpdateSettingsRequestSchema,
  SettingsResponseSchema,
} from '@athena/types/openapi/settings';
import { UnauthorizedErrorSchema, ValidationErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// Get Settings
// =============================================================================

export const getSettings = createRoute({
  method: 'get',
  path: '/',
  tags: ['Settings'],
  summary: 'Get user settings',
  description: "Retrieve the current user's settings.",
  responses: {
    200: {
      description: 'Settings retrieved successfully',
      content: {
        'application/json': {
          schema: SettingsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Settings
// =============================================================================

export const updateSettings = createRoute({
  method: 'patch',
  path: '/',
  tags: ['Settings'],
  summary: 'Update user settings',
  description: "Update the current user's settings. Only provided fields will be updated.",
  request: {
    body: {
      content: {
        'application/json': {
          schema: UpdateSettingsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Settings updated successfully',
      content: {
        'application/json': {
          schema: SettingsResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});
