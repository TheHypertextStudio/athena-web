/** Normalize the generated public OpenAPI document into the contract Scalar renders. */
import { PUBLIC_TAGS } from './lib/public-api-tags';
import {
  deduplicateComponentSchemas,
  deduplicateNestedSchemas,
  hoistReferencedExamples,
  hoistRepeatedParameters,
  hoistRepeatedResponses,
  moveSharedPathParameters,
  pruneUnreferencedSchemas,
  unresolvedSchemaReferences,
} from './openapi-public-deduplication';
import { hoistInlineDefinitions, hoistRepeatedSchemas } from './openapi-public-components';
import {
  PUBLIC_API_OVERVIEW,
  addApplicableProblems,
  addProblemComponents,
  cleanStrings,
  isObject,
  normalizeNarratives,
  normalizeSuccessDescriptions,
  normalizeTags,
  operations,
  statusEntries,
  type JsonObject,
} from './openapi-public-prose';
import { addExamplesAndDescriptions } from './openapi-public-schema';

/** Apply all public-reference rules to one generated OpenAPI document. */
export function normalizePublicReference<T extends JsonObject>(document: T): T {
  const paths = isObject(document['paths']) ? document['paths'] : undefined;
  if (paths) delete paths['/v1/me/elicitations/samples'];
  if (isObject(document['info'])) document['info']['description'] = PUBLIC_API_OVERVIEW;
  cleanStrings(document);
  normalizeTags(document);
  normalizeSuccessDescriptions(document);
  addProblemComponents(document);
  addApplicableProblems(document);
  normalizeNarratives(document);
  hoistInlineDefinitions(document);
  addExamplesAndDescriptions(document);
  hoistRepeatedSchemas(document);
  deduplicateNestedSchemas(document);
  deduplicateComponentSchemas(document);
  addExamplesAndDescriptions(document);
  deduplicateNestedSchemas(document);
  deduplicateComponentSchemas(document);
  hoistReferencedExamples(document);
  pruneUnreferencedSchemas(document);
  return document;
}

/** Reuse complete parameters and responses after API identity headers have been attached. */
export function compactPublicReference<T extends JsonObject>(document: T): T {
  hoistRepeatedParameters(document);
  moveSharedPathParameters(document);
  hoistRepeatedResponses(document);
  return document;
}

function assertRequiredOperationSections(operation: JsonObject, operationId: string): void {
  const description = typeof operation['description'] === 'string' ? operation['description'] : '';
  const sections = [
    'Purpose',
    'Inputs and constraints',
    'Result and side effects',
    'Access and permissions',
    'Failures and recovery',
    'Related operations',
  ];
  for (const section of sections) {
    if (!description.includes(`## ${section}`)) {
      throw new Error(`${operationId} is missing ${section}`);
    }
  }
}

function assertOperationIdentity(operation: JsonObject, ids: Set<string>): string {
  const operationId = typeof operation['operationId'] === 'string' ? operation['operationId'] : '';
  if (!operationId || ids.has(operationId)) {
    throw new Error(`Missing or duplicate operationId: ${operationId}`);
  }
  ids.add(operationId);
  const declaredTags = new Set(PUBLIC_TAGS.map((tag) => tag.id));
  const tags = Array.isArray(operation['tags']) ? operation['tags'] : [];
  if (tags.length !== 1 || typeof tags[0] !== 'string' || !declaredTags.has(tags[0] as never)) {
    throw new Error(`${operationId} has an invalid tag`);
  }
  return operationId;
}

/** Assert that a normalized document has no source prose or missing operation basics. */
export function assertPublicReference(document: JsonObject): void {
  const serialized = JSON.stringify(document);
  const forbidden = ['{@link', 'workflow_states'];
  const leaked = forbidden.find((value) => serialized.includes(value));
  if (leaked) throw new Error(`Public OpenAPI contains forbidden text: ${leaked}`);

  const unresolved = unresolvedSchemaReferences(document);
  if (unresolved.length > 0) {
    throw new Error(
      `Public OpenAPI contains unresolved schema references: ${unresolved.join(', ')}`,
    );
  }

  const ids = new Set<string>();
  for (const { operation } of operations(document)) {
    const operationId = assertOperationIdentity(operation, ids);
    assertRequiredOperationSections(operation, operationId);
    if (statusEntries(operation).some(([, response]) => response['description'] === 'Success.')) {
      throw new Error(`${operationId} contains a generic success response`);
    }
  }
}
