---
name: audit-code-quality
description: Code quality audit for detecting dead code, duplication, complexity issues, type safety violations, and test coverage gaps. Use before releases, during code reviews, or when addressing technical debt.
---

# /audit-code-quality - Comprehensive Code Quality Audit

Identify code quality issues including dead code, duplication, excessive complexity, type safety violations, test coverage gaps, and dependency health problems.

---

## Phase 0: Scope & Metrics

### Determine Audit Scope

```
What kind of audit is needed?
├── FULL AUDIT → All phases, comprehensive review
│   Use when: Technical debt sprint, major refactor, new team onboarding
│
├── TARGETED AUDIT → Specific area only
│   ├── dead-code → Phase 1 (unused code detection)
│   ├── duplication → Phase 2 (DRY violations)
│   ├── complexity → Phase 3 (cyclomatic, nesting, size)
│   ├── types → Phase 4 (type safety)
│   ├── tests → Phase 5 (coverage analysis)
│   └── deps → Phase 6 (dependency health)
│
└── QUICK SCAN → Automated checks only
    Use when: Pre-commit, CI/CD pipeline
```

### Establish Baselines

```bash
# Type check errors
npx tsc --noEmit 2>&1 | tail -5

# Lint warnings/errors
npm run lint 2>&1 | grep -E "warning|error" | wc -l

# Test coverage (if configured)
npm test -- --coverage 2>&1 | grep -E "All files|Statements|Branches"

# Total lines of code
find . -name "*.ts" -o -name "*.tsx" | xargs wc -l | tail -1

# Files over 300 lines
find . -name "*.ts" -o -name "*.tsx" | xargs wc -l | awk '$1 > 300 {print}' | wc -l
```

---

## Phase 1: Dead Code Detection

### 1.1 Unused Exports

**Automated Check:**

```bash
# Find all exports
grep -rE "^export (const|function|class|type|interface|enum)" --include="*.ts" --include="*.tsx" | wc -l

# Find potentially unused exports (compare against imports)
# List all exported identifiers
grep -oE "export (const|function|class|type|interface|enum) [A-Za-z0-9_]+" --include="*.ts" --include="*.tsx" -r | cut -d' ' -f3 | sort -u > /tmp/exports.txt

# Check which aren't imported anywhere
while read name; do
  count=$(grep -rE "import.*\{[^}]*\b${name}\b" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then echo "Possibly unused: $name"; fi
done < /tmp/exports.txt | head -20
```

**Decision Tree - Is This Export Used?**

```
Is the export referenced anywhere?
├── YES → PASS
│
└── NO → Is it an entry point?
    ├── Public API (index.ts exports) → Keep, document as public API
    ├── Route handler → Keep, registered with framework
    ├── Test helper → Keep if in test utils
    └── Otherwise → MEDIUM: Consider removing
```

### 1.2 Unused Dependencies

**Automated Check:**

```bash
# Check for unused dependencies (requires depcheck)
npx depcheck 2>/dev/null | head -30

# Manual check - find imports of each dependency
for dep in $(jq -r '.dependencies | keys[]' package.json 2>/dev/null); do
  count=$(grep -r "from ['\"]${dep}" --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then echo "Unused: $dep"; fi
done | head -10
```

**Checklist:**

- [ ] No unused dependencies in package.json
- [ ] Dev dependencies not in production dependencies
- [ ] No duplicate functionality (e.g., lodash AND underscore)
- [ ] Peer dependencies correctly specified

### 1.3 Dead Code Patterns

**Automated Check:**

```bash
# Find TODO/FIXME comments (might indicate incomplete removal)
grep -rE "TODO|FIXME|HACK|XXX" --include="*.ts" --include="*.tsx" | wc -l

# Find commented-out code blocks
grep -rE "^\s*//.*function|^\s*//.*const.*=|^\s*//.*return" --include="*.ts" --include="*.tsx" | head -10

# Find unreachable code patterns
grep -rE "return.*\n.*[^}]" --include="*.ts" | grep -v "if\|else\|try\|catch" | head -10
```

**Checklist:**

- [ ] No commented-out code blocks
- [ ] TODOs have associated tickets
- [ ] No unused local variables (TypeScript should catch)
- [ ] No unreachable code after returns

---

## Phase 2: Code Duplication

### 2.1 Duplicate Logic Detection

**Automated Check:**

