---
description: Test quality audit for ensuring tests provide maximum validity and utility. Covers unit tests, integration tests, and Playwright e2e tests with focus on meaningful assertions over superficial checks.
argument-hint: [SCOPE=<session|full|unit|integration|e2e|all>]
---

# Test Quality Audit

Ensure tests provide genuine validation of application behavior, not just superficial coverage. This skill focuses on test **validity** (are we testing the right things?) over mere **coverage** (are lines executed?).

## Usage

```
/prompts:audit-tests              # All test types
/prompts:audit-tests SCOPE=unit   # Unit tests only
/prompts:audit-tests SCOPE=e2e    # Playwright E2E tests only
```

Run the phases corresponding to `$SCOPE`. Default to all test types if not specified.

---

## Core Philosophy

**Coverage is a proxy metric. Validity is the goal.**

A test suite with 95% coverage that only checks "element exists" is worthless. A test suite with 60% coverage that verifies critical user flows and business logic is valuable.

### The Fundamental Question

Before writing ANY test, ask:

> "If this test passes, what confidence does it give me that the application works correctly?"

If the answer is "not much" or "it just proves the code runs," the test has low validity.

---

## Phase 0: Scope Detection

### Determine Changed Files

Before auditing, identify the scope of changes:

```bash
# Get list of changed test files (staged + unstaged + untracked)
CHANGED_TEST_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.(test|spec)\.(ts|tsx)$')
echo "Changed test files: $(echo "$CHANGED_TEST_FILES" | wc -l | tr -d ' ')"
echo "$CHANGED_TEST_FILES"

# Also find related source files that changed (may need new tests)
CHANGED_SRC_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.(ts|tsx)$' | grep -v -E '\.(test|spec)\.')
echo "Changed source files: $(echo "$CHANGED_SRC_FILES" | wc -l | tr -d ' ')"
```

### Determine Audit Scope

```
What kind of audit is needed?
├── SESSION AUDIT (default) → Only changed test files + source files needing tests
│   Use when: After implementing a feature, fixing a bug, adding tests
│   Scope: Files from git status (uncommitted changes only)
│
├── FULL AUDIT → All tests across codebase
│   Use when: Test quality sprint, major refactor, CI optimization
│   ⚠️  Requires explicit SCOPE=full
│
├── TARGETED AUDIT → Specific test type
│   ├── unit → Phase 1 (unit test validity)
│   ├── integration → Phase 2 (integration test validity)
│   └── e2e → Phase 3 (Playwright e2e validity)
│
└── ALL → All test types
```

### Session vs Full Scope Commands

When `SCOPE=session` (default), scope all automated checks to changed files:

```bash
# Store changed files for reuse throughout audit
CHANGED_TEST_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.(test|spec)\.(ts|tsx)$')
CHANGED_SRC_FILES=$(git status --porcelain | awk '{print $NF}' | grep -E '\.(ts|tsx)$' | grep -v -E '\.(test|spec)\.')

# Exit early if no relevant changes
if [ -z "$CHANGED_TEST_FILES" ] && [ -z "$CHANGED_SRC_FILES" ]; then
  echo "No uncommitted test or source changes to audit."
  exit 0
fi
```

---

## Test Validity Assessment

### Questions to Ask Before Writing Tests

**For Every Test:**

1. **What user behavior or business rule does this test verify?**
   - If you can't answer this, don't write the test yet

2. **What bug would this test catch?**
   - If no realistic bug scenario, the test may be pointless

3. **If this test fails, what's broken?**
   - If the answer is "I don't know" or "maybe nothing," the test is too vague

4. **Could this test pass while the feature is broken?**
   - If yes, the assertions are too weak

5. **Could this test fail while the feature works correctly?**
   - If yes, the test is too brittle

### The Test Validity Spectrum

```
LOW VALIDITY ◄─────────────────────────────────────────► HIGH VALIDITY

"element exists"     "text appears"     "data correct"     "user flow works"
"no errors"          "function called"  "state changes"    "business rule enforced"
"renders"            "props passed"     "API returns X"    "edge case handled"
```

### Validity Decision Tree

```
What does this test verify?
├── "The code runs without crashing" → LOW VALIDITY
│   └── Rewrite to verify actual behavior
│
├── "A function was called" → LOW-MEDIUM VALIDITY
│   └── Test the EFFECT of calling it, not the call itself
│
├── "An element appears on screen" → MEDIUM VALIDITY (only if element is the feature)
│   └── Usually need to also verify content/behavior
│
├── "Data is correctly transformed/stored" → HIGH VALIDITY
│   └── Good, but ensure realistic inputs
│
├── "User can complete task X" → HIGH VALIDITY
│   └── Excellent, this is what matters
│
└── "Business rule Y is enforced" → HIGH VALIDITY
    └── Excellent, verify both allowed and rejected cases
```

---

## Phase 1: Unit Test Validity

### 1.1 What Makes a Valid Unit Test

**A valid unit test:**

- Tests ONE specific behavior or rule
- Uses realistic inputs (not just `"test"` or `123`)
- Verifies outputs/effects, not implementation
- Fails only when the behavior is broken
- Passes only when the behavior works

**Automated Check:**

```bash
# Find tests with weak assertions
grep -rE "toBeTruthy|toBeFalsy|toBeDefined|not\.toBeNull" --include="*.test.ts" | wc -l

# Find tests that only check existence
grep -rE "toBeInTheDocument\(\)|\.toExist\(\)" --include="*.test.ts" | wc -l

# Find tests without assertions (empty tests)
grep -rE "it\(|test\(" --include="*.test.ts" -A 5 | grep -B 5 "^\s*}\s*\)\s*;?\s*$" | grep -v "expect" | head -20

# Find tests that only call functions without assertions
grep -rE "it\(.*\(\)\s*=>" --include="*.test.ts" -A 10 | grep -v "expect" | head -20
```

### 1.2 Unit Test Antipatterns (EXHAUSTIVE)

#### Antipattern 1: Testing That Code Runs

