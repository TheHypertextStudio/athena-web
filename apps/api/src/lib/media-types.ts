/**
 * `@docket/api` — request and response media-type negotiation.
 *
 * @remarks
 * Two halves of RFC 9110 §12 that this API previously did not implement at all.
 *
 * On the way in: a body arriving under a `Content-Type` nothing here reads used to reach
 * `c.req.json()`, throw a parse error, and surface as **500** — the server reporting its own
 * failure for a mistake the client made and can fix. §15.5.16 has `415` for exactly this.
 *
 * On the way out: `Accept` was ignored. That is permitted — §12.5.1 lets a server disregard it —
 * but silently returning JSON to a client that asked for XML is worse for that client than
 * telling it plainly, and `406` is a shorter conversation than a parse failure two layers away.
 *
 * A missing `Accept` means "anything" and is never refused. A missing `Content-Type` on a
 * request that *does* carry a body is refused, because nothing downstream can read it: Hono's
 * JSON validator declines to parse an undeclared body and hands the schema an empty object, so
 * the caller received a `422` complaining that fields were missing which it had in fact sent.
 * `415` says the true thing — the body could not be read at all — and names what to declare.
 */
import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from '../context';
import { NotAcceptableError, UnsupportedMediaTypeError } from '../error';
import { operationContractForRequest, type ApiOperationContract } from './api-operation-contract';

/** The representation every endpoint answers with. */
const JSON_MEDIA_TYPE = 'application/json';

/** The successful representation produced by legacy JSON operations. */
const PRODUCED = [JSON_MEDIA_TYPE] as const;

/**
 * Everything this API can consume.
 *
 * @remarks
 * The two form encodings are here because file upload and the OAuth token endpoint need them;
 * a route that only reads JSON still rejects a form body at its schema, with a far better
 * message than this layer could give.
 */
const CONSUMED = ['application/json', 'multipart/form-data', 'application/x-www-form-urlencoded'];

/** Methods that may carry a request body worth type-checking. */
const BODIED = new Set(['POST', 'PUT', 'PATCH']);

/** The bare media type, without parameters like `; charset=utf-8` or a multipart boundary. */
function bare(value: string): string {
  return (value.split(';')[0] ?? '').trim().toLowerCase();
}

interface MediaRange {
  readonly type: string;
  readonly subtype: string;
  readonly quality: number;
  readonly parameterCount: number;
  readonly order: number;
}

interface RangeSelection {
  readonly range: MediaRange;
  readonly specificity: number;
}

function splitHeader(value: string): string[] {
  const entries: string[] = [];
  let entry = '';
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      entry += character;
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      entry += character;
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (character === ',' && !quoted) {
      entries.push(entry);
      entry = '';
      continue;
    }
    entry += character;
  }
  entries.push(entry);
  return entries;
}