```bash
# Find duplicate function signatures (potential copy-paste)
grep -rh "^export (async )?function [a-zA-Z]+" --include="*.ts" | sort | uniq -c | sort -rn | head -10

# Find similar import blocks (same dependencies = similar logic)
grep -rh "^import.*from" --include="*.ts" --include="*.tsx" | sort | uniq -c | sort -rn | head -20

# Find duplicate string literals
grep -rohE "['\"][A-Za-z ]{10,}['\"]" --include="*.ts" --include="*.tsx" | sort | uniq -c | sort -rn | head -10
```

**Decision Tree - Is Duplication Acceptable?**

```
Is similar code appearing in multiple places?
├── 2 occurrences → MONITOR: Consider extracting if logic changes
├── 3+ occurrences → HIGH: Extract to shared utility
│   ├── Same module → Extract to local helper
│   ├── Same app → Extract to shared lib
│   └── Multiple apps → Extract to package
│
└── <2 occurrences → PASS
```

### 2.2 Duplicate Constants & Configuration

**Automated Check:**

```bash
# Find duplicate magic numbers
grep -rohE "\b[0-9]{2,}\b" --include="*.ts" --include="*.tsx" | sort | uniq -c | sort -rn | head -10

# Find duplicate error messages
grep -rohE "Error:.*|error:.*" --include="*.ts" | sort | uniq -c | sort -rn | head -10
```

**Checklist:**

- [ ] Magic numbers extracted to constants
- [ ] Error messages centralized
- [ ] Configuration values not duplicated
- [ ] Regular expressions shared when identical

### 2.3 Structural Duplication

**Patterns to Watch:**

```typescript
// BAD - Copy-pasted with minor changes
async function getUser(id: string) {
  try {
    const user = await db.users.findUnique({ where: { id } });
    if (!user) throw new NotFoundError('User not found');
    return user;
  } catch (e) {
    logger.error('getUser failed', e);
    throw e;
  }
}

async function getProject(id: string) {
  try {
    const project = await db.projects.findUnique({ where: { id } });
    if (!project) throw new NotFoundError('Project not found');
    return project;
  } catch (e) {
    logger.error('getProject failed', e);
    throw e;
  }
}

// GOOD - Generic utility
async function findById<T>(
  table: { findUnique: (args: any) => Promise<T | null> },
  id: string,
  entityName: string,
): Promise<T> {
  const entity = await table.findUnique({ where: { id } });
  if (!entity) throw new NotFoundError(`${entityName} not found`);
  return entity;
}
```

---

## Phase 3: Complexity Analysis

### 3.1 File Size

**Automated Check:**

```bash
# Files over 300 lines (warning)
find . -name "*.ts" -o -name "*.tsx" | xargs wc -l | awk '$1 > 300 {print}' | sort -rn | head -20

# Files over 500 lines (critical)
find . -name "*.ts" -o -name "*.tsx" | xargs wc -l | awk '$1 > 500 {print}' | sort -rn | head -10
```

**Thresholds:**

| File Size  | Severity | Action                          |
| ---------- | -------- | ------------------------------- |
| ≤200 lines | OK       | No action                       |
| 200-300    | LOW      | Monitor, consider splitting     |
| 300-500    | MEDIUM   | Plan to split by responsibility |
| >500 lines | HIGH     | Split urgently                  |
| >1000      | CRITICAL | Immediate refactoring required  |

### 3.2 Function Complexity

**Automated Check:**

```bash
# Long functions (>50 lines)
grep -n "function\|=>\|async" --include="*.ts" --include="*.tsx" -A 60 | grep -E "^[0-9]+-function|^[0-9]+-.*=.*=>" | head -20

# High cyclomatic complexity (count decision points)
for f in $(find . -name "*.ts" -o -name "*.tsx"); do
  count=$(grep -cE "if|else|switch|case|for|while|\?\?|\?\.|&&|\|\|" "$f" 2>/dev/null)
  if [ "$count" -gt 50 ]; then echo "$f: $count decision points"; fi
done | sort -t: -k2 -rn | head -10

# Deeply nested code (multiple indentation levels)
grep -rE "^\s{16,}" --include="*.ts" --include="*.tsx" | head -10
```

**Decision Tree - Function Complexity:**

```
How many decision points (if/else/&&/||)?
├── ≤5 → LOW complexity, OK
├── 6-10 → MEDIUM, consider extracting helpers
├── 11-15 → HIGH, should refactor
└── >15 → CRITICAL, must refactor
    └── How to fix?
        ├── Extract helper functions
        ├── Use early returns
        ├── Replace conditionals with polymorphism
        └── Use lookup tables instead of switch
```

