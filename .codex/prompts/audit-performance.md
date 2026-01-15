---
description: Performance audit for identifying bottlenecks in React rendering, data fetching, database queries, and API responses. Use when investigating slowness, before releases, or when optimizing user experience.
argument-hint: [SCOPE=<full|frontend|backend>]
---

# Performance Audit

Identify performance bottlenecks across the full stack: React rendering, data fetching, bundle size, database queries, API responses, and caching strategies.

## Usage

```
/prompts:audit-performance                  # Full audit
/prompts:audit-performance SCOPE=frontend   # Frontend only
/prompts:audit-performance SCOPE=backend    # Backend only
```

Run the phases corresponding to `$SCOPE`. Default to full audit if not specified.

---

## Phase 0: Scope & Baseline

### Determine Audit Scope

```
What kind of audit is needed?
├── FULL AUDIT → All phases, frontend + backend
│   Use when: Major performance issues, pre-release
│
├── FRONTEND ONLY → Phases 1-4
│   ├── rendering → React component performance
│   ├── fetching → Data loading patterns
│   ├── bundle → JS size, code splitting
│   └── vitals → Core Web Vitals
│
├── BACKEND ONLY → Phases 5-8
│   ├── database → Queries, indexes
│   ├── api → Response times, payloads
│   ├── caching → Cache strategies
│   └── async → Concurrency patterns
│
└── TARGETED → Specific component or endpoint
```

### Establish Baselines

```bash
# Build time
time npm run build  # or pnpm/yarn

# Bundle size (Next.js)
du -sh .next/static/chunks/ 2>/dev/null || du -sh dist/

# Client component count (React)
grep -r "'use client'" --include="*.tsx" | wc -l

# API route count
find . -path "*/routes/*" -name "*.ts" | wc -l
```

---

## Phase 1: React Rendering Performance

### 1.1 Component Architecture

**Automated Check - Client vs Server Components:**

```bash
# Count client components (Next.js App Router)
grep -r "'use client'" --include="*.tsx" | wc -l

# Find large client components that could be Server Components
for f in $(grep -rl "'use client'" --include="*.tsx"); do
  lines=$(wc -l < "$f")
  if [ "$lines" -gt 100 ]; then echo "$f: $lines lines"; fi
done

# Find client components without hooks (candidates for Server)
for f in $(grep -rl "'use client'" --include="*.tsx"); do
  if ! grep -qE "useState|useEffect|useCallback|useMemo|useRef|useContext|onClick|onChange" "$f"; then
    echo "No hooks/handlers: $f"
  fi
done
```

**Decision Tree - Server vs Client Component:**

```
Does this component need browser APIs or interactivity?
├── NO → Can it be async (fetch data)?
│   ├── YES → Use Server Component (async function)
│   └── NO → Still prefer Server Component
│
└── YES → What does it need?
    ├── Event handlers (onClick, etc.) → Client Component
    ├── useState/useEffect → Client Component
    ├── useContext → Consider extracting provider
    └── Only window/document → Consider dynamic import with ssr: false
```

### 1.2 Memoization Audit

**Automated Check:**

```bash
# Find components without memoization
grep -rL "useMemo\|useCallback\|memo(" --include="*.tsx" | head -20

# Find expensive operations in render path
grep -rE "\.map\(|\.filter\(|\.reduce\(|\.sort\(" --include="*.tsx" | grep -v "useMemo" | head -20

# Find inline arrow functions in JSX (re-created each render)
grep -rE "on[A-Z][a-zA-Z]*=\{[^}]*=>" --include="*.tsx" | head -10
```

**Decision Tree - Need Memoization?**

```
Is this value/function passed to children?
├── YES → Is the child memoized (React.memo)?
│   ├── YES → Is the value stable across renders?
│   │   ├── NO → Add useMemo/useCallback
│   │   └── YES → PASS
│   └── NO → Consider memo + memoization if expensive
│
└── NO → Is it an expensive computation?
    ├── YES (O(n²), large data, complex) → useMemo
    └── NO → Don't over-optimize
```

