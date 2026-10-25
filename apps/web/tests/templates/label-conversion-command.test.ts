import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conversionAttemptKey,
  readConversionAttempt,
  saveConversionAttempt,
  confirmConversionCommand,
  clearConversionAttempt,
  resumeConversionCommand,
} from '@/components/templates/label-conversion/command';
import { LabelTemplateConversionChoices } from '@docket/work/work-template-contract';
import { UserFacingError } from '@/lib/problem';
const ids = [
  '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  '01ARZ3NDEKTSV4RRFFQ69G5FAY',
  '01ARZ3NDEKTSV4RRFFQ69G5FAZ',
];
const scope = {
  userId: 'human',
  sessionId: 'session-a',
  orgId: 'org-a',
  templateId: 'template-a',
  versionId: 'version-a',
};
const choices = () =>
  LabelTemplateConversionChoices.parse({
    labelGroupId: ids[0],
    items: [
      {
        kind: 'task',
        id: ids[1],
        removeLabelIds: [ids[2]],
        workTypeId: ids[3],
        workTypeVersionId: ids[4],
      },
    ],
  });
const fingerprint = `sha256:${'1'.repeat(64)}`;
const receipt = { changeSetId: 'receipt', state: 'converted' as const, itemCount: 1 };
beforeEach(() => {
  window.sessionStorage.clear();
});
describe('recoverable explicit label-conversion commands', () => {
  it('restores the exact selected IDs when an interrupted request has no saved server outcome', async () => {
    saveConversionAttempt(scope, choices(), fingerprint);
    expect(await resumeConversionCommand(scope, async () => null)).toMatchObject({
      phase: 'ready',
      choices: choices(),
    });
  });
  it('retains exact ID/fingerprint choices before writes and isolates another actual session', () => {
    const request = saveConversionAttempt(scope, choices(), fingerprint);
    expect(readConversionAttempt(scope)).toEqual(request);
    expect(readConversionAttempt({ ...scope, sessionId: 'session-b' })).toBeNull();
    expect(Object.keys(request).sort()).toEqual([
      'expectedReviewFingerprint',
      'items',
      'labelGroupId',
      'requestId',
    ]);
    expect(saveConversionAttempt(scope, choices(), fingerprint).requestId).toBe(request.requestId);
  });
  it('refuses to replace a known batch if this browser could not clear its saved request', () => {
    const original = saveConversionAttempt(scope, choices(), fingerprint);
    const failedClear = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    try {
      expect(() => {
        clearConversionAttempt(scope);
      }).toThrow();
      expect(readConversionAttempt(scope)?.requestId).toBe(original.requestId);
    } finally {
      failedClear.mockRestore();
    }
  });
  it('returns the actual receipt after a lost acceptance response without allocating another command', async () => {
    const submit = vi.fn().mockRejectedValue(new TypeError('Network dropped'));
    const lookup = vi.fn().mockResolvedValue(receipt);
    const outcome = await confirmConversionCommand(scope, choices(), fingerprint, {
      submit,
      lookup,
    });
    expect(outcome).toMatchObject({ phase: 'ready', receipt });
    expect(submit).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith(readConversionAttempt(scope)?.requestId);
  });
  it('blocks a replacement command when its outcome cannot be checked', async () => {
    const outcome = await confirmConversionCommand(scope, choices(), fingerprint, {
      submit: async () => {
        throw new TypeError('offline');
      },
      lookup: async () => {
        throw new TypeError('offline');
      },
    });
    expect(outcome.phase).toBe('unknown');
    expect(readConversionAttempt(scope)?.requestId).toBeDefined();
  });
  it('requires another review after a rejected stale command and keeps its original UUID', async () => {
    const submit = async () => {
      throw new UserFacingError('Conflict', { status: 409 });
    };
    const outcome = await confirmConversionCommand(scope, choices(), fingerprint, {
      submit,
      lookup: async () => null,
    });
    expect(outcome).toMatchObject({ phase: 'ready', needsReview: true });
    const original = readConversionAttempt(scope);
    expect(saveConversionAttempt(scope, choices(), `sha256:${'2'.repeat(64)}`).requestId).toBe(
      original?.requestId,
    );
  });
  it('does not submit when retained metadata is corrupt or storage rejects the request', async () => {
    const submit = vi.fn(),
      lookup = async () => null;
    window.sessionStorage.setItem(conversionAttemptKey(scope), 'broken');
    await expect(
      confirmConversionCommand(scope, choices(), fingerprint, { submit, lookup }),
    ).rejects.toThrow();
    window.sessionStorage.clear();
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    try {
      await expect(
        confirmConversionCommand(scope, choices(), fingerprint, { submit, lookup }),
      ).rejects.toThrow();
      expect(submit).not.toHaveBeenCalled();
    } finally {
      failure.mockRestore();
    }
  });
});