```typescript
// ❌ INVALID - Tests nothing meaningful
it('should work', () => {
  const result = processData(input);
  expect(result).toBeDefined();
});

// ❌ INVALID - "Truthy" tells you nothing
it('should return something', () => {
  const result = getUser(id);
  expect(result).toBeTruthy();
});

// ✅ VALID - Tests specific behavior
it('should calculate total with tax', () => {
  const result = calculateTotal({ subtotal: 100, taxRate: 0.08 });
  expect(result.total).toBe(108);
  expect(result.tax).toBe(8);
});
```

#### Antipattern 2: Testing Implementation, Not Behavior

```typescript
// ❌ INVALID - Tests HOW, not WHAT
it('should call the helper function', () => {
  const spy = jest.spyOn(utils, 'formatDate');
  displayEvent(event);
  expect(spy).toHaveBeenCalled();
});

// ❌ INVALID - Tests internal state
it('should set loading to true', () => {
  const { result } = renderHook(() => useData());
  act(() => result.current.fetch());
  expect(result.current.isLoading).toBe(true);
});
// So what? What does isLoading=true DO for the user?

// ✅ VALID - Tests observable behavior
it('should show loading indicator while fetching', async () => {
  render(<DataDisplay />);
  fireEvent.click(screen.getByRole('button', { name: /load/i }));
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  await waitFor(() => {
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

// ✅ VALID - Tests the RESULT, not the mechanism
it('should format dates in user locale', () => {
  const result = displayEvent({ ...event, date: '2024-03-15' });
  expect(result.displayDate).toBe('March 15, 2024'); // or locale-specific
});
```

#### Antipattern 3: Meaningless Mocks

```typescript
// ❌ INVALID - Mocking what you're testing
it('should return user', async () => {
  mockGetUser.mockResolvedValue({ id: '1', name: 'Test' });
  const user = await getUser('1');
  expect(user.name).toBe('Test');
});
// This tests that mockGetUser returns what you told it to return!

// ❌ INVALID - Over-mocking destroys validity
it('should process order', async () => {
  mockValidateOrder.mockReturnValue(true);
  mockCalculateTotal.mockReturnValue(100);
  mockChargePayment.mockResolvedValue({ success: true });
  mockSendEmail.mockResolvedValue(true);

  const result = await processOrder(order);
  expect(result.success).toBe(true);
});
// You've mocked away everything - what's left to test?

// ✅ VALID - Mock boundaries, test logic
it('should reject order when inventory insufficient', async () => {
  // Mock only the external dependency
  mockInventoryService.check.mockResolvedValue({ available: 5 });

  const order = { items: [{ productId: '1', quantity: 10 }] };
  await expect(processOrder(order)).rejects.toThrow('Insufficient inventory');
});
```

#### Antipattern 4: Testing Third-Party Code

```typescript
// ❌ INVALID - Testing React/library behavior
it('should update state when setState called', () => {
  const [value, setValue] = useState(0);
  setValue(1);
  expect(value).toBe(1);
});

// ❌ INVALID - Testing Zod behavior
it('should validate email format', () => {
  const schema = z.string().email();
  expect(() => schema.parse('invalid')).toThrow();
});
// Zod's tests already cover this!

// ✅ VALID - Test YOUR schema's specific rules
it('should require work email domain', () => {
  const result = userSchema.safeParse({ email: 'user@gmail.com' });
  expect(result.success).toBe(false);
  expect(result.error.issues[0].message).toContain('work email');
});
```

#### Antipattern 5: Snapshot Abuse

```typescript
// ❌ INVALID - Snapshot of entire component
it('should render correctly', () => {
  const { container } = render(<ComplexDashboard data={mockData} />);
  expect(container).toMatchSnapshot();
});
// Problems:
// 1. Any change breaks test (brittle)
// 2. Reviewers blindly update snapshots
// 3. Doesn't verify behavior, just structure

// ❌ INVALID - Snapshot of data structure
it('should transform data', () => {
  expect(transformData(input)).toMatchSnapshot();
});
// No one knows what the correct output should be

// ✅ ACCEPTABLE - Small, focused snapshots
it('should render error state correctly', () => {
  const { container } = render(<ErrorMessage error="Network failed" />);
  expect(container.querySelector('.error')).toMatchInlineSnapshot(`
    <div class="error">Network failed</div>
  `);
});

// ✅ BETTER - Explicit assertions
it('should display error message', () => {
  render(<ErrorMessage error="Network failed" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Network failed');
});
```

#### Antipattern 6: Testing Obvious/Trivial Code

```typescript
// ❌ INVALID - Testing a getter
it('should return name', () => {
  const user = new User({ name: 'Alice' });
  expect(user.name).toBe('Alice');
});

// ❌ INVALID - Testing simple math
it('should add numbers', () => {
  expect(add(2, 2)).toBe(4);
});

// ❌ INVALID - Testing type coercion
it('should convert string to number', () => {
  expect(Number('5')).toBe(5);
});

// ✅ VALID - Test when there's actual logic
it('should calculate compound interest correctly', () => {
  const result = calculateCompoundInterest({
    principal: 1000,
    rate: 0.05,
    years: 10,
    compoundingFrequency: 12,
  });
  expect(result.finalAmount).toBeCloseTo(1647.01, 2);
});
```

#### Antipattern 7: Catch-All Error Tests

```typescript
// ❌ INVALID - Tests that errors exist, not which error
it('should throw on invalid input', () => {
  expect(() => processData(null)).toThrow();
});
// What error? Is it the RIGHT error?

// ❌ INVALID - Testing error exists without context
it('should handle errors', async () => {
  mockApi.mockRejectedValue(new Error('fail'));
  const result = await fetchData();
  expect(result.error).toBeDefined();
});

// ✅ VALID - Specific error verification
it('should throw ValidationError for missing required fields', () => {
  expect(() => createUser({ email: 'a@b.com' })).toThrow(ValidationError);
  expect(() => createUser({ email: 'a@b.com' })).toThrow('name is required');
});

// ✅ VALID - Error handling behavior
it('should display user-friendly message on network error', async () => {
  mockApi.mockRejectedValue(new NetworkError());
  render(<DataLoader />);
  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Unable to connect. Please check your internet connection.'
    );
  });
});
```

#### Antipattern 8: Duplicating Production Code

