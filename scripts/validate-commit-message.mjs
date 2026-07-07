#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const bodyLineWidth = 72;
const minimumBodyCharacters = 20;

const allowedTypes = new Set([
  'build',
  'chore',
  'ci',
  'docs',
  'feat',
  'fix',
  'perf',
  'refactor',
  'revert',
  'style',
  'test',
]);

const allowedScopes = new Set(
  readFileSync(new URL('../COMMIT_SCOPES.txt', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')),
);

const generatedMessages = [/^Merge /, /^Revert "/];

const commitMessagePath = process.argv[2];

if (!commitMessagePath) {
  console.error('commit-msg hook expected the commit message file path.');
  process.exit(1);
}

const message = readFileSync(commitMessagePath, 'utf8');
const subject = message
  .split('\n')
  .find((line) => line.trim() && !line.startsWith('#'))
  ?.trim();

if (!subject || generatedMessages.some((pattern) => pattern.test(subject))) {
  process.exit(0);
}

const conventionalSubject =
  /^(?<type>[a-z]+)(?:\((?<scope>[a-z][a-z0-9-]*)\))?(?<breaking>!)?: (?<description>.+)$/.exec(
    subject,
  );

function fail(reason) {
  console.error(`Invalid commit message: ${reason}`);
  console.error('');
  console.error(`Subject: ${subject}`);
  console.error('');
  console.error('Use Conventional Commits: <type>(<scope>): <description>');
  console.error('Scope is optional, but if present it must be a product/domain scope.');
  console.error('');
  console.error(`Allowed types: ${[...allowedTypes].join(', ')}`);
  console.error(`Allowed scopes: ${[...allowedScopes].join(', ')}`);
  console.error('');
  console.error('Examples:');
  console.error('  feat(auth): add passkey recovery');
  console.error('  fix(integrations): preserve connector OAuth state');
  console.error('  chore: update repository maintenance docs');
  process.exit(1);
}

function changedFileCount() {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean).length;
  } catch {
    return 0;
  }
}

function isComment(line) {
  return line.startsWith('#');
}

function isFence(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

function isIndentedCode(line) {
  return /^(?: {4}|\t)/.test(line);
}

function isCommitTrailer(line) {
  return /^(?:BREAKING CHANGE|Co-authored-by|Signed-off-by|Reviewed-by|Acked-by|Refs|Fixes|Closes)(?:!?):\s+\S/.test(
    line,
  );
}

function wrapText(prefix, text, subsequentPrefix = prefix) {
  const width = Math.max(20, bodyLineWidth - prefix.length);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(`${lines.length === 0 ? prefix : subsequentPrefix}${current}`);
      current = word;
    }
  }

  if (current) lines.push(`${lines.length === 0 ? prefix : subsequentPrefix}${current}`);
  return lines;
}

function wrapBodyLine(line) {
  const bullet = /^(\s*(?:[-*+]|\d+[.)])\s+)(.+)$/.exec(line);
  if (bullet) return wrapText(bullet[1], bullet[2], ' '.repeat(bullet[1].length));

  const indented = /^(\s*)(.+)$/.exec(line);
  if (!indented) return [line];
  return wrapText(indented[1], indented[2]);
}

function paragraphPrefix(lines) {
  const first = lines[0] ?? '';
  const bullet = /^(\s*(?:[-*+]|\d+[.)])\s+)(.+)$/.exec(first);
  if (bullet) {
    return {
      prefix: bullet[1],
      subsequentPrefix: ' '.repeat(bullet[1].length),
      firstText: bullet[2],
    };
  }

  const indent = /^(\s*)(.+)$/.exec(first);
  return {
    prefix: indent?.[1] ?? '',
    subsequentPrefix: indent?.[1] ?? '',
    firstText: indent?.[2] ?? first,
  };
}

function wrapParagraph(lines) {
  if (lines.length === 0) return [];
  if (lines.length === 1) return wrapBodyLine(lines[0]);

  const { prefix, subsequentPrefix, firstText } = paragraphPrefix(lines);
  let text = firstText.trim();

  for (const line of lines.slice(1)) {
    const next = line.trim();
    text = text.endsWith('-') ? `${text}${next}` : `${text} ${next}`;
  }

  text = text.replace(/\s+/g, ' ').trim();

  return wrapText(prefix, text, subsequentPrefix);
}

function sentenceCase(text) {
  return text.replace(/[A-Za-z]/, (letter) => letter.toUpperCase());
}

function formatSubjectLine(line) {
  return line.replace(
    /^([a-z]+(?:\([a-z][a-z0-9-]*\))?!?: )(.+)$/,
    (_match, prefix, description) => `${prefix}${sentenceCase(description)}`,
  );
}

function formatCommitMessage(raw) {
  const hasFinalNewline = raw.endsWith('\n');
  const lines = raw.replace(/\n$/, '').split('\n');
  const subjectIndex = lines.findIndex((line) => line.trim() && !isComment(line));
  if (subjectIndex === -1) return raw;

  const out = lines.slice(0, subjectIndex + 1);
  out[subjectIndex] = formatSubjectLine(out[subjectIndex]);
  let inFence = false;
  let paragraph = [];

  const flushParagraph = () => {
    out.push(...wrapParagraph(paragraph));
    paragraph = [];
  };

  for (const line of lines.slice(subjectIndex + 1)) {
    if (isFence(line)) {
      flushParagraph();
      out.push(line);
      inFence = !inFence;
      continue;
    }

    if (inFence || isComment(line) || line.trim() === '' || isCommitTrailer(line)) {
      flushParagraph();
      out.push(line);
      continue;
    }

    if (isIndentedCode(line) && paragraph.length === 0) {
      out.push(line);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return `${out.join('\n')}${hasFinalNewline ? '\n' : ''}`;
}

function bodyText(raw) {
  const lines = raw.replace(/\n$/, '').split('\n');
  const subjectIndex = lines.findIndex((line) => line.trim() && !isComment(line));
  if (subjectIndex === -1) return '';

  let inFence = false;
  const bodyLines = [];

  for (const line of lines.slice(subjectIndex + 1)) {
    if (isFence(line)) {
      inFence = !inFence;
      bodyLines.push(line);
      continue;
    }
    if (inFence || (!isComment(line) && line.trim())) {
      bodyLines.push(line);
    }
  }

  return bodyLines.join(' ').replace(/\s+/g, ' ').trim();
}

function hasNontrivialBody(raw) {
  return bodyText(raw).length >= minimumBodyCharacters;
}

if (!conventionalSubject?.groups) {
  fail('subject must follow Conventional Commits.');
}

const { type, scope, description } = conventionalSubject.groups;

if (!allowedTypes.has(type)) {
  fail(`type "${type}" is not allowed.`);
}

if (!description.trim()) {
  fail('description is required.');
}

if (scope && !allowedScopes.has(scope)) {
  fail(`scope "${scope}" is not allowed.`);
}

const formattedMessage = formatCommitMessage(message);
const touchesMultipleFiles = changedFileCount() > 1;

if (touchesMultipleFiles && !hasNontrivialBody(formattedMessage)) {
  fail(
    `commits touching multiple files need a body with at least ${minimumBodyCharacters} non-comment characters.`,
  );
}

if (formattedMessage !== message) {
  writeFileSync(commitMessagePath, formattedMessage);
}
