/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Tests for the API client.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, tasksApi, eventsApi } from './api-client';

// Mock the env module
vi.mock('./env', () => ({
  env: {
    API_URL: 'https://api.example.com',
  },
}));

describe('API Client', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ApiError', () => {
    it('should create an error with status and message', () => {
      const error = new ApiError(404, 'Not found');

      expect(error.status).toBe(404);
      expect(error.message).toBe('Not found');
      expect(error.name).toBe('ApiError');
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe('request handling', () => {
    it('should make successful GET request and return JSON data', async () => {
      const mockData = { data: { id: '1', title: 'Test Task' } };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify(mockData)),
      });

      const result = await tasksApi.get('1');

      expect(result).toEqual(mockData);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/tasks/1',
        expect.objectContaining({
          credentials: 'include',
          headers: expect.any(Headers) as Headers,
        }),
      );
    });

    it('should handle 204 No Content responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        text: () => Promise.resolve(''),
      });

      const result = await tasksApi.delete('1');

      expect(result).toEqual({});
    });

    it('should handle empty content-length responses', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '0' }),
        text: () => Promise.resolve(''),
      });

      const result = await eventsApi.delete('1');

      expect(result).toEqual({});
    });

    it('should throw ApiError on non-ok response with message field', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers(),
        json: () => Promise.resolve({ message: 'Task not found' }),
      });

      await expect(tasksApi.get('invalid')).rejects.toThrow(ApiError);
      await expect(tasksApi.get('invalid')).rejects.toMatchObject({
        status: 404,
        message: 'Task not found',
      });
    });

    it('should throw ApiError on non-ok response with error field', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers(),
        json: () => Promise.resolve({ error: 'Validation failed' }),
      });

      await expect(tasksApi.create({ title: '' })).rejects.toThrow(ApiError);
      await expect(tasksApi.create({ title: '' })).rejects.toMatchObject({
        status: 400,
        message: 'Validation failed',
      });
    });

    it('should use default message when JSON parsing fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(tasksApi.get('1')).rejects.toMatchObject({
        status: 500,
        message: 'Request failed',
      });
    });

    it('should handle empty text response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '10' }),
        text: () => Promise.resolve(''),
      });

      const result = await tasksApi.get('1');

      expect(result).toEqual({});
    });
  });

  describe('query parameter handling', () => {
    it('should build query string for list requests with params', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify({ data: [] })),
      });

      await tasksApi.list({ status: 'pending', priority: 'high' });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('status=pending'),
        expect.any(Object),
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('priority=high'),
        expect.any(Object),
      );
    });

    it('should not include undefined params in query string', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify({ data: [] })),
      });

      await tasksApi.list({ status: 'pending' });

      const mockCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(mockCalls.length).toBeGreaterThan(0);
      const calledUrl = mockCalls[0]![0] as string;
      expect(calledUrl).toContain('status=pending');
      expect(calledUrl).not.toContain('priority');
    });

    it('should handle list requests without params', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify({ data: [] })),
      });

      await tasksApi.list();

      expect(fetch).toHaveBeenCalledWith('https://api.example.com/api/tasks', expect.any(Object));
    });
  });

  describe('POST/PATCH/DELETE requests', () => {
    it('should send POST request with JSON body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify({ data: { id: '1', title: 'New Task' } })),
      });

      await tasksApi.create({ title: 'New Task', priority: 'high' });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/tasks',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'New Task', priority: 'high' }),
        }),
      );
    });

    it('should send PATCH request with JSON body', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify({ data: { id: '1', title: 'Updated Task' } })),
      });

      await tasksApi.update('1', { title: 'Updated Task' });

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/tasks/1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Updated Task' }),
        }),
      );
    });

    it('should send DELETE request', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify({ success: true })),
      });

      await tasksApi.delete('1');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/api/tasks/1',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('headers handling', () => {
    it('should set Content-Type header to application/json', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify({ data: {} })),
      });

      await tasksApi.get('1');

      const mockCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
      expect(mockCalls.length).toBeGreaterThan(0);
      const calledOptions = mockCalls[0]![1] as RequestInit;
      const headers = calledOptions.headers as Headers;
      expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('should include credentials in all requests', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        text: () => Promise.resolve(JSON.stringify({ data: {} })),
      });

      await tasksApi.get('1');

      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'include',
        }),
      );
    });
  });
});
