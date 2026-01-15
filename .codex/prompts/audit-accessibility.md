---
description: Accessibility audit for WCAG compliance, keyboard navigation, screen reader support, and inclusive design. Use before releases, when adding interactive components, or when ensuring compliance with accessibility standards.
argument-hint: [SCOPE=<session|full|perceivable|operable|understandable|robust>]
---

# Accessibility Audit

Identify accessibility issues across the application including WCAG compliance, keyboard navigation, screen reader support, color contrast, and semantic HTML usage.

## Usage

```
/prompts:audit-accessibility                 # Full WCAG 2.1 AA audit
/prompts:audit-accessibility SCOPE=operable  # Keyboard/focus only
/prompts:audit-accessibility SCOPE=robust    # Semantic HTML/ARIA only
```

Run the phases corresponding to `$SCOPE`. Default to full audit if not specified.

---

## Phase 0: Scope Detection

### Determine Changed Files

Before auditing, identify the scope of changes:

```bash
# Get list of changed files (staged + unstaged + untracked)
CHANGED_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.tsx$')
echo "Changed files: $(echo "$CHANGED_FILES" | wc -l | tr -d ' ')"
echo "$CHANGED_FILES"
```

### Determine Audit Scope

```
What kind of audit is needed?
├── SESSION AUDIT (default) → Only changed files in current session
│   Use when: After implementing a feature, fixing a bug
│   Scope: Files from git status (uncommitted changes only)
│
├── FULL AUDIT → All phases, WCAG 2.1 AA compliance
│   Use when: Pre-release, compliance requirements, redesign
│   ⚠️  Requires explicit SCOPE=full
│
├── TARGETED AUDIT → Specific area only
│   ├── perceivable → Phase 1 (content accessibility)
│   ├── operable → Phase 2 (keyboard & navigation)
│   ├── understandable → Phase 3 (forms & errors)
│   ├── robust → Phase 4 (semantic HTML & ARIA)
│   └── interactive → Phase 5 (components)
│
└── COMPONENT AUDIT → Single component focus
    Use when: New component development, PR review
```

### Session vs Full Scope Commands

When `SCOPE=session` (default), scope all automated checks to changed files:

```bash
# Store changed files for reuse throughout audit
CHANGED_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.tsx$')

# Exit early if no relevant changes
if [ -z "$CHANGED_FILES" ]; then
  echo "No uncommitted React component changes to audit."
  exit 0
fi
```

### WCAG Conformance Levels

| Level | Description                    | Required For     |
| ----- | ------------------------------ | ---------------- |
| A     | Minimum accessibility          | All websites     |
| AA    | Addresses major barriers       | Legal compliance |
| AAA   | Highest level of accessibility | Specialized apps |

**Target**: WCAG 2.1 Level AA (standard for most applications)

### Establish Baseline

**Session scope (default):**

```bash
CHANGED_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.tsx$')

# Count ARIA attributes in changed files
[ -n "$CHANGED_FILES" ] && echo "$CHANGED_FILES" | xargs grep -E "aria-|role=" 2>/dev/null | wc -l

# Find images in changed files
[ -n "$CHANGED_FILES" ] && echo "$CHANGED_FILES" | xargs grep -E "<img|Image" 2>/dev/null | wc -l
```

**Full scope (explicit SCOPE=full):**

```bash
# Count ARIA attributes in use
grep -rE "aria-|role=" --include="*.tsx" | wc -l

# Find images
grep -rE "<img|Image" --include="*.tsx" | wc -l

# Find interactive elements
grep -rE "onClick|onKeyDown|button|Button|<a " --include="*.tsx" | wc -l

# Find form elements
grep -rE "<input|<select|<textarea|<form" --include="*.tsx" | wc -l
```

---

## Phase 1: Perceivable

### 1.1 Text Alternatives (WCAG 1.1)

**Automated Check:**

