import { describe, expect, it } from 'vitest';

import {
  addApplicableProblems,
  addProblemComponents,
  failureGuidance,
  normalizeNarratives,
  normalizeTags,
  operations,
  securitySchemes,
  sentenceCase,
  statusEntries,
  successDescription,
  type JsonObject,
} from '../../src/openapi-public-prose';

/** Wrap one operation in a minimal OpenAPI document under the given path and method. */
function documentWith(path: string, method: string, operation: JsonObject): JsonObject {
  return { paths: { [path]: { [method]: operation } } };
}

/** Read back the single operation stored by {@link documentWith}. */
function operationAt(document: JsonObject, path: string, method: string): JsonObject {
  const paths = document['paths'] as JsonObject;
  const item = paths[path] as JsonObject;
  return item[method] as JsonObject;
}

/** Return the body of one `## Heading` section from a rendered narrative. */
function section(description: unknown, heading: string): string {
  const text = String(description);
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const body = text.slice(start + heading.length + 3);
  const end = body.indexOf('## ');
  return (end < 0 ? body : body.slice(0, end)).trim();
}

/** Render the inputs section for an operation with the given parameters and body. */
function inputsFor(parameters: readonly JsonObject[], requestBody?: JsonObject): string {
  const operation: JsonObject = { summary: 'Do a thing', parameters: [...parameters] };
  if (requestBody) operation['requestBody'] = requestBody;
  const document = documentWith('/v1/things', 'post', operation);
  normalizeNarratives(document);
  return section(
    operationAt(document, '/v1/things', 'post')['description'],
    'Inputs and constraints',
  );
}

describe('public OpenAPI operation enumeration', () => {
  it('returns no operations for a document without paths', () => {
    expect(operations({})).toEqual([]);
  });

  it('skips path items that are not objects', () => {
    const document: JsonObject = {
      paths: { '/v1/broken': null, '/v1/ok': { get: { summary: 'Read' } } },
    };

    expect(operations(document).map(({ path }) => path)).toEqual(['/v1/ok']);
  });

  it('returns no status entries for an operation without responses', () => {
    expect(statusEntries({ summary: 'No responses' })).toEqual([]);
  });

  it('ignores security requirements that are not objects', () => {
    expect(securitySchemes({ security: ['sessionCookie', { restOAuth: [] }] })).toEqual([
      'restOAuth',
    ]);
  });
});

describe('public OpenAPI display helpers', () => {
  it('leaves an empty string unchanged when sentence-casing', () => {
    expect(sentenceCase('')).toBe('');
  });

  it('describes no-content and not-modified responses differently from a normal success', () => {
    const operation: JsonObject = { summary: 'Remove a widget' };
    const ok = successDescription('delete', operation, '200');
    const noContent = successDescription('delete', operation, '204');
    const notModified = successDescription('get', operation, '304');

    expect(new Set([ok, noContent, notModified]).size).toBe(3);
  });
});

describe('public OpenAPI tag normalization', () => {
  it('rejects an operation that declares no tags', () => {
    const document = documentWith('/v1/untagged', 'get', { operationId: 'untagged' });

    expect(() => {
      normalizeTags(document);
    }).toThrow(Error);
  });

  it('rejects an operation whose tags resolve to no public tag', () => {
    const document = documentWith('/v1/unknown', 'get', {
      operationId: 'unknown',
      tags: ['NotAPublicTag', 42],
    });

    expect(() => {
      normalizeTags(document);
    }).toThrow(Error);
  });
});

describe('public OpenAPI Problem components', () => {
  it('creates the component containers when the document has none', () => {
    const document: JsonObject = {};

    addProblemComponents(document);

    const components = document['components'] as JsonObject;
    const schemas = components['schemas'] as JsonObject;
    const responses = components['responses'] as JsonObject;
    expect(schemas).toHaveProperty('Problem');
    expect(schemas).toHaveProperty('NotFoundProblem');
    expect(responses['NotFoundProblem']).toMatchObject({
      content: {
        'application/problem+json': { schema: { $ref: '#/components/schemas/NotFoundProblem' } },
      },
    });
  });
});