**Patterns:**

```typescript
// GOOD - Memoized expensive computation
const sorted = useMemo(
  () => items.sort((a, b) => a.date - b.date),
  [items]
);

// GOOD - Stable callback
const handleClick = useCallback((id: string) => {
  setSelected(id);
}, []);

// BAD - Inline in JSX, recreated every render
<Button onClick={(id) => setSelected(id)} />

// BAD - Expensive in render path
return items.sort(...).map(...); // Sorts every render
```

### 1.3 Context Performance

**Automated Check:**

```bash
# Find context providers
grep -r "createContext\|Provider value=" --include="*.tsx" | head -20

# Find deeply nested providers
grep -c "Provider" --include="*.tsx" | sort -t: -k2 -rn | head -10
```

**Checklist:**

- [ ] Context values are memoized
- [ ] Large contexts split into smaller ones
- [ ] Frequently changing values in separate contexts
- [ ] Consider Zustand/Jotai for complex state

### 1.4 List Virtualization

**Automated Check:**

```bash
# Find lists without virtualization
grep -rE "\.map\(" --include="*.tsx" | grep -v "react-window\|react-virtual\|virtualized\|tanstack" | head -20
```

**Decision Tree - Need Virtualization?**

```
How many items can this list contain?
├── ≤20 → No virtualization needed
├── 20-100 → Consider if items are complex
├── 100-1000 → MEDIUM: Add virtualization
└── >1000 → HIGH: Must virtualize
```

---

## Phase 2: Data Fetching & Caching

### 2.1 Data Fetching Library Config

**Automated Check:**

```bash
# Find React Query/SWR config
grep -rE "QueryClient|SWRConfig|staleTime|revalidate" --include="*.ts" --include="*.tsx" | head -20
```

**Recommended Settings:**

| Setting                | Recommendation         | Risk if Wrong                 |
| ---------------------- | ---------------------- | ----------------------------- |
| `staleTime`            | 30s-5min for most data | Too low = over-fetching       |
| `gcTime/cacheTime`     | 5-30min                | Too low = cache thrashing     |
| `refetchOnWindowFocus` | `false` usually        | `true` = unexpected refetches |
| `retry`                | 1-3                    | Too high = slow failure UX    |

### 2.2 Query Patterns

**Automated Check:**

```bash
# Find potential waterfall (sequential) queries
grep -rE "enabled:.*\?\." --include="*.ts" --include="*.tsx" | head -10

# Find useEffect data fetching (should use library)
grep -rE "useEffect.*fetch\(|useEffect.*axios" --include="*.tsx" | head -10
```

**Decision Tree - Query Pattern:**

```
Are multiple queries made for related data?
├── YES → Can they be combined into one?
│   ├── YES → Combine to reduce round trips
│   └── NO → Are they running in parallel?
│       ├── YES (useQueries) → PASS
│       └── NO (one depends on other) →
│           ├── Necessary dependency → OK
│           └── Can parallelize → HIGH: Fix waterfall
│
└── NO → Is caching configured properly?
    └── Check staleTime matches data volatility
```

**Patterns:**

```typescript
// GOOD - Parallel queries
const [users, posts] = useQueries({
  queries: [
    { queryKey: ['users'], queryFn: fetchUsers },
    { queryKey: ['posts'], queryFn: fetchPosts },
  ],
});

// BAD - Waterfall (sequential)
const { data: user } = useQuery({ queryKey: ['user', id], queryFn: fetchUser });
const { data: posts } = useQuery({
  queryKey: ['posts', user?.id],
  enabled: !!user?.id, // Waits for user!
});

// GOOD - Prefetch anticipated data
queryClient.prefetchQuery(['user', nextId], () => fetchUser(nextId));
```

### 2.3 Request Deduplication

**Checklist:**

- [ ] Using React Query/SWR (auto-deduplicates)
- [ ] No raw fetch() in components
- [ ] Query keys include all dependencies
- [ ] Optimistic updates for mutations

---

