import type {
  ExpansionDependency,
  ExpansionPropertyPatch,
  ExpansionSubtask,
  TaskExpansionCandidate,
  TaskExpansionInput,
  TaskExpansionResult,
} from './contracts';

/** Keep a Markdown segment once without treating whitespace as a meaningful difference. */
function appendMissing(description: string, segment: string | null | undefined): string {
  const normalized = segment?.trim();
  if (!normalized || description.includes(normalized)) return description;
  return description.trim() ? `${description.trim()}\n\n${normalized}` : normalized;
}

/** Parse one absolute web URL to the canonical form the resource store exposes. */
function canonicalWebUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Read absolute web URLs from already-authored text so preserving it never destroys a source. */
function urlsInDescription(value: string | null | undefined): Set<string> {
  const urls = new Set<string>();
  for (const match of value?.matchAll(/https?:\/\/[^\s)<>{}\]]+/g) ?? []) {
    const url = canonicalWebUrl(match[0]);
    if (url) urls.add(url);
  }
  return urls;
}

/** Preserve only resolved task-resource URLs, never a provider-supplied source. */
function safeResourceUrls(
  input: TaskExpansionInput,
  urls: readonly string[] | undefined,
): string[] {
  const allowed = new Set<string>([
    ...urlsInDescription(input.description),
    ...(input.resources ?? []).flatMap((resource) => {
      const url = resource.url === null ? null : canonicalWebUrl(resource.url);
      return url ? [url] : [];
    }),
  ]);
  const seen = new Set<string>();
  for (const url of urls ?? []) {
    const canonical = canonicalWebUrl(url);
    if (canonical && allowed.has(canonical)) seen.add(canonical);
  }
  return [...seen];
}

/** Remove new provider URLs before they can enter a description or become a task resource. */
function removeUnresolvedUrls(description: string, input: TaskExpansionInput): string {
  const allowed = new Set<string>([
    ...urlsInDescription(input.description),
    ...(input.resources ?? []).flatMap((resource) => {
      const url = resource.url === null ? null : canonicalWebUrl(resource.url);
      return url ? [url] : [];
    }),
  ]);
  return description.replace(/https?:\/\/[^\s)<>{}\]]+/g, (raw) => {
    const url = canonicalWebUrl(raw);
    return url && allowed.has(url) ? raw : '';
  });
}

/** Add a resource link to Markdown only when the candidate did not already place it there. */
function addResourceUrls(description: string, urls: readonly string[]): string {
  return urls.reduce(
    (current, url) =>
      current.includes(url) ? current : appendMissing(current, `[Resource](${url})`),
    description,
  );
}

/** Omit inferences for values a person already chose. */
function missingOnly(
  input: TaskExpansionInput,
  patch: ExpansionPropertyPatch | undefined,
): ExpansionPropertyPatch {
  const defaults = input.templateDefaults;
  return {
    ...(input.explicit.priority === undefined
      ? { priority: patch?.priority ?? defaults?.priority }
      : {}),
    ...(input.explicit.assigneeId === undefined || input.explicit.assigneeId === null
      ? { assigneeId: patch?.assigneeId }
      : {}),
    ...(input.explicit.projectId === undefined || input.explicit.projectId === null
      ? { projectId: patch?.projectId }
      : {}),
    ...(input.explicit.dueDate === undefined || input.explicit.dueDate === null
      ? { dueDate: patch?.dueDate }
      : {}),
    ...(input.explicit.startDate === undefined || input.explicit.startDate === null
      ? { startDate: patch?.startDate }
      : {}),
    ...(input.explicit.estimateMinutes === undefined || input.explicit.estimateMinutes === null
      ? { estimateMinutes: patch?.estimateMinutes }
      : {}),
    ...(input.explicit.labelIds === undefined
      ? {
          labelIds:
            defaults?.labelIds === undefined
              ? patch?.labelIds === undefined
                ? undefined
                : [...patch.labelIds]
              : [...defaults.labelIds],
        }
      : {}),
  };
}

const NON_MEANINGFUL_TITLE_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/** Normalize authored wording before comparing evidence with a proposed outcome. */
function meaningfulWords(value: string): string[] {
  return (
    value
      .toLocaleLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => word.length > 1 && !NON_MEANINGFUL_TITLE_WORDS.has(word)) ?? []
  );
}

/** Match a quote against the precise text the person saved, rather than model-supplied Markdown. */
function authoredExcerpt(description: string | null, evidence: unknown): string | null {
  if (typeof evidence !== 'string') return null;
  const excerpt = evidence.trim();
  return excerpt && description?.includes(excerpt) ? excerpt : null;
}