```bash
# Find images without alt text
grep -rE "<img" --include="*.tsx" | grep -v "alt=" | head -10

# Find Image components without alt
grep -rE "Image\s" --include="*.tsx" | grep -v "alt=" | head -10

# Find decorative images (should have alt="")
grep -rE "alt=\"\"" --include="*.tsx" | wc -l

# Find icon buttons without labels
grep -rE "onClick.*Icon|Icon.*onClick" --include="*.tsx" | grep -v "aria-label\|title\|sr-only" | head -10
```

**Decision Tree - Image Alt Text:**

```
What type of image is this?
├── Informative (conveys content) →
│   ├── Simple image → Alt describes content
│   ├── Complex (chart/graph) → Alt + long description
│   └── Image of text → Alt = exact text shown
│
├── Decorative (purely visual) →
│   └── alt="" (empty, not missing)
│
├── Functional (link/button) →
│   └── Alt describes action, not image
│
└── Missing alt → CRITICAL: Must fix
```

**Severity:**

| Issue                     | Severity | WCAG    |
| ------------------------- | -------- | ------- |
| Missing alt on images     | CRITICAL | 1.1.1 A |
| Icon button without label | HIGH     | 1.1.1 A |
| Poor alt text quality     | MEDIUM   | 1.1.1 A |
| Complex image no desc     | MEDIUM   | 1.1.1 A |

### 1.2 Color & Contrast (WCAG 1.4)

**Automated Check:**

```bash
# Find color-only indicators
grep -rE "color:|background:" --include="*.tsx" --include="*.css" | head -20

# Find potentially problematic color combinations
grep -rE "text-gray-[3-4]00|text-slate-[3-4]00" --include="*.tsx"
```

**Contrast Requirements:**

| Content Type       | Minimum Ratio | WCAG Level |
| ------------------ | ------------- | ---------- |
| Normal text        | 4.5:1         | AA         |
| Large text (18pt+) | 3:1           | AA         |
| UI components      | 3:1           | AA         |
| Enhanced (AAA)     | 7:1           | AAA        |

**Checklist:**

- [ ] Text meets 4.5:1 contrast ratio
- [ ] Large text meets 3:1 contrast ratio
- [ ] UI controls meet 3:1 contrast ratio
- [ ] Focus indicators meet 3:1 contrast
- [ ] Color not sole means of conveying info
- [ ] Links distinguishable from text (not just color)

### 1.3 Sensory Characteristics (WCAG 1.3)

**Checklist:**

- [ ] Instructions don't rely solely on shape/color/location
- [ ] "Click the red button" → "Click Submit"
- [ ] Visual indicators have text alternatives
- [ ] Audio content has captions/transcripts
- [ ] Video has captions and audio descriptions

---

## Phase 2: Operable

### 2.1 Keyboard Accessibility (WCAG 2.1)

**Automated Check:**

```bash
# Find onClick without keyboard handler
grep -rE "onClick=" --include="*.tsx" | grep -v "onKeyDown\|onKeyUp\|onKeyPress\|button\|Button\|<a " | head -20

# Find tabIndex issues
grep -rE "tabIndex=.[1-9]|tabIndex=\"-1\"" --include="*.tsx" | head -10

# Find mouse-only events
grep -rE "onMouseEnter|onMouseLeave|onMouseOver" --include="*.tsx" | grep -v "onFocus\|onBlur" | head -10
```

**Decision Tree - Keyboard Accessibility:**

```
Is this element interactive?
├── YES → Is it a native interactive element?
│   ├── <button>, <a href>, <input> → Keyboard works by default
│   └── <div>, <span> with onClick →
│       ├── Has role="button"? → Check tabIndex and keyDown
│       └── No role → HIGH: Missing semantics
│
└── NO → Should not be focusable
    └── tabIndex > 0 → MEDIUM: Remove positive tabIndex
```

**Required for Custom Interactive Elements:**