## Phase 3: Bundle & Loading Performance

### 3.1 Bundle Size

**Automated Check:**

```bash
# Total bundle size
du -sh .next/static/chunks/ 2>/dev/null || du -sh dist/

# Largest files
find .next/static/chunks -name "*.js" -exec ls -lh {} \; 2>/dev/null | sort -k5 -h | tail -10

# Check for bundle analyzer
grep -r "bundle-analyzer\|@next/bundle-analyzer" package.json
```

**Thresholds:**

| Metric        | Good   | Warning   | Critical |
| ------------- | ------ | --------- | -------- |
| Total JS      | <200KB | 200-500KB | >500KB   |
| Largest chunk | <100KB | 100-200KB | >200KB   |
| Initial load  | <150KB | 150-300KB | >300KB   |

### 3.2 Code Splitting

**Automated Check:**

```bash
# Find dynamic imports
grep -rE "dynamic\(|React\.lazy|import\(" --include="*.tsx" | grep -v "from '" | head -20

# Find large components that should be split
wc -l $(find . -path "*/components/*" -name "*.tsx") 2>/dev/null | sort -n | tail -20
```

**Decision Tree - Code Split?**

```
Is this component on initial page load?
├── YES → Is it below the fold or modal/dialog?
│   ├── YES → Dynamic import with loading state
│   └── NO → Keep in main bundle
│
└── NO → How is it triggered?
    ├── User action (click) → Dynamic import
    ├── Route navigation → Framework handles
    └── Conditional render → Dynamic if large (>50KB)
```

**Patterns:**

```typescript
// GOOD - Dynamic import for modal
const Modal = dynamic(() => import('./Modal'), {
  loading: () => <Spinner />,
});

// GOOD - Heavy library lazy loaded
const Chart = dynamic(
  () => import('chart-library').then(m => m.Chart),
  { ssr: false }
);

// BAD - Everything in main bundle
import { HeavyEditor } from './HeavyEditor';
```

### 3.3 Image Optimization

**Automated Check:**

```bash
# Find unoptimized images
grep -r "<img src=" --include="*.tsx" --include="*.jsx" | head -10

# Find Next.js Image usage
grep -r "next/image\|Image from" --include="*.tsx" | wc -l
```

**Checklist:**

- [ ] Using framework's Image component (Next/Image, etc.)
- [ ] Images have width/height or fill
- [ ] Above-fold images use `priority`
- [ ] Appropriate formats (WebP, AVIF)
- [ ] Lazy loading for below-fold

---

## Phase 4: Core Web Vitals

### 4.1 Largest Contentful Paint (LCP)

**Target**: < 2.5s

**Checklist:**

- [ ] Hero images use `priority` or `fetchpriority="high"`
- [ ] Fonts preloaded or use `font-display: swap`
- [ ] Critical CSS inlined
- [ ] No render-blocking scripts in head
- [ ] Server response < 600ms (TTFB)

### 4.2 Interaction to Next Paint (INP)

**Target**: < 200ms

**Automated Check:**

```bash
# Find potentially slow handlers
grep -rE "onClick=\{.*\(" --include="*.tsx" | head -20

# Find sync operations in handlers
grep -rE "onClick.*\.sort\(|onClick.*\.filter\(" --include="*.tsx"
```

**Checklist:**

- [ ] Event handlers complete quickly (< 50ms)
- [ ] Heavy work uses `startTransition` or workers
- [ ] Long lists virtualized
- [ ] No forced layout in handlers

### 4.3 Cumulative Layout Shift (CLS)

**Target**: < 0.1

**Automated Check:**

```bash
# Images without dimensions
grep -rE "<img" --include="*.tsx" | grep -v "width\|height\|fill" | head -10
```

**Checklist:**

- [ ] All images have explicit dimensions
- [ ] Skeleton loaders match content size
- [ ] Fonts don't cause reflow
- [ ] Dynamic content has reserved space
- [ ] Ads/embeds have fixed dimensions

---

## Phase 5: Database Query Performance