```typescript
// ❌ INVALID - Test reimplements the logic
it('should calculate discount', () => {
  const price = 100;
  const discount = 0.2;
  const expected = price - price * discount; // Same logic as production!
  expect(calculateDiscount(price, discount)).toBe(expected);
});

// ✅ VALID - Test uses known values
it('should apply 20% discount', () => {
  expect(calculateDiscount(100, 0.2)).toBe(80);
});

it('should round to 2 decimal places', () => {
  expect(calculateDiscount(99.99, 0.15)).toBe(84.99);
});
```

#### Antipattern 9: Conditional Test Logic

```typescript
// ❌ INVALID - Conditionals in tests
it('should handle all cases', () => {
  const inputs = [1, 2, 3, null, undefined];
  inputs.forEach((input) => {
    const result = process(input);
    if (input === null || input === undefined) {
      expect(result).toBeNull();
    } else {
      expect(result).toBe(input * 2);
    }
  });
});
// Which case failed? Hard to debug.

// ✅ VALID - Separate, explicit tests
it('should double positive numbers', () => {
  expect(process(1)).toBe(2);
  expect(process(2)).toBe(4);
});

it('should return null for null input', () => {
  expect(process(null)).toBeNull();
});

it('should return null for undefined input', () => {
  expect(process(undefined)).toBeNull();
});
```

#### Antipattern 10: Tests Without Arrange-Act-Assert

```typescript
// ❌ INVALID - Jumbled, unclear structure
it('should do stuff', () => {
  const x = getX();
  expect(x).toBeTruthy();
  doSomething(x);
  const y = getY(x);
  expect(y.value).toBe(5);
  updateY(y);
  expect(y.updated).toBe(true);
});

// ✅ VALID - Clear AAA structure
it('should mark item as updated after modification', () => {
  // Arrange
  const item = createItem({ value: 5 });

  // Act
  const result = updateItem(item, { value: 10 });

  // Assert
  expect(result.value).toBe(10);
  expect(result.updated).toBe(true);
  expect(result.updatedAt).toBeInstanceOf(Date);
});
```

### 1.3 Valid Unit Test Patterns

#### Pattern: Testing Business Rules

```typescript
// ✅ EXCELLENT - Tests actual business logic
describe('OrderValidator', () => {
  it('should reject orders below minimum amount', () => {
    const order = createOrder({ total: 5 });
    const result = validateOrder(order);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Minimum order amount is $10');
  });

  it('should reject orders with out-of-stock items', () => {
    const order = createOrder({
      items: [{ productId: 'ABC', quantity: 5 }],
    });
    mockInventory.getStock.mockReturnValue(3);

    const result = validateOrder(order);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ABC: only 3 in stock, requested 5');
  });

  it('should apply bulk discount for orders over $100', () => {
    const order = createOrder({ subtotal: 150 });

    const result = calculateOrderTotal(order);

    expect(result.discount).toBe(15); // 10% bulk discount
    expect(result.total).toBe(135);
  });
});
```

#### Pattern: Testing Edge Cases

```typescript
// ✅ EXCELLENT - Boundary conditions
describe('Pagination', () => {
  it('should return empty array for page beyond results', () => {
    const items = [1, 2, 3];
    expect(paginate(items, { page: 10, perPage: 10 })).toEqual([]);
  });

  it('should handle exactly one page of results', () => {
    const items = [1, 2, 3, 4, 5];
    const result = paginate(items, { page: 1, perPage: 5 });
    expect(result).toHaveLength(5);
    expect(result.hasNextPage).toBe(false);
  });

  it('should handle empty input', () => {
    expect(paginate([], { page: 1, perPage: 10 })).toEqual([]);
  });
});
```

#### Pattern: Testing State Transitions

```typescript
// ✅ EXCELLENT - State machine behavior
describe('Order State Machine', () => {
  it('should transition from pending to confirmed on payment', () => {
    const order = createOrder({ status: 'pending' });

    const result = processPayment(order, validPayment);

    expect(result.status).toBe('confirmed');
    expect(result.paidAt).toBeInstanceOf(Date);
  });

  it('should not allow shipping unconfirmed orders', () => {
    const order = createOrder({ status: 'pending' });

    expect(() => shipOrder(order)).toThrow('Cannot ship pending order');
  });

  it('should allow cancellation only before shipping', () => {
    const pendingOrder = createOrder({ status: 'pending' });
    const shippedOrder = createOrder({ status: 'shipped' });

    expect(canCancel(pendingOrder)).toBe(true);
    expect(canCancel(shippedOrder)).toBe(false);
  });
});
```

---

## Phase 2: Integration Test Validity

### 2.1 What Makes a Valid Integration Test

Integration tests verify that components work together correctly. They should test:

- API request/response cycles
- Database operations produce correct results
- Service interactions behave correctly
- Authentication/authorization flows work

**NOT:**

- That the database driver works
- That HTTP libraries work
- That the ORM can save data

### 2.2 Integration Test Antipatterns

#### Antipattern: Testing Framework Behavior

```typescript
// ❌ INVALID - Tests that Express routes work
it('should return 200', async () => {
  const response = await request(app).get('/health');
  expect(response.status).toBe(200);
});
// Proves nothing about your application

// ✅ VALID - Tests your application's behavior
it('should return user profile for authenticated request', async () => {
  const user = await createTestUser({ name: 'Alice' });
  const token = generateToken(user);

  const response = await request(app).get('/api/profile').set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(response.body.name).toBe('Alice');
  expect(response.body.email).toBe(user.email);
  expect(response.body).not.toHaveProperty('password');
});
```

#### Antipattern: Not Testing Error Paths

```typescript
// ❌ INCOMPLETE - Only happy path
describe('POST /api/users', () => {
  it('should create user', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' });
    expect(response.status).toBe(201);
  });
});

// ✅ COMPLETE - Happy path AND error paths
describe('POST /api/users', () => {
  it('should create user with valid data', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'alice@example.com' });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
  });

  it('should reject duplicate email', async () => {
    await createTestUser({ email: 'alice@example.com' });

    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice 2', email: 'alice@example.com' });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('email already exists');
  });

  it('should reject invalid email format', async () => {
    const response = await request(app)
      .post('/api/users')
      .send({ name: 'Alice', email: 'not-an-email' });

    expect(response.status).toBe(400);
    expect(response.body.errors).toContainEqual(expect.objectContaining({ field: 'email' }));
  });

  it('should require authentication for protected endpoint', async () => {
    const response = await request(app).get('/api/users/me');
    expect(response.status).toBe(401);
  });
});
```

