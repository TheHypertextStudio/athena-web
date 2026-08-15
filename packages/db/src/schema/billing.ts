/** `@docket/db` — organization product ownership. */
import type { ProductKey } from '@docket/types';
import { index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { productEntitlementSource, productEntitlementStatus } from '../enums';
import { organization } from './identity';

/**
 * Durable ownership of one paid product by one organization.
 *
 * @remarks
 * Baseline Docket access has no row. This table records only paid or complimentary products, so
 * capability checks cannot accidentally turn the free product into a billing state.
 */
export const organizationProductEntitlement = pgTable(
  'organization_product_entitlement',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    productKey: text('product_key').$type<ProductKey>().notNull(),
    status: productEntitlementStatus('status').notNull(),
    source: productEntitlementSource('source').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'),
    trialEndsAt: timestamp('trial_ends_at'),
    currentPeriodEnd: timestamp('current_period_end'),
    canceledAt: timestamp('canceled_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.productKey] }),
    index('organization_product_status_idx').on(table.productKey, table.status),
    index('organization_product_subscription_idx').on(table.stripeSubscriptionId),
  ],
);