function parseRange(value: string, order: number): MediaRange | undefined {
  const [rawType, ...rawParameters] = value.split(';');
  const mediaType = rawType?.trim().toLowerCase() ?? '';
  const match = /^([a-z0-9!#$&^_.+*-]+)\/([a-z0-9!#$&^_.+*-]+)$/.exec(mediaType);
  if (!match || (match[1] === '*' && match[2] !== '*')) return undefined;

  let quality = 1;
  let parameterCount = 0;
  for (const rawParameter of rawParameters) {
    const separator = rawParameter.indexOf('=');
    if (separator < 1) return undefined;
    const name = rawParameter.slice(0, separator).trim().toLowerCase();
    const rawValue = rawParameter.slice(separator + 1).trim();
    if (name === 'q') {
      if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(rawValue)) return undefined;
      quality = Number(rawValue);
    } else {
      parameterCount += 1;
    }
  }

  return {
    type: match[1] ?? '',
    subtype: match[2] ?? '',
    quality,
    parameterCount,
    order,
  };
}

function matchSpecificity(
  range: MediaRange,
  offeredType: string,
  offeredSubtype: string,
): number | undefined {
  if (range.type !== '*' && range.type !== offeredType) return undefined;
  if (range.subtype !== '*' && range.subtype !== offeredSubtype) return undefined;
  if (range.type === '*') return 0;
  return range.subtype === '*' ? 1 : 2;
}

function outranksRange(
  range: MediaRange,
  specificity: number,
  selected: RangeSelection | undefined,
): boolean {
  if (!selected) return true;
  if (specificity !== selected.specificity) return specificity > selected.specificity;
  if (range.parameterCount !== selected.range.parameterCount) {
    return range.parameterCount > selected.range.parameterCount;
  }
  return range.order < selected.range.order;
}

function effectiveRange(ranges: readonly MediaRange[], offered: string): MediaRange | undefined {
  const [offeredType, offeredSubtype] = bare(offered).split('/');
  if (!offeredType || !offeredSubtype) return undefined;

  let selected: RangeSelection | undefined;
  for (const range of ranges) {
    const specificity = matchSpecificity(range, offeredType, offeredSubtype);
    if (specificity === undefined) continue;
    if (outranksRange(range, specificity, selected)) {
      selected = { range, specificity };
    }
  }
  return selected?.range;
}

function preferredOffer(ranges: readonly MediaRange[], offered: readonly string[]): string | null {
  let selection: { readonly offered: string; readonly quality: number } | undefined;
  for (const candidate of offered) {
    const range = effectiveRange(ranges, candidate);
    if (!range || range.quality === 0) continue;
    if (!selection || range.quality > selection.quality) {
      selection = { offered: candidate, quality: range.quality };
    }
  }
  return selection?.offered ?? null;
}

/**
 * Select one offered representation using the most specific matching Accept range.
 *
 * @param accept - The raw Accept header, or undefined when the client accepts anything.
 * @param offered - Successful response media types in server-preference order.
 * @returns the selected offered media type, or null when the client refused every offer.
 */
export function negotiateMediaType(
  accept: string | undefined,
  offered: readonly string[],
): string | null {
  if (offered.length === 0) return null;
  if (accept === undefined || accept.trim() === '') return offered[0] ?? null;

  const ranges = splitHeader(accept)
    .map((entry, order) => parseRange(entry.trim(), order))
    .filter((range): range is MediaRange => range !== undefined);
  if (ranges.length === 0) return null;
  return preferredOffer(ranges, offered);
}

/**
 * Refuse a body this API cannot read, and a request whose `Accept` it cannot satisfy.
 *
 * @remarks
 * A range with `q=0` explicitly refuses that type, so it does not count as coverage — a client
 * sending `Accept: application/json;q=0` has said it will not take JSON, and there is nothing
 * else to offer.
 */
async function enforceRequestMediaType(c: Parameters<MiddlewareHandler<AppEnv>>[0]): Promise<void> {
  // `raw.body` rather than `Content-Length`: the length is often computed at send time and is
  // absent on the request object, while the stream is the authoritative answer to "is there
  // content here". A `POST` to a controller resource frequently carries none, and demanding a
  // type to describe an absent body would reject a well-formed call.
  if (BODIED.has(c.req.method) && c.req.raw.body !== null) {
    const type = bare(c.req.header('Content-Type') ?? '');
    if (type === '' || (!CONSUMED.includes(type) && !type.endsWith('+json'))) {
      // Next's reverse proxy turns a bodyless POST into a zero-byte stream. The stream is not a
      // representation, so it needs no media type. Read a clone only on this invalid-type path;
      // valid request bodies still reach their route without an extra buffering pass.
      const hasContent = (await c.req.raw.clone().arrayBuffer()).byteLength > 0;
      if (hasContent) throw new UnsupportedMediaTypeError(CONSUMED);
    }
  }
}

function successfulMediaTypes(contract: ApiOperationContract): readonly string[] {
  return [
    ...new Set(
      contract.success.flatMap((outcome) => {
        switch (outcome.kind) {
          case 'json':
            return ['application/json'];
          case 'binary':
            return outcome.mediaTypes;
          case 'sse':
            return ['text/event-stream'];
          case 'empty':
            return [];
        }
      }),
    ),
  ];
}

function enforceResponseMediaType(
  c: Parameters<MiddlewareHandler<AppEnv>>[0],
  offered: readonly string[],
): void {
  if (offered.length === 0) return;
  if (negotiateMediaType(c.req.header('Accept'), offered) === null) {
    throw new NotAcceptableError();
  }
}

/** Apply request and success-representation negotiation for one strict operation contract. */
export function operationMediaTypes(contract: ApiOperationContract): MiddlewareHandler<AppEnv> {
  const offered = successfulMediaTypes(contract);
  return async (c, next) => {
    await enforceRequestMediaType(c);
    enforceResponseMediaType(c, offered);
    await next();
  };
}

/** Temporary negotiation for legacy routes that Task 4 has not migrated yet. */
export const mediaTypes: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (operationContractForRequest(c)) {
    await next();
    return;
  }

  await enforceRequestMediaType(c);

  enforceResponseMediaType(c, PRODUCED);

  await next();
};