#### Antipattern: Shared Mutable State

```typescript
// ❌ INVALID - Tests depend on each other
let testUser;

beforeAll(async () => {
  testUser = await createUser({ name: 'Test' });
});

it('should update user', async () => {
  await updateUser(testUser.id, { name: 'Updated' });
  testUser = await getUser(testUser.id);
  expect(testUser.name).toBe('Updated');
});

it('should delete user', async () => {
  await deleteUser(testUser.id); // Fails if previous test didn't run!
});

// ✅ VALID - Each test is isolated
it('should update user', async () => {
  const user = await createTestUser({ name: 'Test' });

  await updateUser(user.id, { name: 'Updated' });

  const updated = await getUser(user.id);
  expect(updated.name).toBe('Updated');
});

it('should delete user', async () => {
  const user = await createTestUser({ name: 'Test' });

  await deleteUser(user.id);

  await expect(getUser(user.id)).rejects.toThrow('not found');
});
```

---

## Phase 3: E2E Test Validity (Playwright)

### 3.1 The E2E Validity Problem

E2E tests are expensive to run and maintain. Invalid E2E tests are WORSE than no tests because they:

- Slow down CI/CD
- Create false confidence
- Become "flaky" and ignored
- Waste debugging time

### 3.2 Questions Before Writing E2E Tests

1. **What user journey does this test?**
   - "User can sign up and verify email"
   - "User can add item to cart and checkout"
   - NOT: "The page loads"

2. **Would a unit/integration test suffice?**
   - E2E should test integration of the WHOLE system
   - If testing one component, use component tests

3. **What's the cost/benefit?**
   - Critical user paths: High value
   - Admin-only features: Lower priority
   - Edge cases: Usually unit tests

### 3.3 When Existence Checks ARE Valid

**Not all "element exists" tests are bad.** The question is: what user problem does this catch?

**Valid reasons to check element visibility:**

1. **Feature discoverability** - Ensuring users can find critical features after UI changes
2. **Regression prevention** - Catching accidental removal/hiding of important UI
3. **Navigation integrity** - Verifying users can still reach key areas
4. **Critical entry points** - Buy buttons, sign-up CTAs, support links

```typescript
// ✅ VALID - Ensures critical conversion element remains visible
test('checkout button is visible on product page', async ({ page }) => {
  await page.goto('/products/featured-item');

  // This matters because if checkout disappears, revenue stops
  await expect(page.getByRole('button', { name: /add to cart/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /buy now/i })).toBeVisible();
});

// ✅ VALID - Ensures feature remains discoverable after redesign
test('users can find the export feature', async ({ page }) => {
  await loginAs(page, testUser);
  await page.goto('/dashboard');

  // Export was moved in redesign - ensure it's still findable
  await expect(page.getByRole('button', { name: /export/i })).toBeVisible();
});

// ✅ VALID - Navigation regression test
test('main navigation contains all primary sections', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: /main/i });

  // These are contractual - if any disappear, users lose access
  await expect(nav.getByRole('link', { name: /dashboard/i })).toBeVisible();
  await expect(nav.getByRole('link', { name: /projects/i })).toBeVisible();
  await expect(nav.getByRole('link', { name: /settings/i })).toBeVisible();
});
```

**The key distinction:**

- ❌ Testing `<header>` exists because you need a test
- ✅ Testing "Add to Cart" is visible because if it's gone, the business fails

### 3.4 E2E Antipatterns (EXHAUSTIVE)

#### Antipattern 1: Meaningless Existence Checks

```typescript
// ❌ INVALID - Generic structure checks prove nothing
test('homepage loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header')).toBeVisible();
  await expect(page.locator('footer')).toBeVisible();
  await expect(page.locator('nav')).toBeVisible();
});
// Ask: What breaks if header is missing? Nothing important.

// ❌ INVALID - Checking form exists without testing it works
test('login page has form', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});
// Ask: Does this catch a broken login? No.

// ✅ VALID - Tests actual user flow
test('user can log in with valid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'user@example.com');
  await page.fill('input[type="password"]', 'password123');
  await page.click('button[type="submit"]');

  // Verify successful login by checking redirect AND user state
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('[data-testid="user-menu"]')).toContainText('user@example.com');
});
```

#### Antipattern 2: Checking Headings/Titles Only

```typescript
// ❌ INVALID - The heading being there tells us nothing
test('dashboard page', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('h1')).toHaveText('Dashboard');
});

// ❌ INVALID - Page title doesn't verify functionality
test('settings page loads', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveTitle(/Settings/);
});

// ✅ VALID - Tests that dashboard shows user's data
test('dashboard displays user tasks', async ({ page }) => {
  // Arrange - create user with tasks
  const user = await createTestUser();
  await createTask({ userId: user.id, title: 'Review PR' });
  await createTask({ userId: user.id, title: 'Deploy to prod' });

  // Act
  await loginAs(page, user);
  await page.goto('/dashboard');

  // Assert - actual data is displayed
  await expect(page.locator('[data-testid="task-list"]')).toContainText('Review PR');
  await expect(page.locator('[data-testid="task-list"]')).toContainText('Deploy to prod');
});
```

#### Antipattern 3: Checking Static Content

```typescript
// ❌ INVALID - Testing that HTML was deployed
test('about page has content', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('main')).toContainText('About Us');
  await expect(page.locator('main')).toContainText('Our Mission');
});

// ❌ INVALID - Testing marketing copy
test('pricing page shows plans', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.locator('.plan-card')).toHaveCount(3);
  await expect(page.locator('.plan-card').first()).toContainText('Basic');
});

// ✅ VALID - Testing interactive pricing calculator
test('pricing calculator updates based on usage', async ({ page }) => {
  await page.goto('/pricing');

  // Interact with calculator
  await page.fill('[data-testid="users-input"]', '50');
  await page.selectOption('[data-testid="billing-cycle"]', 'annual');

  // Verify calculated price
  await expect(page.locator('[data-testid="total-price"]')).toContainText('$2,400/year');
  await expect(page.locator('[data-testid="savings"]')).toContainText('Save $600');
});
```