### 3.3 Nesting Depth

**Thresholds:**

| Nesting Level | Severity | Example                           |
| ------------- | -------- | --------------------------------- |
| ≤3            | OK       | Normal control flow               |
| 4             | MEDIUM   | Consider early returns            |
| 5+            | HIGH     | Extract nested logic to functions |

**Patterns:**

```typescript
// BAD - Deep nesting
function process(data) {
  if (data) {
    if (data.items) {
      for (const item of data.items) {
        if (item.active) {
          if (item.value > 0) {
            // 5 levels deep!
          }
        }
      }
    }
  }
}

// GOOD - Early returns, extracted logic
function process(data) {
  if (!data?.items) return;

  const activeItems = data.items.filter((item) => item.active && item.value > 0);

  for (const item of activeItems) {
    processItem(item);
  }
}
```

---

## Phase 4: Type Safety

### 4.1 `any` Type Usage

**Automated Check:**

```bash
# Find explicit any usage
grep -rE ": any\b|: any\[|: any\)" --include="*.ts" --include="*.tsx" | wc -l

# List files with most any usage
grep -rc ": any" --include="*.ts" --include="*.tsx" | grep -v ":0$" | sort -t: -k2 -rn | head -20

# Find as any casts
grep -rE "as any" --include="*.ts" --include="*.tsx" | wc -l
```

**Decision Tree - Is `any` Acceptable?**

```
Why is `any` being used?
├── Third-party library lacks types →
│   ├── Can you add @types/package? → HIGH: Add types
│   ├── Can you create local types? → MEDIUM: Add .d.ts
│   └── Truly untyped → Document with comment
│
├── Dynamic data shape →
│   ├── Known variants? → Use union types
│   ├── JSON parsing? → Use Zod/validation
│   └── Actually unknown? → Use `unknown` instead
│
├── Generics too complex →
│   └── Usually fixable → HIGH: Invest time in proper generics
│
└── "Quick fix" →
    └── CRITICAL: Never acceptable
```

**Severity by Count:**

| `any` Count | Severity | Action                    |
| ----------- | -------- | ------------------------- |
| 0           | OK       | Excellent                 |
| 1-10        | LOW      | Review each case          |
| 11-25       | MEDIUM   | Prioritized cleanup       |
| 26-50       | HIGH     | Significant type safety   |
| >50         | CRITICAL | Type safety fundamentally |

### 4.2 Type Suppression

**Automated Check:**

```bash
# Find ts-ignore and ts-expect-error
grep -rE "@ts-ignore|@ts-expect-error|@ts-nocheck" --include="*.ts" --include="*.tsx" | wc -l

# List all suppressions with context
grep -rE "@ts-ignore|@ts-expect-error" --include="*.ts" --include="*.tsx" -B1 | head -30
```

**Checklist:**

- [ ] No `@ts-ignore` without explanatory comment
- [ ] Prefer `@ts-expect-error` over `@ts-ignore`
- [ ] No `@ts-nocheck` in production code
- [ ] Type assertions (`as`) have justification

### 4.3 Strict Mode Compliance

**Automated Check:**

```bash
# Check tsconfig strictness
grep -E "strict|strictNullChecks|noImplicitAny|strictFunctionTypes" tsconfig.json | head -10

# Find potential null issues
grep -rE "!\.|\!\[|!\(" --include="*.ts" --include="*.tsx" | wc -l
```

**Required TypeScript Strict Settings:**

| Setting               | Required | Severity if Disabled |
| --------------------- | -------- | -------------------- |
| `strict`              | YES      | CRITICAL             |
| `strictNullChecks`    | YES      | CRITICAL             |
| `noImplicitAny`       | YES      | HIGH                 |
| `strictFunctionTypes` | YES      | MEDIUM               |
| `noUncheckedIndexed`  | Rec.     | LOW                  |

---

## Phase 5: Test Coverage

### 5.1 Coverage Metrics

**Automated Check:**

```bash
# Run coverage report
npm test -- --coverage 2>&1 | grep -E "All files|Statements|Branches|Functions|Lines"

# Find files with no test coverage
npm test -- --coverage --coverageReporters=text 2>&1 | grep "0.*|.*0.*|.*0.*|" | head -20
```

**Coverage Thresholds:**