### 5.1 N+1 Query Detection

**Automated Check:**

```bash
# Find queries in loops (N+1 pattern)
grep -rE "for.*await.*\.(find|query|select)|\.map\(.*await.*\.(find|query|select)" --include="*.ts" | head -20

# Find potential N+1 in services
grep -rE "for\s*\(|\.forEach\(|\.map\(" --include="*.ts" -A 3 | grep -E "await.*db|await.*prisma|await.*query" | head -10
```

**Decision Tree - N+1 Query?**

```
Is a database query inside a loop?
├── YES → CRITICAL: N+1 pattern
│   ├── Can use JOIN/include? → Eager load relations
│   ├── Can batch with IN clause? → Single query
│   └── Must be separate? → Promise.all for parallel
│
└── NO → Are related entities loaded separately?
    ├── YES → Could combine with relations
    └── NO → PASS
```

**Patterns:**

```typescript
// BAD - N+1 queries
const users = await db.users.findMany();
for (const user of users) {
  const posts = await db.posts.findMany({ where: { userId: user.id } }); // N queries!
}

// GOOD - Eager loading
const users = await db.users.findMany({
  include: { posts: true }, // Single query with JOIN
});

// GOOD - Batch query
const userIds = users.map((u) => u.id);
const posts = await db.posts.findMany({
  where: { userId: { in: userIds } }, // Single query
});
```

### 5.2 Index Analysis

**Automated Check:**

```bash
# Find columns used in WHERE clauses
grep -rE "where.*:" --include="*.ts" | head -30

# Find existing indexes in schema
grep -rE "index\(|@@index|createIndex" --include="*.ts" --include="*.prisma" | head -20
```

**Index Recommendations:**

| Column Pattern            | Index Priority         |
| ------------------------- | ---------------------- |
| Foreign keys              | HIGH (for JOINs)       |
| `userId`/`tenantId`       | HIGH (multi-tenant)    |
| `createdAt` (if sorted)   | MEDIUM                 |
| `status` (if filtered)    | MEDIUM (partial index) |
| Composite (common combos) | LOW-MEDIUM             |

### 5.3 Pagination

**Automated Check:**

```bash
# Find queries without limits
grep -rE "findMany|select\(" --include="*.ts" | grep -v "take\|limit\|first\|skip" | head -20
```

**Checklist:**

- [ ] All list endpoints have default limits
- [ ] Maximum limit enforced (e.g., 100)
- [ ] Cursor pagination for large datasets
- [ ] Total count optimized or cached

---

## Phase 6: API Response Performance

### 6.1 Response Payload Size

**Automated Check:**

```bash
# Find endpoints returning full objects
grep -rE "return.*findMany|res\.json.*find" --include="*.ts" | head -20
```

**Checklist:**

- [ ] Only necessary fields returned (select specific columns)
- [ ] Nested objects limited in depth
- [ ] Large arrays paginated
- [ ] Binary data streamed, not JSON-encoded

### 6.2 Compression

**Automated Check:**

```bash
# Check for compression middleware
grep -rE "compression|gzip|brotli" --include="*.ts" package.json | head -10
```

**Checklist:**

- [ ] Gzip/Brotli enabled for text responses
- [ ] Threshold appropriate (>1KB)
- [ ] Static assets pre-compressed
- [ ] CDN handles compression

---

## Phase 7: Caching Strategies

### 7.1 Server-Side Caching

**Automated Check:**

```bash
# Find caching usage
grep -rE "cache|Cache|redis|Redis|lru|LRU" --include="*.ts" | head -20
```

**Caching Opportunities:**

| Data Type           | Suggested TTL | Strategy             |
| ------------------- | ------------- | -------------------- |
| Reference data      | 1-24hr        | Global cache         |
| User settings       | 5-15min       | Per-user cache       |
| Computed aggregates | 1-5min        | Background refresh   |
| API responses       | Varies        | HTTP caching headers |

### 7.2 HTTP Caching

**Checklist:**