#### Antipattern 4: Brittle Selectors

```typescript
// ❌ INVALID - Breaks on any HTML restructure
test('submit form', async ({ page }) => {
  await page.click('div.container > div.form-wrapper > form > div:nth-child(3) > button');
});

// ❌ INVALID - Breaks on class name changes
test('open menu', async ({ page }) => {
  await page.click('.MuiButton-root.MuiButton-containedPrimary');
});

// ❌ INVALID - Hardcoded text breaks on i18n
test('click submit', async ({ page }) => {
  await page.click('text=Submit Form Now');
});

// ✅ VALID - Semantic, resilient selectors
test('submit contact form', async ({ page }) => {
  await page.click('[data-testid="contact-submit"]');
  // or
  await page.click('button[type="submit"]');
  // or
  await page.getByRole('button', { name: /submit/i }).click();
});
```

#### Antipattern 5: No Assertions After Actions

```typescript
// ❌ INVALID - Clicks things but doesn't verify outcome
test('user flow', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="signup-button"]');
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'password123');
  await page.click('button[type="submit"]');
  // Test ends here - did signup work? Who knows!
});

// ✅ VALID - Verifies each significant outcome
test('user can complete signup flow', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="signup-button"]');

  // Fill form
  await page.fill('#email', 'newuser@example.com');
  await page.fill('#password', 'SecurePass123!');
  await page.fill('#confirmPassword', 'SecurePass123!');
  await page.click('button[type="submit"]');

  // Verify: redirect to verification page
  await expect(page).toHaveURL('/verify-email');
  await expect(page.locator('main')).toContainText('Check your email');

  // Verify: email was sent (check via API or test mailbox)
  const emails = await getTestEmails('newuser@example.com');
  expect(emails).toHaveLength(1);
  expect(emails[0].subject).toContain('Verify your email');
});
```

#### Antipattern 6: Not Testing Error States

```typescript
// ❌ INCOMPLETE - Only happy path
test('login', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'valid@example.com');
  await page.fill('#password', 'validpassword');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/dashboard');
});

// ✅ COMPLETE - Happy path AND error cases
test.describe('Login', () => {
  test('succeeds with valid credentials', async ({ page }) => {
    const user = await createTestUser({ password: 'validpassword' });

    await page.goto('/login');
    await page.fill('#email', user.email);
    await page.fill('#password', 'validpassword');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL('/dashboard');
  });

  test('shows error for invalid password', async ({ page }) => {
    const user = await createTestUser();

    await page.goto('/login');
    await page.fill('#email', user.email);
    await page.fill('#password', 'wrongpassword');
    await page.click('button[type="submit"]');

    await expect(page.locator('[role="alert"]')).toContainText('Invalid credentials');
    await expect(page).toHaveURL('/login'); // Still on login page
  });

  test('shows validation error for invalid email format', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', 'not-an-email');
    await page.fill('#password', 'password');
    await page.click('button[type="submit"]');

    await expect(page.locator('#email-error')).toContainText('valid email');
  });

  test('shows error after too many failed attempts', async ({ page }) => {
    const user = await createTestUser();

    await page.goto('/login');

    // Attempt login 5 times with wrong password
    for (let i = 0; i < 5; i++) {
      await page.fill('#email', user.email);
      await page.fill('#password', 'wrongpassword');
      await page.click('button[type="submit"]');
      await page.waitForSelector('[role="alert"]');
    }

    await expect(page.locator('[role="alert"]')).toContainText('Too many attempts');
    await expect(page.locator('button[type="submit"]')).toBeDisabled();
  });
});
```

#### Antipattern 7: Hardcoded Waits

```typescript
// ❌ INVALID - Arbitrary wait time
test('load data', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForTimeout(3000); // Magic number, may not be enough
  await expect(page.locator('.data')).toBeVisible();
});

// ❌ INVALID - Still arbitrary
test('submit form', async ({ page }) => {
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  await expect(page).toHaveURL('/success');
});

// ✅ VALID - Wait for specific conditions
test('load data', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('[data-testid="data-loaded"]')).toBeVisible();
});

// ✅ VALID - Wait for network/state
test('submit form', async ({ page }) => {
  await Promise.all([page.waitForURL('/success'), page.click('button[type="submit"]')]);

  await expect(page.locator('h1')).toContainText('Success');
});

// ✅ VALID - Wait for API response
test('save settings', async ({ page }) => {
  const responsePromise = page.waitForResponse('**/api/settings');
  await page.click('[data-testid="save-settings"]');
  const response = await responsePromise;

  expect(response.status()).toBe(200);
  await expect(page.locator('[data-testid="toast"]')).toContainText('Saved');
});
```

#### Antipattern 8: Testing Third-Party Integrations in E2E

```typescript
// ❌ INVALID - Testing Stripe's checkout (flaky, slow, external dependency)
test('complete payment', async ({ page }) => {
  await page.goto('/checkout');
  await page.click('[data-testid="pay-button"]');

  // This is Stripe's iframe - unreliable to test
  const stripeFrame = page.frameLocator('iframe[name^="__privateStripeFrame"]');
  await stripeFrame.locator('[name="cardnumber"]').fill('4242424242424242');
  // ... more Stripe interaction
});

// ✅ VALID - Mock payment provider, test your integration
test('complete payment flow', async ({ page }) => {
  // Use Stripe test mode or mock
  await page.goto('/checkout');
  await page.fill('[data-testid="card-number"]', '4242424242424242');
  await page.fill('[data-testid="card-expiry"]', '12/25');
  await page.fill('[data-testid="card-cvc"]', '123');
  await page.click('[data-testid="pay-button"]');

  // Verify YOUR application's handling of payment success
  await expect(page).toHaveURL('/order-confirmation');
  await expect(page.locator('[data-testid="order-status"]')).toContainText('Paid');
});
```

#### Antipattern 9: One Giant Test

