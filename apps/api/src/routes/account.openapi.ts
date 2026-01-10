/**
 * Account OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  AccountOverviewResponseSchema,
  DataExportResponseSchema,
  DeleteAccountRequestSchema,
} from '@athena/types/openapi/account';
import { UnauthorizedErrorSchema, ValidationErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// Get Account Overview
// =============================================================================

export const getAccountOverview = createRoute({
  method: 'get',
  path: '/',
  tags: ['Account'],
  summary: 'Get account overview',
  description: 'Retrieve account information and usage statistics.',
  responses: {
    200: {
      description: 'Account overview retrieved successfully',
      content: {
        'application/json': {
          schema: AccountOverviewResponseSchema,
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
// Export User Data
// =============================================================================

export const exportUserData = createRoute({
  method: 'get',
  path: '/export',
  tags: ['Account'],
  summary: 'Export user data',
  description: 'Export all user data as JSON for GDPR compliance.',
  responses: {
    200: {
      description: 'Data export successful',
      content: {
        'application/json': {
          schema: DataExportResponseSchema,
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
// Delete Account
// =============================================================================

export const deleteAccount = createRoute({
  method: 'delete',
  path: '/',
  tags: ['Account'],
  summary: 'Delete account',
  description: 'Permanently delete the user account and all associated data.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: DeleteAccountRequestSchema,
        },
      },
    },
  },
  responses: {
    204: {
      description: 'Account deleted successfully',
    },
    400: {
      description: 'Invalid confirmation string',
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
