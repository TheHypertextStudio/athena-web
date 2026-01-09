/**
 * Tag schema tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import { createTagSchema, updateTagSchema } from '../../src/schemas/tags.js';

describe('createTagSchema', () => {
  it('should validate valid create input', () => {
    const input = {
      name: 'Important',
      color: '#FF5733',
    };

    const result = createTagSchema.parse(input);

    expect(result.name).toBe('Important');
    expect(result.color).toBe('#FF5733');
  });

  it('should accept minimal input', () => {
    const input = { name: 'Simple Tag' };

    const result = createTagSchema.parse(input);

    expect(result.name).toBe('Simple Tag');
    expect(result.color).toBeUndefined();
  });

  it('should reject empty name', () => {
    const input = { name: '' };

    expect(() => createTagSchema.parse(input)).toThrow();
  });

  it('should reject name exceeding max length', () => {
    const input = { name: 'a'.repeat(51) };

    expect(() => createTagSchema.parse(input)).toThrow();
  });

  it('should accept 3-character hex color', () => {
    const input = { name: 'Tag', color: '#F00' };

    const result = createTagSchema.parse(input);

    expect(result.color).toBe('#F00');
  });

  it('should accept 6-character hex color', () => {
    const input = { name: 'Tag', color: '#FF0000' };

    const result = createTagSchema.parse(input);

    expect(result.color).toBe('#FF0000');
  });

  it('should accept lowercase hex color', () => {
    const input = { name: 'Tag', color: '#ff5733' };

    const result = createTagSchema.parse(input);

    expect(result.color).toBe('#ff5733');
  });

  it('should reject invalid hex color format', () => {
    expect(() => createTagSchema.parse({ name: 'Tag', color: 'red' })).toThrow();
    expect(() => createTagSchema.parse({ name: 'Tag', color: '#GGG' })).toThrow();
    expect(() => createTagSchema.parse({ name: 'Tag', color: 'FF5733' })).toThrow();
    expect(() => createTagSchema.parse({ name: 'Tag', color: '#FFFF' })).toThrow();
  });
});

describe('updateTagSchema', () => {
  it('should validate partial update', () => {
    const input = { name: 'Updated Name' };

    const result = updateTagSchema.parse(input);

    expect(result.name).toBe('Updated Name');
  });

  it('should accept empty object', () => {
    const input = {};

    const result = updateTagSchema.parse(input);

    expect(result).toEqual({});
  });

  it('should accept color update', () => {
    const input = { color: '#00FF00' };

    const result = updateTagSchema.parse(input);

    expect(result.color).toBe('#00FF00');
  });

  it('should accept null color to clear it', () => {
    const input = { color: null };

    const result = updateTagSchema.parse(input);

    expect(result.color).toBeNull();
  });

  it('should validate both fields together', () => {
    const input = {
      name: 'New Name',
      color: '#0000FF',
    };

    const result = updateTagSchema.parse(input);

    expect(result.name).toBe('New Name');
    expect(result.color).toBe('#0000FF');
  });
});