describe('public OpenAPI applicable problems', () => {
  it('creates a response map for an operation that declares none', () => {
    const document = documentWith('/v1/ping', 'get', { summary: 'Ping' });

    addApplicableProblems(document);

    const responses = operationAt(document, '/v1/ping', 'get')['responses'] as JsonObject;
    expect(Object.keys(responses).sort()).toEqual(['406', '500']);
  });

  it('keeps a failure response the operation already declares', () => {
    const custom = { description: 'Authored not-found behavior.' };
    const document = documentWith('/v1/widgets/{widgetId}', 'get', {
      summary: 'Read a widget',
      responses: { '404': custom },
    });

    addApplicableProblems(document);

    const responses = operationAt(document, '/v1/widgets/{widgetId}', 'get')[
      'responses'
    ] as JsonObject;
    expect(responses['404']).toBe(custom);
  });

  it('omits the not-acceptable problem from OPTIONS operations', () => {
    const document = documentWith('/v1/widgets', 'options', { summary: 'Describe widgets' });

    addApplicableProblems(document);

    const responses = operationAt(document, '/v1/widgets', 'options')['responses'] as JsonObject;
    expect(responses).not.toHaveProperty('406');
    expect(responses).toHaveProperty('500');
  });

  it('adds the precondition-failed problem to conditional writes', () => {
    const document = documentWith('/v1/widgets/{widgetId}', 'patch', {
      summary: 'Update a widget',
      'x-docket-conditional-write': true,
    });

    addApplicableProblems(document);

    const responses = operationAt(document, '/v1/widgets/{widgetId}', 'patch')[
      'responses'
    ] as JsonObject;
    expect(responses['412']).toEqual({
      $ref: '#/components/responses/PreconditionFailedProblem',
    });
  });

  it('adds the forbidden problem when the operation requires a workspace capability', () => {
    const document = documentWith('/v1/widgets', 'post', {
      summary: 'Create a widget',
      security: [{ sessionCookie: [] }],
      'x-docket-capability': 'contribute',
    });

    addApplicableProblems(document);

    const responses = operationAt(document, '/v1/widgets', 'post')['responses'] as JsonObject;
    expect(responses).toHaveProperty('401');
    expect(responses).toHaveProperty('403');
  });
});

describe('public OpenAPI input guidance', () => {
  it('renders distinct guidance for each combination of parameter locations', () => {
    const header = { name: 'X-Trace', in: 'header' };
    const cookie = { name: 'session', in: 'cookie' };
    const query = { name: 'cursor', in: 'query' };
    const path = { name: 'widgetId', in: 'path' };
    const other = { name: 'upload', in: 'formData' };

    const rendered = [
      inputsFor([]),
      inputsFor([header]),
      inputsFor([header, cookie]),
      inputsFor([path, header]),
      inputsFor([query, cookie]),
      inputsFor([other]),
      inputsFor([path, query]),
    ];

    expect(rendered.every((text) => text.length > 0)).toBe(true);
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  it('names every declared request media type', () => {
    const inputs = inputsFor([], {
      required: true,
      content: { 'application/json': {}, 'multipart/form-data': {} },
    });

    expect(inputs).toContain('`application/json`');
    expect(inputs).toContain('`multipart/form-data`');
  });

  it('distinguishes an optional body without media types from a required one', () => {
    const optional = inputsFor([], {});
    const required = inputsFor([], { required: true });

    expect(optional).not.toContain('`');
    expect(optional).not.toBe(required);
    expect(optional).not.toBe(inputsFor([]));
  });
});

describe('public OpenAPI related operations', () => {
  it('lists every related operation id and ignores non-string entries', () => {
    const document = documentWith('/v1/widgets', 'get', {
      summary: 'List widgets',
      'x-docket-related-operations': ['getWidget', 7, 'createWidget'],
    });

    normalizeNarratives(document);

    const related = section(
      operationAt(document, '/v1/widgets', 'get')['description'],
      'Related operations',
    );
    expect(related).toBe('`getWidget`, `createWidget`');
  });
});

describe('public OpenAPI failure guidance', () => {
  it('gives undocumented failure statuses the same generic recovery', () => {
    const guidance = failureGuidance({
      responses: { '404': {}, '418': {}, '451': {} },
    }).split('\n\n');
    const recovery = guidance.map((line) => line.replace(/^`\d+` - /, ''));

    expect(guidance.map((line) => line.slice(0, 5))).toEqual(['`404`', '`418`', '`451`']);
    expect(recovery[1]).toBe(recovery[2]);
    expect(recovery[0]).not.toBe(recovery[1]);
  });
});
