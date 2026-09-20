/** Normalize the generated public OpenAPI document into the contract Scalar renders. */
import { z } from 'zod';

import { PROBLEM_CATALOG, PROBLEM_CODES, Problem } from './contracts/errors';
import { PUBLIC_TAG_GROUPS, PUBLIC_TAGS, resolvePublicTagId } from './lib/public-api-tags';

/** Mutable JSON object used while normalizing the generated document. */
export type JsonObject = Record<string, unknown>;

/** HTTP method keys that can own OpenAPI operations. */
export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

/** Plain-language introduction shown before the operation list. */
export const PUBLIC_API_OVERVIEW = `
Docket's REST API lets a client read and change workspace work, plan a person's day, track time,
run agents, and connect external systems. This reference describes the request, response, access
rules, side effects, and failure recovery for every public operation.

## Start here

First-party Docket clients may use the secure session cookie. External clients use OAuth 2.1 on
operations that list an OAuth security alternative. A bearer token issued for MCP does not work on
REST, and a REST token does not work on MCP.

All workspace routes use an Organization as their tenant boundary. Docket calls an Organization a
workspace in the product. A caller must keep access to the workspace and the individual resource;
an OAuth scope alone never grants either one.

Send JSON with \`Content-Type: application/json\` unless an operation documents another media type.
Errors use \`application/problem+json\` and include a stable \`code\`. Collections default to 50
items and accept at most 100. Continue with the opaque \`nextCursor\` and the same filters.

## API version and deployment

The current compatibility version is \`0.1.0\`. Omit \`Docket-Version\` to use the current contract,
or send the exact value to assert the contract your client expects. Docket currently serves one
contract version; the header does not select an older implementation. Every response includes
\`Docket-Version\` and \`Docket-Revision\` so you can identify both the contract and deployed build.

## Writes, retries, and concurrency

Only operations that document \`Idempotency-Key\` support response replay. Reusing a key with a
different method, path, query, content type, or body fails. A replay checks the caller's current
permissions before returning stored data.

Finite reads may return an \`ETag\` and honor weak \`If-None-Match\`. Only operations that document
\`If-Match\` support conditional writes. A stale strong validator returns \`412\`; a route that does
not support conditional writes rejects the header instead of ignoring it.

Queued work returns \`202\` with a monitor URL in \`Location\`. Server-sent event operations list
their event names, payloads, replay window, and reconnect behavior in the operation response.
`.trim();