| Requirement     | Implementation              | Severity if Missing |
| --------------- | --------------------------- | ------------------- |
| Focusable       | `tabIndex={0}`              | CRITICAL            |
| Role            | `role="button"` or similar  | HIGH                |
| Keyboard        | `onKeyDown` for Enter/Space | CRITICAL            |
| Visual feedback | Focus styles visible        | HIGH                |

**Patterns:**

```tsx
// BAD - Not keyboard accessible
<div onClick={handleClick}>Click me</div>

// GOOD - Keyboard accessible
<button onClick={handleClick}>Click me</button>

// GOOD - Custom element with full accessibility
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }}
>
  Click me
</div>
```

### 2.2 Focus Management (WCAG 2.4)

**Automated Check:**

```bash
# Find focus management
grep -rE "\.focus\(\)|useFocus|FocusTrap|focusRef" --include="*.tsx" | head -20

# Find skip links
grep -rE "skip.*main|skip.*content|sr-only.*skip" --include="*.tsx"

# Find focus-visible styles
grep -rE "focus-visible|:focus|outline" --include="*.css" --include="*.tsx" | head -20
```

**Checklist:**

- [ ] Skip link to main content exists
- [ ] Focus order follows visual order
- [ ] Focus visible on all interactive elements
- [ ] Focus trapped in modals/dialogs
- [ ] Focus returned when modal closes
- [ ] No keyboard traps (can tab away)

### 2.3 Navigation (WCAG 2.4)

**Automated Check:**

```bash
# Find heading structure
grep -rE "<h[1-6]|Heading" --include="*.tsx" | head -20

# Check for proper landmarks
grep -rE "role=\"main\"|role=\"navigation\"|role=\"banner\"|<main|<nav|<header|<footer" --include="*.tsx" | head -10
```

**Heading Hierarchy:**

```
Is heading structure logical?
├── Single h1 per page → PASS
├── Skipped levels (h1 → h3) → MEDIUM: Fix hierarchy
├── Multiple h1s → MEDIUM: Reduce to one
└── No headings → HIGH: Add proper structure
```

**Landmark Requirements:**

| Landmark    | Element/Role              | Required |
| ----------- | ------------------------- | -------- |
| Banner      | `<header>` or banner      | One      |
| Main        | `<main>` or main          | One      |
| Navigation  | `<nav>` or navigation     | One+     |
| Contentinfo | `<footer>` or contentinfo | One      |

---

## Phase 3: Understandable

### 3.1 Form Labels & Instructions (WCAG 3.3)

**Automated Check:**

```bash
# Find inputs without labels
grep -rE "<input|<select|<textarea" --include="*.tsx" | grep -v "aria-label\|aria-labelledby\|id=.*label" | head -20

# Find required fields without indication
grep -rE "required" --include="*.tsx" | head -10

# Find placeholder as only label (anti-pattern)
grep -rE "placeholder=" --include="*.tsx" | grep -v "aria-label\|label" | head -10
```

**Decision Tree - Form Field Labels:**

```
Does this form field have a label?
├── Visible <label> with htmlFor → PASS
├── aria-label → OK (but visible preferred)
├── aria-labelledby → PASS
├── Placeholder only → HIGH: Add proper label
└── No label → CRITICAL: Must fix
```

**Checklist:**

- [ ] All form fields have visible labels
- [ ] Labels associated with inputs (htmlFor/id)
- [ ] Required fields clearly indicated
- [ ] Instructions provided before form
- [ ] Input purpose identifiable (autocomplete)

**Patterns:**

```tsx
// BAD - Placeholder as label
<input placeholder="Email" />

// BAD - Label not associated
<label>Email</label>
<input type="email" />

// GOOD - Proper association
<label htmlFor="email">Email</label>
<input id="email" type="email" />

// GOOD - With required indication
<label htmlFor="email">
  Email <span aria-hidden="true">*</span>
  <span className="sr-only">(required)</span>
</label>
<input id="email" type="email" required aria-required="true" />
```

