import { describe, expect, it } from 'vitest';
import {
  registerTemplateCopyReservation,
  requireTemplateCopyReservation,
} from '../../src/lib/templates/copy-reservation-proof';
import type { TemplateTransaction } from '../../src/lib/templates/persistence';

const transaction = (): TemplateTransaction => Object.freeze({}) as TemplateTransaction;
const facts = {
  entryId: 'entry',
  bundleId: 'bundle',
  organizationId: 'tenant',
  actorId: 'actual',
  userId: 'verified-user',
  destinationWorkTypeId: 'template',
  reservedFirstVersionId: 'first',
};
describe('server-only copy reservation capabilities', () => {
  it('binds the exact registered object to its transaction and persisted principal facts', () => {
    const tx = transaction();
    const proof = registerTemplateCopyReservation(tx, facts);
    expect(
      requireTemplateCopyReservation(tx, proof, { orgId: 'tenant', actorId: 'actual' }),
    ).toEqual(facts);
    expect(() =>
      requireTemplateCopyReservation(transaction(), proof, { orgId: 'tenant', actorId: 'actual' }),
    ).toThrow();
    expect(() =>
      requireTemplateCopyReservation(tx, { ...proof }, { orgId: 'tenant', actorId: 'actual' }),
    ).toThrow();
  });
  it('refuses client-shaped, foreign-principal and foreign-tenant capabilities', () => {
    const tx = transaction();
    const proof = registerTemplateCopyReservation(tx, facts);
    expect(() =>
      requireTemplateCopyReservation(tx, { proof: {} }, { orgId: 'tenant', actorId: 'actual' }),
    ).toThrow();
    expect(() =>
      requireTemplateCopyReservation(tx, proof, { orgId: 'other', actorId: 'actual' }),
    ).toThrow();
    expect(() =>
      requireTemplateCopyReservation(tx, proof, { orgId: 'tenant', actorId: 'other' }),
    ).toThrow();
  });
});
