#!/usr/bin/env node

import { readFileSync } from 'node:fs';

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