```typescript
// ❌ INVALID - Too many things, hard to debug failures
test('entire user journey', async ({ page }) => {
  // Signup
  await page.goto('/signup');
  await page.fill('#email', 'user@test.com');
  // ... 20 more lines

  // Create project
  await page.goto('/projects/new');
  // ... 15 more lines

  // Invite team member
  await page.goto('/team');
  // ... 15 more lines

  // Configure settings
  await page.goto('/settings');
  // ... 20 more lines

  // Generate report
  await page.goto('/reports');
  // ... 15 more lines
});
// If this fails on line 47, what broke?

// ✅ VALID - Separate, focused tests with shared setup
test.describe('User onboarding', () => {
  test('user can create account', async ({ page }) => {
    await page.goto('/signup');
    await page.fill('#email', 'user@test.com');
    await page.fill('#password', 'SecurePass123!');
    await page.click('[data-testid="signup-submit"]');

    await expect(page).toHaveURL('/onboarding');
  });

  test('user can create first project', async ({ page }) => {
    await loginAsNewUser(page);

    await page.goto('/projects/new');
    await page.fill('#name', 'My First Project');
    await page.click('[data-testid="create-project"]');

    await expect(page).toHaveURL(/\/projects\/\w+/);
    await expect(page.locator('h1')).toContainText('My First Project');
  });

  test('user can invite team member', async ({ page }) => {
    const { user, project } = await setupUserWithProject();
    await loginAs(page, user);

    await page.goto(`/projects/${project.id}/team`);
    await page.fill('#email', 'teammate@test.com');
    await page.click('[data-testid="send-invite"]');

    await expect(page.locator('[data-testid="pending-invites"]')).toContainText(
      'teammate@test.com',
    );
  });
});
```

#### Antipattern 10: Ignoring Accessibility in E2E

```typescript
// ❌ INCOMPLETE - Clicks work, but keyboard users can't use it
test('open dropdown', async ({ page }) => {
  await page.click('[data-testid="menu-trigger"]');
  await expect(page.locator('[data-testid="menu"]')).toBeVisible();
});

// ✅ VALID - Test both mouse AND keyboard interaction
test('dropdown is keyboard accessible', async ({ page }) => {
  await page.goto('/dashboard');

  // Focus the trigger
  await page.locator('[data-testid="menu-trigger"]').focus();

  // Open with keyboard
  await page.keyboard.press('Enter');
  await expect(page.locator('[role="menu"]')).toBeVisible();

  // Navigate with arrow keys
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[role="menuitem"]').first()).toBeFocused();

  // Close with Escape
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="menu"]')).not.toBeVisible();
});
```

### 3.5 Complete User Journey Testing

**Larger tests that cover complete user journeys are valuable.** Don't fragment user flows into tiny isolated tests - you'll miss integration issues and create maintenance burden.

#### When to Write Journey Tests

| Scenario                  | Test Approach                           |
| ------------------------- | --------------------------------------- |
| Core conversion funnel    | Single test covering entire flow        |
| Multi-step wizard/form    | Test complete wizard, not each step     |
| Onboarding flow           | Test from signup through first value    |
| Cross-session flows       | Test email verification, password reset |
| Critical business process | Test end-to-end with data verification  |

#### Identifying Critical User Journeys

Ask: **"If this breaks, what happens?"**

```
Revenue impact?
├── HIGH (checkout, subscription) → Must have journey test
├── MEDIUM (feature adoption) → Should have journey test
└── LOW (settings, profile) → Individual tests OK

User acquisition impact?
├── HIGH (signup, onboarding) → Must have journey test
├── MEDIUM (invite flow) → Should have journey test
└── LOW (preferences) → Individual tests OK

Data integrity risk?
├── HIGH (payments, imports) → Journey test + data verification
├── MEDIUM (CRUD operations) → Journey test
└── LOW (display only) → Individual tests OK
```

#### Journey Test Structure

```typescript
// ✅ EXCELLENT - Complete onboarding journey
test('new user can sign up, verify email, and complete onboarding', async ({ page }) => {
  // Step 1: Sign up
  await page.goto('/signup');
  const email = `test-${Date.now()}@example.com`;
  await page.fill('#email', email);
  await page.fill('#password', 'SecurePass123!');
  await page.click('[data-testid="signup-submit"]');

  // Verify: Redirected to verification pending
  await expect(page).toHaveURL('/verify-email');
  await expect(page.locator('main')).toContainText('Check your email');

  // Step 2: Email verification (simulate clicking email link)
  const verificationToken = await getVerificationToken(email);
  await page.goto(`/verify-email?token=${verificationToken}`);

  // Verify: Email confirmed, redirected to onboarding
  await expect(page).toHaveURL('/onboarding');
  await expect(page.locator('h1')).toContainText('Welcome');

  // Step 3: Complete onboarding wizard
  await page.fill('#company-name', 'Test Company');
  await page.click('[data-testid="next-step"]');

  await page.click('[data-testid="role-developer"]');
  await page.click('[data-testid="next-step"]');

  await page.click('[data-testid="complete-onboarding"]');

  // Verify: Landed on dashboard with correct state
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('[data-testid="welcome-message"]')).toContainText('Test Company');

  // Verify: Database state is correct
  const user = await getUserByEmail(email);
  expect(user.emailVerified).toBe(true);
  expect(user.onboardingComplete).toBe(true);
  expect(user.company).toBe('Test Company');
});
```

#### Cross-Session Flow Testing

```typescript
// ✅ EXCELLENT - Password reset spans multiple sessions
test('user can reset forgotten password', async ({ page, context }) => {
  const user = await createTestUser({ email: 'forgot@example.com' });

  // Session 1: Request password reset
  await page.goto('/login');
  await page.click('[data-testid="forgot-password"]');
  await page.fill('#email', user.email);
  await page.click('[data-testid="send-reset"]');

  await expect(page.locator('[role="alert"]')).toContainText('Check your email');

  // Simulate: User clicks email link (new session)
  const resetToken = await getPasswordResetToken(user.email);
  const newPage = await context.newPage(); // Fresh session
  await newPage.goto(`/reset-password?token=${resetToken}`);

  // Session 2: Set new password
  await newPage.fill('#new-password', 'NewSecurePass456!');
  await newPage.fill('#confirm-password', 'NewSecurePass456!');
  await newPage.click('[data-testid="reset-submit"]');

  await expect(newPage).toHaveURL('/login');
  await expect(newPage.locator('[role="alert"]')).toContainText('Password updated');

  // Verify: Can login with new password
  await newPage.fill('#email', user.email);
  await newPage.fill('#password', 'NewSecurePass456!');
  await newPage.click('[data-testid="login-submit"]');

  await expect(newPage).toHaveURL('/dashboard');
});
```