### 3.2 Error Handling (WCAG 3.3)

**Automated Check:**

```bash
# Find error message patterns
grep -rE "error|Error|invalid|Invalid" --include="*.tsx" | head -20

# Find form validation
grep -rE "setError|formState\.errors|validation" --include="*.tsx" | head -10
```

**Checklist:**

- [ ] Error messages describe the problem
- [ ] Error messages suggest how to fix
- [ ] Errors associated with fields (aria-describedby)
- [ ] Focus moves to first error on submit
- [ ] Errors don't rely on color alone
- [ ] Real-time validation announced to screen readers

**Patterns:**

```tsx
// BAD - Vague error, color only
<input className={error ? 'border-red-500' : ''} />;
{
  error && <span className="text-red-500">Error</span>;
}

// GOOD - Descriptive, associated, accessible
<input
  id="email"
  aria-invalid={!!error}
  aria-describedby={error ? 'email-error' : undefined}
  className={error ? 'border-red-500' : ''}
/>;
{
  error && (
    <span id="email-error" role="alert" className="text-red-500">
      Please enter a valid email address (e.g., name@example.com)
    </span>
  );
}
```

### 3.3 Language (WCAG 3.1)

**Checklist:**

- [ ] `lang` attribute on `<html>` element
- [ ] Language changes marked with `lang` attribute
- [ ] Abbreviations explained on first use
- [ ] Reading level appropriate for audience

---

## Phase 4: Robust

### 4.1 Semantic HTML (WCAG 4.1)

**Automated Check:**

```bash
# Find div/span used for interactive elements
grep -rE "<div.*onClick|<span.*onClick" --include="*.tsx" | head -20

# Find proper semantic elements
grep -rE "<button|<a href|<nav|<main|<article|<section" --include="*.tsx" | wc -l

# Find improper heading usage
grep -rE "className=.*heading|className=.*title" --include="*.tsx" | grep -v "<h[1-6]" | head -10
```

**Decision Tree - Semantic Element Choice:**

```
What is the purpose of this element?
├── Triggers action → <button>
├── Navigates to URL → <a href="">
├── Submits form → <button type="submit">
├── Contains form → <form>
├── Main content → <main>
├── Navigation → <nav>
├── Article/post → <article>
├── Generic section → <section> (with heading)
└── Truly no semantics → <div> or <span>
```

**Semantic Replacements:**

| Instead of             | Use                      |
| ---------------------- | ------------------------ |
| `<div onClick>`        | `<button>`               |
| `<span onClick>`       | `<button>` or `<a>`      |
| `<div class="header">` | `<header>`               |
| `<div class="nav">`    | `<nav>`                  |
| `<div class="footer">` | `<footer>`               |
| `<div class="btn">`    | `<button>`               |
| `<a onClick>`          | `<button>` or `<a href>` |

### 4.2 ARIA Usage (WCAG 4.1.2)

**Automated Check:**

```bash
# Find ARIA attributes
grep -rE "aria-|role=" --include="*.tsx" | wc -l

# Find potentially incorrect ARIA
grep -rE "role=\"button\"" --include="*.tsx" | grep "<button" | head -5  # Redundant
grep -rE "aria-label=.*\{\}" --include="*.tsx" | head -5  # Empty label
```

**ARIA Rules:**

1. **First Rule**: Don't use ARIA if native HTML works
2. **Second Rule**: Don't change native semantics unless necessary
3. **Third Rule**: Interactive ARIA elements must be keyboard accessible
4. **Fourth Rule**: Don't use role="presentation" on focusable elements
5. **Fifth Rule**: All interactive elements must have accessible names

**Common ARIA Mistakes:**

