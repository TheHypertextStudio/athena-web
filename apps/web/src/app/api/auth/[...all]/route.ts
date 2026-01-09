/**
 * Better Auth catch-all route handler.
 *
 * Handles all auth routes: /api/auth/*
 * - OAuth sign-in and callbacks
 * - Session management
 * - Passkey authentication
 *
 * @packageDocumentation
 */

import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/lib/auth-server';

export const { GET, POST } = toNextJsHandler(auth);