#### Testing Flow Interruption & Recovery

```typescript
// ✅ EXCELLENT - User can resume interrupted checkout
test('checkout state persists if user navigates away', async ({ page }) => {
  const user = await createTestUser();
  await loginAs(page, user);

  // Start checkout
  await page.goto('/products/item-1');
  await page.click('[data-testid="add-to-cart"]');
  await page.goto('/cart');
  await page.click('[data-testid="checkout"]');

  // Fill shipping (partial completion)
  await page.fill('[data-testid="shipping-address"]', '123 Main St');
  await page.fill('[data-testid="shipping-city"]', 'Austin');

  // User navigates away (distraction, comparison shopping)
  await page.goto('/products');
  await page.goto('/'); // Even goes to homepage

  // Return to checkout
  await page.goto('/checkout');

  // Verify: Previous progress preserved
  await expect(page.locator('[data-testid="shipping-address"]')).toHaveValue('123 Main St');
  await expect(page.locator('[data-testid="shipping-city"]')).toHaveValue('Austin');
  await expect(page.locator('[data-testid="cart-summary"]')).toContainText('item-1');
});
```

### 3.6 Valid E2E Test Patterns

#### Pattern: Complete User Journey

```typescript
// ✅ EXCELLENT - Full purchase flow
test('user can complete purchase', async ({ page }) => {
  // Setup
  const product = await createTestProduct({ price: 29.99, stock: 10 });
  const user = await createTestUser();
  await loginAs(page, user);

  // Browse and add to cart
  await page.goto(`/products/${product.id}`);
  await expect(page.locator('[data-testid="product-price"]')).toContainText('$29.99');
  await page.click('[data-testid="add-to-cart"]');

  // Verify cart
  await page.goto('/cart');
  await expect(page.locator('[data-testid="cart-item"]')).toContainText(product.name);
  await expect(page.locator('[data-testid="cart-total"]')).toContainText('$29.99');

  // Checkout
  await page.click('[data-testid="checkout"]');
  await page.fill('[data-testid="shipping-address"]', '123 Test St');
  await page.fill('[data-testid="card-number"]', '4242424242424242');
  await page.fill('[data-testid="card-expiry"]', '12/25');
  await page.fill('[data-testid="card-cvc"]', '123');

  // Complete purchase
  await Promise.all([
    page.waitForURL('/order-confirmation'),
    page.click('[data-testid="place-order"]'),
  ]);

  // Verify confirmation
  await expect(page.locator('[data-testid="order-number"]')).toBeVisible();
  await expect(page.locator('[data-testid="order-total"]')).toContainText('$29.99');

  // Verify in database
  const orders = await getOrdersForUser(user.id);
  expect(orders).toHaveLength(1);
  expect(orders[0].total).toBe(29.99);

  // Verify inventory updated
  const updatedProduct = await getProduct(product.id);
  expect(updatedProduct.stock).toBe(9);
});
```

#### Pattern: Critical Business Rule Enforcement

```typescript
// ✅ EXCELLENT - Tests permission boundaries
test.describe('Role-based access control', () => {
  test('admin can access user management', async ({ page }) => {
    const admin = await createTestUser({ role: 'admin' });
    await loginAs(page, admin);

    await page.goto('/admin/users');

    await expect(page.locator('h1')).toContainText('User Management');
    await expect(page.locator('[data-testid="user-list"]')).toBeVisible();
  });

  test('regular user cannot access user management', async ({ page }) => {
    const user = await createTestUser({ role: 'user' });
    await loginAs(page, user);

    await page.goto('/admin/users');

    // Should redirect to access denied or home
    await expect(page).toHaveURL(/\/(403|dashboard)/);
    await expect(page.locator('[data-testid="user-list"]')).not.toBeVisible();
  });

  test('user can only see their own data', async ({ page }) => {
    const user1 = await createTestUser({ name: 'Alice' });
    const user2 = await createTestUser({ name: 'Bob' });
    const user2Project = await createProject({ ownerId: user2.id, name: 'Secret Project' });

    await loginAs(page, user1);
    await page.goto(`/projects/${user2Project.id}`);

    // Should not see other user's project
    await expect(page).toHaveURL('/404');
  });
});
```

#### Pattern: Form Validation E2E

```typescript
// ✅ EXCELLENT - Tests real validation behavior
test.describe('Registration form validation', () => {
  test('shows inline errors for invalid fields', async ({ page }) => {
    await page.goto('/register');

    // Submit empty form
    await page.click('[data-testid="register-submit"]');

    // Verify inline errors appear
    await expect(page.locator('#email-error')).toContainText('required');
    await expect(page.locator('#password-error')).toContainText('required');

    // Fill invalid email
    await page.fill('#email', 'not-an-email');
    await page.click('[data-testid="register-submit"]');
    await expect(page.locator('#email-error')).toContainText('valid email');

    // Fill weak password
    await page.fill('#email', 'user@example.com');
    await page.fill('#password', '123');
    await page.click('[data-testid="register-submit"]');
    await expect(page.locator('#password-error')).toContainText('at least 8 characters');
  });

  test('password strength indicator updates in real-time', async ({ page }) => {
    await page.goto('/register');

    // Weak password
    await page.fill('#password', 'password');
    await expect(page.locator('[data-testid="strength-indicator"]')).toHaveAttribute(
      'data-strength',
      'weak',
    );

    // Medium password
    await page.fill('#password', 'Password1');
    await expect(page.locator('[data-testid="strength-indicator"]')).toHaveAttribute(
      'data-strength',
      'medium',
    );

    // Strong password
    await page.fill('#password', 'MyP@ssw0rd!2024');
    await expect(page.locator('[data-testid="strength-indicator"]')).toHaveAttribute(
      'data-strength',
      'strong',
    );
  });
});
```

---

## Phase 4: Test Structure & Organization

### 4.1 Naming Conventions