```tsx
// BAD - Redundant ARIA
<button role="button">Click</button>  // button already has this role

// BAD - Breaking semantics
<h1 role="button">Title</h1>  // Don't override heading

// BAD - Missing keyboard support
<div role="button" onClick={click}>Click</div>  // No keyboard!

// GOOD - ARIA where needed
<div
  role="tablist"
  aria-label="Product categories"
>
  <button role="tab" aria-selected={selected === 0}>Tab 1</button>
</div>
```

### 4.3 Valid HTML (WCAG 4.1.1)

**Checklist:**

- [ ] No duplicate IDs on page
- [ ] All IDs are unique
- [ ] Tags properly nested
- [ ] Required attributes present
- [ ] ARIA references valid IDs

**Automated Check:**

```bash
# Find potential duplicate IDs
grep -rohE "id=\"[^\"]+\"" --include="*.tsx" | sort | uniq -c | sort -rn | head -10

# Find aria-labelledby/describedby references
grep -rE "aria-labelledby|aria-describedby" --include="*.tsx" | head -10
```

---

## Phase 5: Interactive Components

### 5.1 Modals & Dialogs

**Checklist:**

- [ ] Focus trapped inside modal when open
- [ ] Focus moves to modal on open
- [ ] Focus returns to trigger on close
- [ ] Escape key closes modal
- [ ] Background content inert (aria-hidden or inert)
- [ ] Modal has accessible name (aria-label/labelledby)
- [ ] role="dialog" or role="alertdialog" set

**Pattern:**

```tsx
// GOOD - Accessible modal
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
  aria-describedby="modal-description"
>
  <h2 id="modal-title">Confirm Action</h2>
  <p id="modal-description">Are you sure you want to proceed?</p>
  <button onClick={onConfirm}>Confirm</button>
  <button onClick={onClose}>Cancel</button>
</div>
```

### 5.2 Menus & Dropdowns

**Checklist:**

- [ ] Trigger has aria-expanded
- [ ] Trigger has aria-haspopup
- [ ] Arrow keys navigate menu items
- [ ] Escape closes menu
- [ ] Focus managed properly
- [ ] Menu items have role="menuitem"

### 5.3 Tabs

**Checklist:**

- [ ] Tablist has role="tablist"
- [ ] Tabs have role="tab"
- [ ] Panels have role="tabpanel"
- [ ] aria-selected on active tab
- [ ] aria-controls links tab to panel
- [ ] Arrow keys switch tabs
- [ ] Tab key moves to panel content

### 5.4 Form Validation

**Checklist:**

- [ ] Errors announced via aria-live or role="alert"
- [ ] Invalid fields have aria-invalid="true"
- [ ] Error descriptions linked via aria-describedby
- [ ] Success messages also announced
- [ ] Loading states communicated

### 5.5 Loading States

**Checklist:**

- [ ] Loading announced to screen readers
- [ ] aria-busy="true" on loading regions
- [ ] Skeleton loaders have aria-label
- [ ] Progress indicators accessible
- [ ] Completion announced

**Pattern:**

```tsx
// GOOD - Accessible loading state
<div aria-busy={isLoading} aria-live="polite">
  {isLoading ? (
    <div role="status" aria-label="Loading content">
      <Spinner aria-hidden="true" />
      <span className="sr-only">Loading...</span>
    </div>
  ) : (
    <Content />
  )}
</div>
```

---

## Phase 6: Audit Report

### Severity Classification

| Severity     | Criteria                                                   |
| ------------ | ---------------------------------------------------------- |
| **CRITICAL** | Complete blocker for AT users, no keyboard access, missing |
| **HIGH**     | Missing labels, no focus indicator, keyboard trap          |
| **MEDIUM**   | Poor contrast, missing skip link, incorrect ARIA           |
| **LOW**      | Suboptimal heading order, verbose alt text, minor ARIA     |

### WCAG Success Criteria Reference

