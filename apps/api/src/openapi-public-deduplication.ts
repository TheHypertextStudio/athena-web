/** Deduplicate generated schemas, parameters, responses, and examples. */
import {
  canonical,
  nestedSchemaSlots,
  rewriteLocalDefinitionRefs,
  shortHash,
  type SchemaSlot,
} from './openapi-public-components';
import {
  HTTP_METHODS,
  isObject,
  operations,
  statusEntries,
  type JsonObject,
} from './openapi-public-prose';

/** Hoist identical nested schemas that occur more than once. */
export function deduplicateNestedSchemas(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const grouped = new Map<string, SchemaSlot[]>();
  for (const slot of nestedSchemaSlots(document)) {
    const key = canonical(slot.schema);
    if (key.length < 180) continue;
    const group = grouped.get(key) ?? [];
    group.push(slot);
    grouped.set(key, group);
  }
  const used = new Set(Object.keys(schemas));
  const repeated = [...grouped.entries()]
    .filter(([, slots]) => slots.length > 1)
    .sort(([left], [right]) => left.length - right.length);
  for (const [key, slots] of repeated) {
    const first = slots[0];
    if (!first) continue;
    const base = `Shared${shortHash(key)}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base}${suffix++}`;
    used.add(name);
    schemas[name] = structuredClone(first.schema);
    const reference = { $ref: `#/components/schemas/${name}` };
    slots.forEach((slot) => {
      slot.replace(reference);
    });
  }
  components['schemas'] = schemas;
  document['components'] = components;
}

/** Collapse identical named components and rewrite their references. */
export function deduplicateComponentSchemas(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const groups = new Map<string, string[]>();
  for (const [name, schema] of Object.entries(schemas)) {
    if (!isObject(schema)) continue;
    const key = canonical(schema);
    const names = groups.get(key) ?? [];
    names.push(name);
    groups.set(key, names);
  }

  const redirects = new Map<string, string>();
  for (const names of groups.values()) {
    if (names.length < 2) continue;
    const keep = [...names].sort((left, right) => left.length - right.length)[0];
    if (!keep) continue;
    for (const name of names) {
      if (name === keep) continue;
      redirects.set(`#/components/schemas/${name}`, `#/components/schemas/${keep}`);
      Reflect.deleteProperty(schemas, name);
    }
  }
  rewriteLocalDefinitionRefs(document, redirects);
  components['schemas'] = schemas;
  document['components'] = components;
}

/** Store identical operation examples once on their referenced schema. */
export function hoistReferencedExamples(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const visitContent = (content: unknown): void => {
    if (!isObject(content)) return;
    for (const media of Object.values(content)) {
      if (!isObject(media) || !('example' in media) || !isObject(media['schema'])) continue;
      const reference = media['schema']['$ref'];
      if (typeof reference !== 'string' || !reference.startsWith('#/components/schemas/')) continue;
      const name = reference.slice('#/components/schemas/'.length);
      const schema = schemas[name];
      if (!isObject(schema)) continue;
      if (!('example' in schema)) schema['example'] = media['example'];
      if (canonical(schema['example']) === canonical(media['example'])) delete media['example'];
    }
  };

  for (const { operation } of operations(document)) {
    const body = isObject(operation['requestBody']) ? operation['requestBody'] : undefined;
    visitContent(body?.['content']);
    for (const [, response] of statusEntries(operation)) visitContent(response['content']);
  }
}

/** Remove component schemas that no operation or component can reach. */
export function pruneUnreferencedSchemas(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const reachable = new Set<string>();
  const pending: string[] = [];
  const collectReferences = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collectReferences);
      return;
    }
    if (!isObject(value)) return;
    const reference = value['$ref'];
    if (typeof reference === 'string' && reference.startsWith('#/components/schemas/')) {
      const name = reference.slice('#/components/schemas/'.length);
      if (!reachable.has(name)) {
        reachable.add(name);
        pending.push(name);
      }
    }
    for (const child of Object.values(value)) collectReferences(child);
  };

  collectReferences(document['paths']);
  for (const [section, value] of Object.entries(components)) {
    if (section !== 'schemas') collectReferences(value);
  }
  while (pending.length > 0) {
    const name = pending.pop();
    if (name) collectReferences(schemas[name]);
  }
  for (const name of Object.keys(schemas)) {
    if (!reachable.has(name)) Reflect.deleteProperty(schemas, name);
  }
  components['schemas'] = schemas;
  document['components'] = components;
}

