/**
 * Anthropic-backed Athena adapter for Work's email-to-task drafting port.
 *
 * The Work domain owns the draft language. This adapter owns prompt construction, provider
 * interaction, and safe recovery from malformed model output.
 */
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from '@anthropic-ai/sdk/resources/messages';
import type { Priority } from '@docket/work/task-contract';
import type { TaskDraft, TaskDraftInput, TaskSynthesizer } from '@docket/work/task-drafting';
import { truncateTitle } from '@docket/work/task-titles';

import {
  constrainTaskExpansion,
  type ExpansionDependency,
  type ExpansionPropertyPatch,
  type ExpansionSubtask,
  type TaskExpansionCandidate,
  type TaskExpansionInput,
  type TaskExpansionResult,
  type TaskExpansionSynthesizer,
} from '../../task-expansion';

import {
  type AnthropicClientConfig,
  makeAnthropicClient,
  wrapAnthropicError,
} from '../../anthropic';

/** The default model for producing one actionable task draft. */
export const DEFAULT_SYNTHESIS_MODEL = 'claude-opus-4-8';

/** Construction configuration for {@link RealTaskSynthesizer}. */
export interface RealTaskSynthesizerConfig extends AnthropicClientConfig {
  /** Override the default synthesis model. */
  readonly model?: string;
}

const SYSTEM_PROMPT = [
  'You convert an email thread into a single, action-oriented task for the recipient.',
  'The title must state what the recipient should DO (start with a verb), not echo the subject.',
  'Reply with ONLY a JSON object: {"title": string, "description": string, "priority": "none"|"urgent"|"high"|"medium"|"low", "dueDate": "YYYY-MM-DD" | null}.',
  'Keep the title under 120 characters; the description one short sentence on why it matters.',
  'Set dueDate ONLY when the email states an explicit date or deadline; otherwise null — never guess.',
].join(' ');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES: readonly Priority[] = ['none', 'urgent', 'high', 'medium', 'low'];

const EXPANSION_SYSTEM_PROMPT = [
  'Expand one existing task description in place.',
  'Preserve every authored statement and every selected-template section.',
  'Do not invent facts, owners, deadlines, dependencies, or links.',
  'Only use task ids listed in the input, and only emit a dependency when the source explicitly states the sequencing.',
  'Every subtask and dependency requires evidence: quote an exact non-empty excerpt from the authored description. A child quote must name its outcome. A dependency quote must name both task titles and explicitly state a wait or block.',
  'Reply with only JSON: {"description":string,"patch":object,"subtasks":[{"title":string,"description"?:string,"evidence":string}],"dependencies":[{"blockingTaskId":string,"blockedTaskId":string,"evidence":string}],"relatedTaskIds":[string],"resourceUrls":[string]}.',
].join(' ');

/** Injectable boundary around the Anthropic Messages API. */
export type MessageCreator = (params: MessageCreateParamsNonStreaming) => Promise<Message>;

/** Build the non-streaming provider request for one email-derived task. */
export function buildRequest(
  input: TaskDraftInput,
  config: RealTaskSynthesizerConfig,
): MessageCreateParamsNonStreaming {
  const user = `From: ${input.sender}\nSubject: ${input.subject}\n\n${input.snippet}`;
  return {
    model: config.model ?? DEFAULT_SYNTHESIS_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: user }],
  };
}

/** Build the provider request for a task-description expansion. */
export function buildExpansionRequest(
  input: TaskExpansionInput,
  config: RealTaskSynthesizerConfig,
): MessageCreateParamsNonStreaming {
  return {
    model: config.model ?? DEFAULT_SYNTHESIS_MODEL,
    max_tokens: 1_000,
    system: EXPANSION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  };
}

/** Join the text blocks in a completed provider message. */
export function extractText(message: Message): string {
  return message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim();
}

/** Build the live provider boundary from Athena's Anthropic configuration. */
export function defaultMessageCreator(config: RealTaskSynthesizerConfig): MessageCreator {
  /* v8 ignore start -- live Anthropic SDK edge */
  const client = makeAnthropicClient(config);
  return (params) => client.messages.create(params);
  /* v8 ignore stop */
}

/** Build the safe Work draft used when provider output is unusable. */
export function fallbackDraft(input: TaskDraftInput): TaskDraft {
  const description = input.snippet.trim();
  return {
    title: truncateTitle(input.subject),
    priority: 'medium',
    ...(description ? { description } : {}),
  };
}