/** Return whether a value is a non-array object. */
export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Return a string field without coercing objects into `[object Object]`. */
export function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Convert an identifier into lowercase display words. */
export function words(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Capitalize the first character of display text. */
export function sentenceCase(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

/** Convert source-only TSDoc links into readable schema names. */
export function cleanPublicProse(value: string): string {
  return value
    .replace(/\{@link\s+([^}\s]+)(?:\s+[^}]*)?\}/g, (_match, target: string) => {
      const name = target.split(/[.#/]/).at(-1) ?? target;
      return `\`${name}\``;
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Clean every public description, summary, and title recursively. */
export function cleanStrings(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(cleanStrings);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && ['description', 'summary', 'title'].includes(key)) {
      value[key] = cleanPublicProse(child);
    } else {
      cleanStrings(child);
    }
  }
}

/** Enumerate every operation in a generated OpenAPI document. */
export function operations(document: JsonObject): readonly {
  path: string;
  method: string;
  operation: JsonObject;
}[] {
  const paths = isObject(document['paths']) ? document['paths'] : {};
  return Object.entries(paths).flatMap(([path, item]) => {
    if (!isObject(item)) return [];
    return HTTP_METHODS.flatMap((method) => {
      const operation = item[method];
      return isObject(operation) ? [{ path, method, operation }] : [];
    });
  });
}

/** Install the public tag registry and normalize each operation tag. */
export function normalizeTags(document: JsonObject): void {
  document['tags'] = PUBLIC_TAGS.map((tag) => ({
    name: tag.id,
    description: tag.description,
    'x-displayName': tag.displayName,
  }));
  document['x-tagGroups'] = PUBLIC_TAG_GROUPS.map((group) => ({
    name: group.displayName,
    tags: [...group.tags],
  }));

  for (const { operation } of operations(document)) {
    const tags = Array.isArray(operation['tags']) ? operation['tags'] : [];
    const resolved = tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map(resolvePublicTagId)
      .filter((tag): tag is NonNullable<typeof tag> => tag !== undefined);
    if (resolved.length !== 1) {
      throw new Error(`Public operation ${String(operation['operationId'])} must resolve one tag`);
    }
    operation['tags'] = [resolved[0]];
  }
}

/** Return the concrete response objects declared by an operation. */
export function statusEntries(operation: JsonObject): readonly [string, JsonObject][] {
  const responses = isObject(operation['responses']) ? operation['responses'] : {};
  return Object.entries(responses).filter((entry): entry is [string, JsonObject] =>
    isObject(entry[1]),
  );
}

/** Build an observable success description for an operation response. */
export function successDescription(method: string, operation: JsonObject, status: string): string {
  const summary = stringValue(operation['summary'], 'complete the operation');
  if (status === '201')
    return 'Docket created the resource. The body contains its stored representation.';
  if (status === '202')
    return 'Docket accepted the work for processing. Follow the monitor URL in Location until it reaches a terminal state.';
  if (status === '204') return 'The operation completed. The response has no body.';
  if (status === '304')
    return 'The current representation still matches If-None-Match. The response has no body.';
  if (method === 'get' && /^(list|search|browse)\b/i.test(summary))
    return 'Docket returned the requested collection.';
  if (method === 'get' || method === 'head') return 'Docket returned the requested representation.';
  if (method === 'put' || method === 'patch')
    return 'Docket stored the change and returned the current representation.';
  return 'Docket completed the action and returned its result.';
}

/** Replace generic success descriptions throughout the document. */
export function normalizeSuccessDescriptions(document: JsonObject): void {
  for (const { method, operation } of operations(document)) {
    for (const [status, response] of statusEntries(operation)) {
      if (
        /^2\d\d$|^304$/.test(status) &&
        stringValue(response['description']).trim() === 'Success.'
      ) {
        response['description'] = successDescription(method, operation, status);
      }
    }
  }
}

/** Convert a stable Problem code into its component name. */
export function problemComponentName(code: string): string {
  return `${code
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Problem`;
}

/** Build the specialized Problem schema for one stable code. */
export function problemSchema(code: string): JsonObject {
  const definition = PROBLEM_CATALOG[code as keyof typeof PROBLEM_CATALOG];
  return {
    allOf: [
      { $ref: '#/components/schemas/Problem' },
      {
        type: 'object',
        required: ['code', 'status'],
        properties: {
          code: { const: code, description: 'The stable code to branch on.' },
          status: {
            const: definition.status,
            description: 'The HTTP status returned with this problem.',
          },
        },
      },
    ],
  };
}

/** Install reusable schemas and responses for every public Problem. */
export function addProblemComponents(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const responses = isObject(components['responses']) ? components['responses'] : {};
  schemas['Problem'] = z.toJSONSchema(Problem, { io: 'output' });
  for (const code of PROBLEM_CODES) {
    const definition = PROBLEM_CATALOG[code];
    const name = problemComponentName(code);
    schemas[name] = problemSchema(code);
    responses[name] = {
      description: `${definition.title} ${definition.summary} ${problemRecovery(definition.status)}`,
      content: { 'application/problem+json': { schema: { $ref: `#/components/schemas/${name}` } } },
    };
  }
  components['schemas'] = schemas;
  components['responses'] = responses;
  document['components'] = components;
}

/** Return client recovery guidance for an HTTP failure status. */
export function problemRecovery(status: number): string {
  const guidance: Readonly<Record<number, string>> = {
    401: 'Obtain a new credential before retrying.',
    402: 'Ask a workspace billing administrator to restore the required access.',
    403: 'Use a principal with the documented OAuth scope, workspace capability, and resource access.',
    404: 'Verify the identifier and caller access. Docket does not reveal whether an inaccessible resource exists.',
    406: 'Request one of the media types documented for the operation.',
    412: 'Fetch the current representation and retry with its strong ETag.',
    413: 'Send a smaller body or upload.',
    415: 'Send one of the documented Content-Type values.',
    422: 'Correct the reported field issues before retrying.',
  };
  if (guidance[status]) return guidance[status];
  if (status === 429 || status === 503) return 'Wait for Retry-After before retrying.';
  if (status >= 500)
    return 'Record X-Request-Id. Retry safe reads with backoff; retry writes only when the operation supports idempotency.';
  if (status === 409) return 'Read the Problem code and resolve the conflicting resource state.';
  return 'Correct the request using the Problem code and field issues before retrying.';
}

/** Return whether an operation declares a request body. */
export function hasRequestBody(operation: JsonObject): boolean {
  return isObject(operation['requestBody']);
}

/** Return every security scheme named by an operation. */
export function securitySchemes(operation: JsonObject): readonly string[] {
  if (!Array.isArray(operation['security'])) return [];
  return operation['security'].flatMap((item) => (isObject(item) ? Object.keys(item) : []));
}

/** Attach one reusable Problem response when its status is not already declared. */
export function installProblem(operation: JsonObject, code: keyof typeof PROBLEM_CATALOG): void {
  const responses = isObject(operation['responses']) ? operation['responses'] : {};
  const status = String(PROBLEM_CATALOG[code].status);
  if (!(status in responses))
    responses[status] = { $ref: `#/components/responses/${problemComponentName(code)}` };
  operation['responses'] = responses;
}

/** Add the runtime failures applicable to each public operation. */
export function addApplicableProblems(document: JsonObject): void {
  for (const { path, method, operation } of operations(document)) {
    const schemes = securitySchemes(operation);
    if (schemes.length > 0) installProblem(operation, 'unauthorized');
    if (schemes.includes('restOAuth') || operation['x-docket-capability'])
      installProblem(operation, 'forbidden');
    if (path.includes('{')) installProblem(operation, 'not_found');
    if (hasRequestBody(operation)) {
      installProblem(operation, 'payload_too_large');
      installProblem(operation, 'unsupported_media_type');
      installProblem(operation, 'validation_error');
    }
    if (method !== 'options') installProblem(operation, 'not_acceptable');
    if (operation['x-docket-conditional-write']) installProblem(operation, 'precondition_failed');
    installProblem(operation, 'internal');
  }
}

/** Describe credentials, scopes, capabilities, and tenancy for an operation. */
export function accessText(path: string, operation: JsonObject): string {
  const schemes = securitySchemes(operation);
  const capability = stringValue(operation['x-docket-capability']);
  if (schemes.length === 0) return 'No credential is required.';
  const alternatives = [];
  if (schemes.includes('sessionCookie')) alternatives.push('a Docket session');
  if (schemes.includes('restOAuth'))
    alternatives.push('a REST OAuth token with the scopes shown below');
  if (schemes.includes('shareToken'))
    alternatives.push('the share token documented for this operation');
  const credential = `Use ${alternatives.join(' or ')}.`;
  const access = capability
    ? `${credential} The caller needs the \`${capability}\` workspace capability.`
    : credential;
  return path.includes('/orgs/{orgId}') ? `${access} Organization membership is required.` : access;
}

function inputGuidance(operation: JsonObject): string {
  const parameters = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
  const locations = new Set(
    parameters
      .filter(isObject)
      .map((parameter) => stringValue(parameter['in']))
      .filter(Boolean),
  );
  const requestBody = isObject(operation['requestBody']) ? operation['requestBody'] : undefined;
  const content = requestBody && isObject(requestBody['content']) ? requestBody['content'] : {};
  const mediaTypes = Object.keys(content);
  const parts: string[] = [];
  if (locations.size > 0) {
    parts.push(`Supply the ${[...locations].join(', ')} values documented below.`);
  }
  if (requestBody) {
    const requirement = requestBody['required'] === true ? 'required' : 'optional';
    parts.push(
      `The ${requirement} request body uses ${mediaTypes.map((type) => `\`${type}\``).join(' or ') || 'the documented media type'}.`,
    );
  }
  return parts.join(' ') || 'This operation takes no path, query, header, or body input.';
}

function relatedGuidance(operation: JsonObject): string {
  const related = Array.isArray(operation['x-docket-related-operations'])
    ? operation['x-docket-related-operations'].filter(
        (operationId): operationId is string => typeof operationId === 'string',
      )
    : [];
  return related.length > 0
    ? related.map((operationId) => `\`${operationId}\``).join(', ')
    : 'No related operation is required to complete this request.';
}

function resultGuidance(operation: JsonObject): string {
  return statusEntries(operation)
    .filter(([status]) => /^2\d\d$|^304$/.test(status))
    .map(([status, response]) => {
      const description = stringValue(response['description'], 'The operation completed.');
      return `\`${status}\` - ${description}`;
    })
    .join('\n\n');
}

const FAILURE_RECOVERY: Readonly<Record<string, string>> = {
  '400': 'Correct the API version or malformed request and try again.',
  '401': 'Authenticate again with a valid credential for this interface.',
  '403': 'Request the required OAuth scope or workspace permission before retrying.',
  '404': 'Verify the identifier and that the caller can access the resource.',
  '406': 'Request one of the response media types documented for this operation.',
  '409': 'Read the current resource state, resolve the conflict, and retry if appropriate.',
  '412': 'Fetch the current representation and retry with its latest strong ETag.',
  '413': 'Send a smaller request body.',
  '415': 'Send the request with one of the documented content types.',
  '422': 'Correct the fields listed in the Problem response and try again.',
  '429': 'Wait for the Retry-After interval before retrying.',
  '500': 'Retry with backoff. Include X-Request-Id when reporting a persistent failure.',
  '503': 'Wait for the Retry-After interval or retry with backoff.',
};

/** Describe where a caller finds recovery guidance for an operation. */
export function failureGuidance(operation: JsonObject): string {
  const failures = statusEntries(operation).filter(([status]) => !/^2\d\d$|^304$/.test(status));
  if (failures.length === 0) return 'No operation-specific failure is declared.';
  return failures
    .map(
      ([status]) =>
        `\`${status}\` - ${FAILURE_RECOVERY[status] ?? 'Use the Problem code to select recovery behavior.'}`,
    )
    .join('\n\n');
}

/** Render every operation description with the required public sections. */
export function normalizeNarratives(document: JsonObject): void {
  for (const { path, operation } of operations(document)) {
    const current = stringValue(operation['description']);
    if (current.includes('## Purpose') && current.includes('## Failures and recovery')) continue;
    const summary = stringValue(operation['summary'], 'Perform this operation').trim();
    const purpose = `${summary.replace(/[.!?]+$/, '')}.`;
    operation['description'] = [
      '## Purpose',
      purpose,
      '## Inputs and constraints',
      inputGuidance(operation),
      '## Result and side effects',
      resultGuidance(operation),
      '## Access and permissions',
      accessText(path, operation),
      '## Failures and recovery',
      failureGuidance(operation),
      '## Related operations',
      relatedGuidance(operation),
    ].join('\n\n');
  }
}