/** Replace repeated operation parameters with reusable components. */
export function hoistRepeatedParameters(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const parameters = isObject(components['parameters']) ? components['parameters'] : {};
  const groups = new Map<
    string,
    { parameter: JsonObject; slots: { list: unknown[]; index: number }[] }
  >();
  for (const { operation } of operations(document)) {
    const list = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
    list.forEach((parameter, index) => {
      if (!isObject(parameter) || '$ref' in parameter) return;
      const key = canonical(parameter);
      const group = groups.get(key) ?? { parameter, slots: [] };
      group.slots.push({ list, index });
      groups.set(key, group);
    });
  }
  for (const [key, group] of groups) {
    if (group.slots.length < 2) continue;
    const name = `SharedParameter${shortHash(key)}`;
    parameters[name] = group.parameter;
    const reference = { $ref: `#/components/parameters/${name}` };
    group.slots.forEach(({ list, index }) => {
      list[index] = reference;
    });
  }
  components['parameters'] = parameters;
  document['components'] = components;
}

/** Move parameters shared by every method to their common path item. */
export function moveSharedPathParameters(document: JsonObject): void {
  const paths = isObject(document['paths']) ? document['paths'] : {};
  for (const pathItem of Object.values(paths)) {
    if (!isObject(pathItem)) continue;
    const pathOperations = HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method];
      return isObject(operation) ? [operation] : [];
    });
    if (pathOperations.length < 2) continue;
    const first = Array.isArray(pathOperations[0]?.['parameters'])
      ? pathOperations[0]['parameters']
      : [];
    const common = first.filter((parameter) =>
      pathOperations.every((operation) => {
        const list = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
        return list.some((candidate) => canonical(candidate) === canonical(parameter));
      }),
    );
    if (common.length === 0) continue;
    const keys = new Set(common.map(canonical));
    pathItem['parameters'] = common;
    for (const operation of pathOperations) {
      const list = Array.isArray(operation['parameters']) ? operation['parameters'] : [];
      operation['parameters'] = list.filter((parameter) => !keys.has(canonical(parameter)));
    }
  }
}

/** Replace repeated response objects with reusable components. */
export function hoistRepeatedResponses(document: JsonObject): void {
  const components = isObject(document['components']) ? document['components'] : {};
  const responses = isObject(components['responses']) ? components['responses'] : {};
  const groups = new Map<
    string,
    { response: JsonObject; slots: { owner: JsonObject; status: string }[] }
  >();
  for (const { operation } of operations(document)) {
    for (const [status, response] of statusEntries(operation)) {
      if ('$ref' in response) continue;
      const key = canonical(response);
      const group = groups.get(key) ?? { response, slots: [] };
      group.slots.push({ owner: operation['responses'] as JsonObject, status });
      groups.set(key, group);
    }
  }
  for (const [key, group] of groups) {
    if (group.slots.length < 2) continue;
    const name = `SharedResponse${shortHash(key)}`;
    responses[name] = group.response;
    const reference = { $ref: `#/components/responses/${name}` };
    group.slots.forEach(({ owner, status }) => {
      owner[status] = reference;
    });
  }
  components['responses'] = responses;
  document['components'] = components;
}

/** Return component-schema references whose targets do not exist. */
export function unresolvedSchemaReferences(document: JsonObject): readonly string[] {
  const components = isObject(document['components']) ? document['components'] : {};
  const schemas = isObject(components['schemas']) ? components['schemas'] : {};
  const unresolved = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isObject(value)) return;
    const reference = value['$ref'];
    if (typeof reference === 'string' && reference.startsWith('#/components/schemas/')) {
      const name = reference.slice('#/components/schemas/'.length);
      if (!isObject(schemas[name])) unresolved.add(name);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
  return [...unresolved].sort();
}

/** Apply all public-reference rules to one generated OpenAPI document. */
