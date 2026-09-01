/**
 * Unit tests for the account end-of-life (export + deletion) DTOs' cross-field validation.
 */
import { describe, expect, it } from 'vitest';

import {
  AccountExportRequest,
  AccountExportScope,
  ProfileSettingsUpdate,
} from '../../src/contracts/account';

describe('ProfileSettingsUpdate', () => {
  it('accepts a patch that changes at least one profile field', () => {
    expect(ProfileSettingsUpdate.safeParse({ name: 'Ada Lovelace' }).success).toBe(true);
  });

  it('rejects an empty patch (no profile change supplied)', () => {
    expect(ProfileSettingsUpdate.safeParse({}).success).toBe(false);
  });
});

describe('AccountExportScope', () => {
  it('accepts a workspaces-category scope naming at least one workspace', () => {
    expect(
      AccountExportScope.safeParse({
        categories: ['workspaces'],
        workspaces: [{ id: 'org_1', name: 'Hypertext Studio' }],
        allWorkspaces: false,
      }).success,
    ).toBe(true);
  });

  it('accepts a workspaces-category scope that spans all workspaces without naming any', () => {
    expect(
      AccountExportScope.safeParse({
        categories: ['workspaces'],
        workspaces: [],
        allWorkspaces: true,
      }).success,
    ).toBe(true);
  });

  it('refuses a workspaces-category scope naming neither a workspace nor "all"', () => {
    expect(
      AccountExportScope.safeParse({
        categories: ['workspaces'],
        workspaces: [],
        allWorkspaces: false,
      }).success,
    ).toBe(false);
  });

  it('accepts a non-workspaces scope that selects no workspaces', () => {
    expect(
      AccountExportScope.safeParse({
        categories: ['account'],
        workspaces: [],
        allWorkspaces: false,
      }).success,
    ).toBe(true);
  });

  it('refuses a workspace selection when the workspaces category is not included', () => {
    expect(
      AccountExportScope.safeParse({
        categories: ['account'],
        workspaces: [{ id: 'org_1', name: 'Hypertext Studio' }],
        allWorkspaces: false,
      }).success,
    ).toBe(false);
    expect(
      AccountExportScope.safeParse({
        categories: ['account'],
        workspaces: [],
        allWorkspaces: true,
      }).success,
    ).toBe(false);
  });
});

describe('AccountExportRequest', () => {
  it('accepts a workspaces-category request naming at least one workspace id', () => {
    expect(
      AccountExportRequest.safeParse({ categories: ['workspaces'], workspaceIds: ['org_1'] })
        .success,
    ).toBe(true);
  });

  it('refuses a workspaces-category request with no workspace ids', () => {
    expect(
      AccountExportRequest.safeParse({ categories: ['workspaces'], workspaceIds: [] }).success,
    ).toBe(false);
  });

  it('accepts a non-workspaces request with no workspace ids', () => {
    expect(
      AccountExportRequest.safeParse({ categories: ['account'], workspaceIds: [] }).success,
    ).toBe(true);
  });

  it('refuses workspace ids when the workspaces category is not included', () => {
    expect(
      AccountExportRequest.safeParse({ categories: ['account'], workspaceIds: ['org_1'] }).success,
    ).toBe(false);
  });
});