| Metric     | Minimum | Target | Severity if Below |
| ---------- | ------- | ------ | ----------------- |
| Statements | 70%     | 85%    | HIGH if <70%      |
| Branches   | 60%     | 80%    | HIGH if <60%      |
| Functions  | 70%     | 85%    | HIGH if <70%      |
| Lines      | 70%     | 85%    | MEDIUM if <70%    |

### 5.2 Critical Path Coverage

**Decision Tree - What Must Be Tested?**

```
Is this code critical?
├── Authentication/Authorization → CRITICAL: 100% coverage required
├── Payment/Billing logic → CRITICAL: 100% coverage required
├── Data mutations → HIGH: >90% coverage
├── Business rules → HIGH: >85% coverage
├── Utilities/Helpers → MEDIUM: >70% coverage
└── UI components → MEDIUM: >60% coverage
```

**Automated Check:**

```bash
# Find untested critical files
for pattern in "auth" "payment" "billing" "security"; do
  find . -name "*${pattern}*.ts" | while read f; do
    test_file="${f%.ts}.test.ts"
    if [ ! -f "$test_file" ]; then echo "Missing test: $f"; fi
  done
done
```

### 5.3 Test Quality

**Automated Check:**

```bash
# Find test files with assertions
grep -rE "expect\(|assert\(" --include="*.test.ts" --include="*.spec.ts" | wc -l

# Find tests without assertions (test that does nothing)
for f in $(find . -name "*.test.ts" -o -name "*.spec.ts"); do
  if ! grep -qE "expect\(|assert\(" "$f"; then echo "No assertions: $f"; fi
done

# Find skipped tests
grep -rE "\.skip\(|it\.skip|describe\.skip|test\.skip" --include="*.test.ts" --include="*.spec.ts"
```

**Checklist:**

- [ ] Every test has at least one assertion
- [ ] No skipped tests in main branch
- [ ] Tests cover happy path AND edge cases
- [ ] Tests are isolated (no shared state)
- [ ] Mocks cleaned up after each test

### 5.4 Test Anti-Patterns

**Patterns to Avoid:**

```typescript
// BAD - No assertions
it('should do something', async () => {
  await doSomething(); // What are we verifying?
});

// BAD - Testing implementation, not behavior
it('should call the function', () => {
  const spy = jest.spyOn(service, 'helper');
  service.main();
  expect(spy).toHaveBeenCalled(); // So what?
});

// BAD - Overly broad assertion
it('should return data', () => {
  const result = getData();
  expect(result).toBeTruthy(); // Passes for any non-falsy value
});

// GOOD - Tests behavior
it('should return user by ID', async () => {
  const user = await getUser('123');
  expect(user.id).toBe('123');
  expect(user.email).toBe('test@example.com');
});
```

---

## Phase 6: Dependency Health

### 6.1 Outdated Dependencies

**Automated Check:**

```bash
# Check for outdated packages
npm outdated 2>/dev/null | head -20

# Check for major version updates (breaking changes)
npm outdated 2>/dev/null | awk 'NR>1 && $3 != $4 {print $1, $2, "->", $4}'
```

**Severity by Update Type:**

| Update Type    | Severity | Action              |
| -------------- | -------- | ------------------- |
| Patch (1.0.X)  | LOW      | Update in batch     |
| Minor (1.X.0)  | LOW      | Update with testing |
| Major (X.0.0)  | MEDIUM   | Plan migration      |
| Security fix   | HIGH     | Update immediately  |
| EOL/Deprecated | HIGH     | Plan replacement    |

### 6.2 Security Vulnerabilities

**Automated Check:**

```bash
# npm audit
npm audit 2>/dev/null | grep -E "Critical|High|Moderate|Low"

# Summary only
npm audit --json 2>/dev/null | jq '.metadata.vulnerabilities'
```

**Checklist:**

- [ ] No critical vulnerabilities
- [ ] No high vulnerabilities in production deps
- [ ] Audit run in CI/CD pipeline
- [ ] Security updates applied promptly

### 6.3 Dependency Bloat

**Automated Check:**

```bash
# Count dependencies
jq '.dependencies | keys | length' package.json

# Check bundle impact of largest deps
npm ls --all 2>/dev/null | head -50

# Find dependencies with overlapping functionality
grep -E "lodash|underscore|ramda" package.json
grep -E "moment|dayjs|date-fns|luxon" package.json
grep -E "axios|got|node-fetch|ky" package.json
```

**Checklist:**

- [ ] No duplicate functionality packages
- [ ] Heavy packages justified (moment.js = 300KB)
- [ ] Consider lighter alternatives
- [ ] No unused dependencies