- [ ] Static assets have long Cache-Control
- [ ] API responses have appropriate caching headers
- [ ] ETags used for conditional requests
- [ ] CDN configured for static content

---

## Phase 8: Concurrency & Async

### 8.1 Parallel Execution

**Automated Check:**

```bash
# Find sequential awaits that could be parallel
grep -rE "await.*;\s*\n\s*.*await" --include="*.ts" | head -20

# Find Promise.all usage (good)
grep -r "Promise\.all\|Promise\.allSettled" --include="*.ts" | wc -l
```

**Decision Tree - Parallelize?**

```
Multiple await statements?
├── YES → Are they dependent?
│   ├── YES (B needs A) → Sequential OK
│   └── NO (independent) → HIGH: Use Promise.all
│
└── NO → Single await is fine
```

**Patterns:**

```typescript
// BAD - Sequential when parallel possible
const user = await getUser(id);
const settings = await getSettings(id); // Doesn't need user
const posts = await getPosts(id); // Doesn't need settings

// GOOD - Parallel
const [user, settings, posts] = await Promise.all([getUser(id), getSettings(id), getPosts(id)]);
```

### 8.2 Connection Pooling

**Checklist:**

- [ ] Database uses connection pooling
- [ ] Pool size appropriate for workload
- [ ] Connections released properly
- [ ] Idle timeout configured

---

## Phase 9: Audit Report

### Severity Classification

| Severity     | Criteria                                                |
| ------------ | ------------------------------------------------------- |
| **CRITICAL** | App unusable, memory leak, infinite loop, freeze        |
| **HIGH**     | >1s delays, N+1 queries, >500KB bundle, 100+ re-renders |
| **MEDIUM**   | 500ms+ response, missing pagination, no code splitting  |
| **LOW**      | Suboptimal caching, minor inefficiencies                |

### Performance Budgets

| Metric   | Budget | Status |
| -------- | ------ | ------ |
| LCP      | <2.5s  |        |
| INP      | <200ms |        |
| CLS      | <0.1   |        |
| Total JS | <300KB |        |
| API P95  | <500ms |        |

### Report Template

````markdown
# Performance Audit Report

**Date**: [DATE]
**Scope**: [FULL/FRONTEND/BACKEND]

## Summary

| Severity | Count |
| -------- | ----- |
| Critical | X     |
| High     | X     |
| Medium   | X     |
| Low      | X     |

## Metrics

| Metric | Target | Current | Status |
| ------ | ------ | ------- | ------ |
| LCP    | <2.5s  |         |        |
| Bundle | <300KB |         |        |

## Findings

### [PERF-001] [Title]

**Severity**: HIGH
**Location**: `path/to/file.ts:line`

**Current**:

```typescript
// Slow pattern
```
````

**Recommended**:

```typescript
// Optimized
```

**Impact**: [Expected improvement]

````

---

## Quick Reference

```bash
# === FRONTEND ===
# Client components
grep -r "'use client'" --include="*.tsx" | wc -l

# Missing memoization
grep -rL "useMemo\|useCallback" --include="*.tsx" | head -10

# Bundle size
du -sh .next/static/chunks/

# === BACKEND ===
# N+1 patterns
grep -rE "for.*await.*find" --include="*.ts"

# Missing pagination
grep -r "findMany" --include="*.ts" | grep -v "take\|limit"

# Sequential awaits
grep -rE "await.*;\s*\n.*await" --include="*.ts"
````

### Checklist Summary

**Frontend:**

- [ ] Client components minimized
- [ ] Expensive computations memoized
- [ ] Large lists virtualized
- [ ] Code splitting implemented
- [ ] Images optimized

**Data Fetching:**

- [ ] Appropriate staleTime
- [ ] No waterfall queries
- [ ] Optimistic updates

**Backend:**

- [ ] No N+1 queries
- [ ] Proper indexes
- [ ] Pagination implemented
- [ ] Parallel execution

**Core Web Vitals:**

- [ ] LCP < 2.5s
- [ ] INP < 200ms
- [ ] CLS < 0.1
