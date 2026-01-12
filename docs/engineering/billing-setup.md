# Billing & Stripe Setup

This guide covers setting up Stripe for billing and subscriptions in Project Athena.

## Overview

Athena uses Stripe for:

- Subscription management (Free, Pro, Team tiers)
- Payment processing
- Customer portal for self-service billing management
- Webhooks for subscription lifecycle events

## Prerequisites

1. A [Stripe account](https://dashboard.stripe.com/register)
2. Access to the Stripe Dashboard

## Stripe Configuration

### 1. Create Products and Prices

In your Stripe Dashboard, create the following products:

#### Pro Plan

1. Go to **Products** → **Add product**
2. Name: `Athena Pro`
3. Create two prices:
   - Monthly: `$12/month` (recurring)
   - Yearly: `$120/year` (recurring)

#### Team Plan

1. Create another product: `Athena Team`
2. Create two prices:
   - Monthly: `$25/month per seat` (recurring)
   - Yearly: `$250/year per seat` (recurring)

Note the Price IDs (e.g., `price_1ABC...`) for each price.

### 2. Configure Customer Portal

1. Go to **Settings** → **Billing** → **Customer portal**
2. Enable the following features:
   - Update payment methods
   - View invoice history
   - Cancel subscriptions
   - Switch plans (if desired)
3. Save the configuration

### 3. Set Up Webhooks

#### Local Development

Use the [Stripe CLI](https://stripe.com/docs/stripe-cli) to forward webhooks:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login to your Stripe account
stripe login

# Forward webhooks to your local server
stripe listen --forward-to localhost:3001/api/billing/webhook
```

The CLI will display a webhook signing secret (starts with `whsec_`). Use this for `STRIPE_WEBHOOK_SECRET`.

#### Production

1. Go to **Developers** → **Webhooks** → **Add endpoint**
2. Endpoint URL: `https://your-api-domain.com/api/billing/webhook`
3. Select events to listen to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy the signing secret for `STRIPE_WEBHOOK_SECRET`

## Environment Variables

Add these to your `.env` file:

```env
# Stripe API Keys (from Dashboard → Developers → API keys)
STRIPE_SECRET_KEY=sk_test_...          # Use sk_live_... in production
STRIPE_PUBLISHABLE_KEY=pk_test_...     # Use pk_live_... in production

# Webhook secret (from webhook setup above)
STRIPE_WEBHOOK_SECRET=whsec_...

# Price IDs (from product setup above)
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_TEAM_MONTHLY=price_...
STRIPE_PRICE_TEAM_YEARLY=price_...
```

### Test vs Live Mode

- **Test mode**: Use `sk_test_` and `pk_test_` keys. No real charges.
- **Live mode**: Use `sk_live_` and `pk_live_` keys. Real money.

Use [Stripe test cards](https://stripe.com/docs/testing#cards) for development:

- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Requires auth: `4000 0025 0000 3155`

## Entitlement System

### Plan Tiers

| Tier | Price  | Entitlements                                                                                                            |
| ---- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| Free | $0     | basic_tasks, basic_projects, basic_calendar, basic_activities                                                           |
| Pro  | $12/mo | All free + unlimited_tasks, unlimited_projects, time_tracking, integrations, export_data, priority_support, ai_features |
| Team | $25/mo | All pro + team_workspaces, team_collaboration, admin_controls, sso                                                      |

### How Entitlements Work

1. **Backend**: The `requireEntitlement` middleware checks user's plan before allowing mutations
2. **Frontend**: The `useEntitlements` hook provides `hasEntitlement()` for UI decisions
3. **API Errors**: 403 responses with `error: 'entitlement_required'` include upgrade info

### Backend Enforcement

```typescript
// Routes automatically enforce entitlements on mutations (POST/PUT/PATCH/DELETE)
// GET requests always pass through (read access is sacred)

import { requireEntitlement } from '../middleware/entitlements.js';

integrationRoutes.use('*', requireAuth);
integrationRoutes.use('*', requireEntitlement('integrations'));
```

### Frontend Usage

```typescript
import { useEntitlements } from '@/hooks/use-entitlements';
import { useEntitlementError } from '@/contexts/entitlement-error-context';

function MyComponent() {
  const { hasEntitlement, planTier } = useEntitlements();
  const { showUpgradeModal } = useEntitlementError();

  const handleAction = () => {
    if (!hasEntitlement('integrations')) {
      showUpgradeModal('integrations');
      return;
    }
    // proceed with action...
  };
}
```

## Webhook Events

The billing webhook handler processes these events:

| Event                           | Action                            |
| ------------------------------- | --------------------------------- |
| `checkout.session.completed`    | Create/update subscription record |
| `customer.subscription.updated` | Update plan tier and entitlements |
| `customer.subscription.deleted` | Downgrade to free tier            |
| `invoice.payment_failed`        | Mark subscription as `past_due`   |

## Database Schema

Subscriptions are stored in the `subscriptions` table:

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan_tier TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Troubleshooting

### Webhooks not received

1. Check Stripe CLI is running (local dev)
2. Verify webhook URL is correct and accessible
3. Check webhook signing secret matches
4. Look at Stripe Dashboard → Developers → Webhooks → Logs

### Subscription not updating

1. Check webhook handler logs for errors
2. Verify `stripe_customer_id` is stored on subscription record
3. Check Stripe Dashboard for the subscription status

### Entitlement checks failing

1. Verify subscription record exists for user
2. Check `plan_tier` value matches expected tier
3. Ensure entitlement middleware is applied to route

## Testing

### Manual Testing

1. Start local server and Stripe CLI webhook forwarding
2. Go to `/settings/billing` and click upgrade
3. Use test card `4242 4242 4242 4242`
4. Verify subscription created and entitlements granted
5. Test customer portal access
6. Test cancellation flow

### Automated Testing

Mock Stripe in tests:

```typescript
vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    customers: {
      create: vi.fn().mockResolvedValue({ id: 'cus_test' }),
    },
    subscriptions: {
      retrieve: vi.fn().mockResolvedValue({ status: 'active' }),
    },
  })),
}));
```