---

## Phase 7: Audit Report

### Severity Classification

| Severity     | Criteria                                                      |
| ------------ | ------------------------------------------------------------- |
| **CRITICAL** | >50 `any` types, 0% test coverage on critical paths, security |
| **HIGH**     | >25 `any`, <50% coverage, files >500 lines, complexity >15    |
| **MEDIUM**   | 10-25 `any`, <70% coverage, significant duplication, outdated |
| **LOW**      | Minor type issues, small duplication, test anti-patterns      |

### Quality Scores

| Dimension   | Weight | Score Formula                 |
| ----------- | ------ | ----------------------------- |
| Type Safety | 25%    | 100 - (any_count \* 2)        |
| Test Cover  | 25%    | statement_coverage            |
| Complexity  | 20%    | 100 - (files_over_300 \* 5)   |
| Duplication | 15%    | 100 - (dup_count \* 3)        |
| Dep Health  | 15%    | 100 - (vulnerabilities \* 10) |

### Report Template

````markdown
# Code Quality Audit Report

**Date**: [DATE]
**Scope**: [FULL / TARGETED: areas]

## Executive Summary

| Dimension   | Score | Status   |
| ----------- | ----- | -------- |
| Type Safety | X/100 | 🟢/🟡/🔴 |
| Test Cover  | X%    | 🟢/🟡/🔴 |
| Complexity  | X/100 | 🟢/🟡/🔴 |
| Duplication | X/100 | 🟢/🟡/🔴 |
| Dep Health  | X/100 | 🟢/🟡/🔴 |

**Overall Quality Score**: X/100

## Metrics

| Metric                   | Value | Target | Status |
| ------------------------ | ----- | ------ | ------ |
| `any` type count         |       | 0      |        |
| Test coverage            |       | 80%    |        |
| Files >300 lines         |       | 0      |        |
| Skipped tests            |       | 0      |        |
| Security vulnerabilities |       | 0      |        |

## Findings

### [QUAL-001] [Finding Title]

**Severity**: CRITICAL / HIGH / MEDIUM / LOW
**Category**: Type Safety / Tests / Complexity / Duplication / Dependencies
**Location**: `path/to/file.ts:line`

**Current**:

```typescript
// Problematic code
```
````

**Recommended**:

```typescript
// Fixed code
```

**Impact**: [Why this matters]

---

[Repeat for each finding]

## Recommendations

### Immediate Actions (Critical/High)

1. [Action item]
2. [Action item]

### Short-term (Medium)

1. [Action item]

### Long-term (Low)

1. [Action item]

## Technical Debt Summary

| Category    | Items | Estimated Effort |
| ----------- | ----- | ---------------- |
| Type fixes  | X     | X hours          |
| Test gaps   | X     | X hours          |
| Refactoring | X     | X hours          |

````

---

## Quick Reference

### Critical Checks

```bash
# === TYPE SAFETY ===
# Count any types
grep -rE ": any|as any" --include="*.ts" --include="*.tsx" | wc -l

# Find type suppressions
grep -rE "@ts-ignore|@ts-expect-error" --include="*.ts" --include="*.tsx"

# === COMPLEXITY ===
# Large files
find . -name "*.ts" -o -name "*.tsx" | xargs wc -l | awk '$1 > 300'

# === TESTS ===
# Missing test files for services
find . -path "*/services/*" -name "*.ts" ! -name "*.test.ts" | head -10

# Skipped tests
grep -rE "\.skip\(" --include="*.test.ts"

# === DEPENDENCIES ===
# Security audit
npm audit

# Outdated
npm outdated
````

### Checklist Summary

**Type Safety:**

- [ ] No `any` without justification
- [ ] No `@ts-ignore` without explanation
- [ ] Strict mode enabled
- [ ] Type assertions minimized

**Testing:**

- [ ] Coverage >70% overall
- [ ] Critical paths >90% covered
- [ ] No skipped tests
- [ ] Tests have assertions

**Complexity:**

- [ ] No files >500 lines
- [ ] Functions <50 lines
- [ ] Nesting ≤3 levels
- [ ] Cyclomatic complexity ≤10

**Duplication:**

- [ ] No copy-pasted logic
- [ ] Constants centralized
- [ ] Shared utilities extracted

**Dependencies:**

- [ ] No security vulnerabilities
- [ ] No major version outdated >6 months
- [ ] No unused dependencies