```typescript
// ❌ INVALID - Vague names
test('test1', async () => {});
test('it works', async () => {});
test('should render', async () => {});
test('handleClick', async () => {});

// ✅ VALID - Describes behavior and context
test('displays error message when login fails', async () => {});
test('redirects to dashboard after successful login', async () => {});
test('disables submit button while form is submitting', async () => {});
test('user can filter tasks by status', async () => {});
```

### 4.2 Test Organization

```typescript
// ✅ VALID - Organized by feature and behavior
describe('TaskList', () => {
  describe('rendering', () => {
    it('displays all tasks', () => {});
    it('shows empty state when no tasks', () => {});
    it('shows loading skeleton while fetching', () => {});
  });

  describe('filtering', () => {
    it('filters by status', () => {});
    it('filters by assignee', () => {});
    it('combines multiple filters', () => {});
    it('shows "no results" when filter matches nothing', () => {});
  });

  describe('sorting', () => {
    it('sorts by due date ascending', () => {});
    it('sorts by priority descending', () => {});
    it('maintains sort after adding new task', () => {});
  });

  describe('actions', () => {
    it('marks task as complete', () => {});
    it('deletes task after confirmation', () => {});
    it('opens edit modal on task click', () => {});
  });
});
```

### 4.3 Test Data Management

```typescript
// ❌ INVALID - Hardcoded test data scattered everywhere
test('creates user', async () => {
  const response = await api.post('/users', {
    name: 'Test User',
    email: 'test@example.com',
    password: 'password123',
  });
});

// ✅ VALID - Factory functions for test data
// test-utils/factories.ts
export function createUserData(overrides = {}) {
  return {
    name: `Test User ${Date.now()}`,
    email: `test-${Date.now()}@example.com`,
    password: 'SecureTestPass123!',
    ...overrides,
  };
}

export function createTaskData(overrides = {}) {
  return {
    title: `Test Task ${Date.now()}`,
    status: 'pending',
    priority: 'medium',
    ...overrides,
  };
}

// In test
test('creates user', async () => {
  const userData = createUserData({ name: 'Alice' });
  const response = await api.post('/users', userData);

  expect(response.body.name).toBe('Alice');
});
```

---

## Phase 5: Audit Report

### Severity Classification

| Severity     | Criteria                                                        |
| ------------ | --------------------------------------------------------------- |
| **CRITICAL** | Tests that always pass (no assertions), testing mocks           |
| **HIGH**     | Only existence checks, no error path testing, brittle selectors |
| **MEDIUM**   | Weak assertions (toBeTruthy), missing edge cases, poor naming   |
| **LOW**      | Suboptimal organization, minor assertion improvements           |

### Validity Score

| Dimension         | Weight | Score Criteria                          |
| ----------------- | ------ | --------------------------------------- |
| Assertion Quality | 30%    | Specific assertions vs existence checks |
| Behavior Coverage | 25%    | Happy path + error paths + edge cases   |
| Isolation         | 20%    | No shared state, proper mocks           |
| Maintainability   | 15%    | Good names, organized, not brittle      |
| E2E Focus         | 10%    | Testing user journeys vs UI presence    |

### Report Template

````markdown
# Test Validity Audit Report

**Date**: [DATE]
**Scope**: [Unit / Integration / E2E / All]

## Executive Summary

| Metric              | Current | Target | Status   |
| ------------------- | ------- | ------ | -------- |
| Assertion Quality   | X%      | >80%   | 🟢/🟡/🔴 |
| Behavior Coverage   | X%      | >70%   | 🟢/🟡/🔴 |
| Invalid Tests Found | X       | 0      | 🟢/🟡/🔴 |

## Antipattern Summary

| Antipattern              | Count | Severity |
| ------------------------ | ----- | -------- |
| Existence-only checks    | X     | HIGH     |
| Missing error path tests | X     | HIGH     |
| toBeTruthy/toBeDefined   | X     | MEDIUM   |
| Testing implementation   | X     | HIGH     |
| Hardcoded waits          | X     | MEDIUM   |

## Findings

### [TEST-001] [File: path/to/test.ts]

**Severity**: HIGH
**Antipattern**: Existence-only check

**Current**:

```typescript
test('renders', () => {
  render(<Component />);
  expect(screen.getByRole('button')).toBeInTheDocument();
});
```
````

**Improved**:

```typescript
test('button triggers action when clicked', () => {
  const onAction = jest.fn();
  render(<Component onAction={onAction} />);

  fireEvent.click(screen.getByRole('button'));

  expect(onAction).toHaveBeenCalledTimes(1);
});
```

---

[Repeat for each finding]

## Recommendations

### Immediate Actions

1. [Fix invalid tests]
2. [Add missing error path tests]

### Guidelines to Establish

1. [Test naming conventions]
2. [Required assertions per test]
3. [E2E test criteria]

````

---

## Quick Reference

### Automated Checks

```bash
# Find weak assertions
grep -rE "toBeTruthy|toBeFalsy|toBeDefined|not\.toBeNull" --include="*.test.ts" --include="*.spec.ts"

# Find existence-only checks
grep -rE "toBeInTheDocument\(\)$|\.toExist\(\)$" --include="*.test.ts" --include="*.spec.ts"

# Find tests without assertions
for f in $(find . -name "*.test.ts" -o -name "*.spec.ts"); do
  grep -L "expect" "$f"
done

# Find hardcoded waits in Playwright
grep -rE "waitForTimeout" --include="*.spec.ts"

# Find tests with mock returning what's being tested
grep -rE "mock.*Return.*\n.*expect.*toBe" --include="*.test.ts"
````

### Validity Checklist

**Every Unit Test:**

- [ ] Has specific assertions (not just toBeTruthy)
- [ ] Tests behavior, not implementation
- [ ] Uses realistic test data
- [ ] Follows Arrange-Act-Assert pattern
- [ ] Has descriptive name

**Every E2E Test:**

- [ ] Tests a user journey or business rule
- [ ] Verifies outcomes, not just existence
- [ ] Uses resilient selectors (data-testid, roles)
- [ ] Includes error path testing
- [ ] No hardcoded waits
- [ ] Tests keyboard accessibility for interactive elements

**Test Suite:**

- [ ] Critical paths have full coverage (happy + error)
- [ ] No skipped tests in main branch
- [ ] Tests are isolated (can run in any order)
- [ ] Test data created fresh per test