/** Parse the provider's JSON reply into a Work draft, returning `null` when malformed. */
export function parseDraft(text: string): TaskDraft | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const title = typeof parsed['title'] === 'string' ? parsed['title'].trim() : '';
    if (!title) return null;

    const priority = PRIORITIES.includes(parsed['priority'] as Priority)
      ? (parsed['priority'] as Priority)
      : 'medium';
    const description =
      typeof parsed['description'] === 'string' && parsed['description'].trim().length > 0
        ? parsed['description'].trim()
        : undefined;
    const dueDate =
      typeof parsed['dueDate'] === 'string' && ISO_DATE.test(parsed['dueDate'])
        ? parsed['dueDate']
        : undefined;

    return {
      title,
      priority,
      ...(description ? { description } : {}),
      ...(dueDate ? { dueDate } : {}),
    };
  } catch {
    return null;
  }
}

/** Return a record only when a provider JSON value is an ordinary object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Parse an array of strings without accepting provider-shaped lookalikes. */
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Parse the deliberately small property vocabulary an expansion may infer. */
function parseExpansionPatch(value: unknown): ExpansionPropertyPatch {
  const record = asRecord(value);
  if (!record) return {};
  const priority = record['priority'];
  return {
    ...(PRIORITIES.includes(priority as Priority) ? { priority: priority as Priority } : {}),
    ...(typeof record['assigneeId'] === 'string' ? { assigneeId: record['assigneeId'] } : {}),
    ...(typeof record['projectId'] === 'string' ? { projectId: record['projectId'] } : {}),
    ...(typeof record['dueDate'] === 'string' ? { dueDate: record['dueDate'] } : {}),
    ...(typeof record['startDate'] === 'string' ? { startDate: record['startDate'] } : {}),
    ...(typeof record['estimateMinutes'] === 'number' && Number.isInteger(record['estimateMinutes'])
      ? { estimateMinutes: record['estimateMinutes'] }
      : {}),
    ...(Array.isArray(record['labelIds']) ? { labelIds: stringArray(record['labelIds']) } : {}),
  };
}

/** Parse one provider child proposal. */
function parseSubtasks(value: unknown): ExpansionSubtask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record || typeof record['title'] !== 'string' || typeof record['evidence'] !== 'string')
      return [];
    return [
      {
        title: record['title'],
        ...(typeof record['description'] === 'string'
          ? { description: record['description'] }
          : {}),
        evidence: record['evidence'],
      },
    ];
  });
}

/** Parse one provider dependency proposal. */
function parseDependencies(value: unknown): ExpansionDependency[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (
      !record ||
      typeof record['blockingTaskId'] !== 'string' ||
      typeof record['blockedTaskId'] !== 'string' ||
      typeof record['evidence'] !== 'string'
    )
      return [];
    return [
      {
        blockingTaskId: record['blockingTaskId'],
        blockedTaskId: record['blockedTaskId'],
        evidence: record['evidence'],
      },
    ];
  });
}

/** Parse provider JSON into a candidate expansion, or reject it as unusable. */
export function parseExpansion(text: string): TaskExpansionCandidate | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const record = asRecord(JSON.parse(text.slice(start, end + 1)));
    if (!record || typeof record['description'] !== 'string') return null;
    return {
      description: record['description'],
      patch: parseExpansionPatch(record['patch']),
      subtasks: parseSubtasks(record['subtasks']),
      dependencies: parseDependencies(record['dependencies']),
      relatedTaskIds: stringArray(record['relatedTaskIds']),
      resourceUrls: stringArray(record['resourceUrls']),
    };
  } catch {
    return null;
  }
}

/** Athena's live Anthropic task-drafting adapter. */
export class RealTaskSynthesizer implements TaskSynthesizer, TaskExpansionSynthesizer {
  private readonly config: RealTaskSynthesizerConfig;
  private readonly creator: MessageCreator;

  /**
   * @param config - Provider credentials plus an optional model override.
   * @param creator - Optional provider seam; defaults to the live SDK client.
   */
  constructor(config: RealTaskSynthesizerConfig, creator?: MessageCreator) {
    this.config = config;
    this.creator = creator ?? defaultMessageCreator(config);
  }

  /** {@inheritDoc TaskSynthesizer.synthesize} */
  async synthesize(input: TaskDraftInput): Promise<TaskDraft> {
    const params = buildRequest(input, this.config);
    let text: string;
    try {
      const message = await this.creator(params);
      text = extractText(message);
    } catch (cause) {
      throw wrapAnthropicError(cause, 'task synthesis');
    }
    return parseDraft(text) ?? fallbackDraft(input);
  }

  /** Expand a task description while the domain service enforces the closed result shape. */
  async expandTask(input: TaskExpansionInput): Promise<TaskExpansionResult> {
    let text: string;
    try {
      text = extractText(await this.creator(buildExpansionRequest(input, this.config)));
    } catch (cause) {
      throw wrapAnthropicError(cause, 'task expansion');
    }
    return constrainTaskExpansion(
      input,
      parseExpansion(text) ?? { description: input.description ?? '' },
    );
  }
}