/** A generated outcome must be recognizably named in its own authored quote. */
function evidenceNamesOutcome(evidence: string, title: string): boolean {
  const evidenceWords = new Set(meaningfulWords(evidence));
  const namesOutcome = (value: string): boolean => {
    const words = meaningfulWords(value);
    return words.length > 0 && words.every((word) => evidenceWords.has(word));
  };
  return namesOutcome(title);
}

/** Keep only concise, non-empty children that the original description itself supports. */
function validSubtasks(
  input: TaskExpansionInput,
  subtasks: readonly ExpansionSubtask[] | undefined,
): ExpansionSubtask[] {
  const seen = new Set<string>();
  const valid: ExpansionSubtask[] = [];
  for (const subtask of subtasks ?? []) {
    const title = subtask.title.trim();
    const description = subtask.description?.trim();
    const evidence = authoredExcerpt(input.description, subtask.evidence);
    if (!title || !evidence || !evidenceNamesOutcome(evidence, title) || seen.has(title)) continue;
    seen.add(title);
    valid.push({ title, ...(description ? { description } : {}), evidence });
  }
  return valid;
}

/** Find the only name evidence may use for a dependency endpoint. */
function taskTitleById(input: TaskExpansionInput): Map<string, string> {
  return new Map<string, string>([
    [input.taskId, input.title],
    ...input.availableTasks.map((task): [string, string] => [task.id, task.title]),
  ]);
}

/** Dependency evidence must state a real wait or block rather than a loose association. */
function evidenceStatesBlocking(evidence: string): boolean {
  return (
    /\b(?:block(?:ed|ing|s)?|wait(?:ing|s)?|depend(?:s|ed|ency|ent)?|until)\b/i.test(evidence) ||
    /\b(?:must|cannot|can't|only)\b[^.\n]{0,80}\b(?:before|after)\b/i.test(evidence)
  );
}

/** Dependency evidence names both endpoint tasks using their supplied titles. */
function evidenceNamesDependencyEndpoints(
  evidence: string,
  blockingTitle: string | undefined,
  blockedTitle: string | undefined,
): boolean {
  if (!blockingTitle || !blockedTitle) return false;
  const normalizedEvidence = evidence.replace(/\s+/g, ' ').toLocaleLowerCase();
  return [blockingTitle, blockedTitle].every((title) =>
    normalizedEvidence.includes(title.trim().replace(/\s+/g, ' ').toLocaleLowerCase()),
  );
}

/** Keep only directed edges that use task ids the route supplied as context. */
function validDependencies(
  input: TaskExpansionInput,
  dependencies: readonly ExpansionDependency[] | undefined,
): ExpansionDependency[] {
  const known = new Set([input.taskId, ...input.availableTasks.map((task) => task.id)]);
  const titles = taskTitleById(input);
  const seen = new Set<string>();
  const valid: ExpansionDependency[] = [];
  for (const dependency of dependencies ?? []) {
    const key = `${dependency.blockingTaskId}:${dependency.blockedTaskId}`;
    const evidence = authoredExcerpt(input.description, dependency.evidence);
    if (
      dependency.blockingTaskId === dependency.blockedTaskId ||
      !known.has(dependency.blockingTaskId) ||
      !known.has(dependency.blockedTaskId) ||
      (dependency.blockingTaskId !== input.taskId && dependency.blockedTaskId !== input.taskId) ||
      !evidence ||
      !evidenceStatesBlocking(evidence) ||
      !evidenceNamesDependencyEndpoints(
        evidence,
        titles.get(dependency.blockingTaskId),
        titles.get(dependency.blockedTaskId),
      ) ||
      seen.has(key)
    )
      continue;
    seen.add(key);
    valid.push({ ...dependency, evidence });
  }
  return valid;
}

/** Apply the task-expansion safety rules at the model boundary. */
export function constrainTaskExpansion(
  input: TaskExpansionInput,
  candidate: TaskExpansionCandidate,
): TaskExpansionResult {
  const resourceUrls = safeResourceUrls(input, candidate.resourceUrls);
  const authoredDescription = input.description?.trim();
  const templateDescription = input.templateDescription?.trim();
  let description = removeUnresolvedUrls(candidate.description.trim(), input);
  description = appendMissing(description, authoredDescription);
  description = appendMissing(description, templateDescription);
  description = addResourceUrls(description, resourceUrls);

  const known = new Set(input.availableTasks.map((task) => task.id));
  const relatedTaskIds = [...new Set(candidate.relatedTaskIds ?? [])].filter(
    (taskId) => taskId !== input.taskId && known.has(taskId),
  );

  return {
    description,
    patch: missingOnly(input, candidate.patch),
    subtasks: validSubtasks(input, candidate.subtasks),
    dependencies: validDependencies(input, candidate.dependencies),
    relatedTaskIds,
    resourceUrls,
  };
}
