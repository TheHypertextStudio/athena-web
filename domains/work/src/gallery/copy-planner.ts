import type { TemplateCopyInput, TemplateCopyPlan } from './copy-types';
import { planPublishedTemplateCopy } from './copy-publication-adapter';
/**
 * Preserve the publication-only planner contract through the shared discriminated source core.
 * The bundle permits100 exact sources and2000 authored reference/dependency/timing edges, counted
 * once per source. Each independent root's optional expansion retains the shared500-work limit.
 * @throws {BlueprintError} For incomplete, conflicting, cyclic or oversized checked source facts.
 */
export async function planTemplateCopy(input: TemplateCopyInput): Promise<TemplateCopyPlan> {
  return planPublishedTemplateCopy(input);
}