| Principle      | Guidelines              | Key Criteria     |
| -------------- | ----------------------- | ---------------- |
| Perceivable    | 1.1 Text Alternatives   | 1.1.1 Non-text   |
|                | 1.4 Distinguishable     | 1.4.3 Contrast   |
| Operable       | 2.1 Keyboard Accessible | 2.1.1 Keyboard   |
|                | 2.4 Navigable           | 2.4.1 Skip Link  |
| Understandable | 3.3 Input Assistance    | 3.3.1 Error ID   |
| Robust         | 4.1 Compatible          | 4.1.2 Name, Role |

### Report Template

````markdown
# Accessibility Audit Report

**Date**: [DATE]
**Scope**: [FULL / TARGETED: areas]
**WCAG Level**: [A / AA / AAA]

## Executive Summary

| WCAG Principle | Issues | Status   |
| -------------- | ------ | -------- |
| Perceivable    | X      | 🟢/🟡/🔴 |
| Operable       | X      | 🟢/🟡/🔴 |
| Understandable | X      | 🟢/🟡/🔴 |
| Robust         | X      | 🟢/🟡/🔴 |

**Compliance Level**: [Conforming / Partial / Non-conforming]

## Findings by Severity

| Severity | Count |
| -------- | ----- |
| Critical | X     |
| High     | X     |
| Medium   | X     |
| Low      | X     |

## Findings

### [A11Y-001] [Finding Title]

**Severity**: CRITICAL / HIGH / MEDIUM / LOW
**WCAG**: [X.X.X - Criterion Name]
**Location**: `path/to/component.tsx:line`

**Issue**:

```tsx
// Current problematic code
```
````

**Impact**: [How this affects users with disabilities]

**Remediation**:

```tsx
// Fixed accessible code
```

**Testing**: [How to verify the fix]

---

[Repeat for each finding]

## Testing Methodology

### Automated Testing

- [ ] axe-core / Lighthouse accessibility audit
- [ ] ESLint jsx-a11y plugin
- [ ] Color contrast analyzer

### Manual Testing

- [ ] Keyboard-only navigation
- [ ] Screen reader testing (VoiceOver/NVDA)
- [ ] Browser zoom to 200%
- [ ] High contrast mode

## Recommendations Summary

### Immediate (Critical/High)

1. [Action item]

### Short-term (Medium)

1. [Action item]

### Long-term (Low)

1. [Action item]

````

---

## Quick Reference

### Critical Checks

```bash
# === PERCEIVABLE ===
# Images without alt
grep -rE "<img|Image" --include="*.tsx" | grep -v "alt="

# Icon buttons without labels
grep -rE "Icon.*onClick|onClick.*Icon" --include="*.tsx" | grep -v "aria-label"

# === OPERABLE ===
# Click without keyboard
grep -rE "onClick=" --include="*.tsx" | grep -v "onKeyDown\|button\|Button\|<a "

# Mouse-only events
grep -rE "onMouseEnter" --include="*.tsx" | grep -v "onFocus"

# === UNDERSTANDABLE ===
# Inputs without labels
grep -rE "<input|<select" --include="*.tsx" | grep -v "aria-label\|htmlFor"

# === ROBUST ===
# Divs as buttons
grep -rE "<div.*onClick" --include="*.tsx" | head -10
````

### Checklist Summary

**Perceivable:**

- [ ] All images have alt text
- [ ] Color contrast 4.5:1 minimum
- [ ] Color not sole indicator
- [ ] Icon buttons have labels

**Operable:**

- [ ] All functionality keyboard accessible
- [ ] Focus visible on all elements
- [ ] No keyboard traps
- [ ] Skip link present

**Understandable:**

- [ ] Form fields have visible labels
- [ ] Error messages descriptive
- [ ] Instructions before forms
- [ ] Language declared

**Robust:**

- [ ] Semantic HTML used
- [ ] ARIA used correctly
- [ ] No duplicate IDs
- [ ] Valid HTML structure

**Interactive Components:**

- [ ] Modals trap focus
- [ ] Menus keyboard navigable
- [ ] Loading states announced
- [ ] Errors announced
