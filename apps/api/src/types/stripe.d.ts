/**
 * Stripe type declarations stub.
 * This file provides minimal type definitions when the 'stripe' package is not installed.
 * Replace with actual Stripe types when the package is available.
 *
 * @packageDocumentation
 */

declare module 'stripe' {
  namespace Stripe {
    interface Customer {
      id: string;
      deleted?: boolean;
      email: string | null;
      name: string | null;
      invoice_settings: {
        default_payment_method: string | null;
      };
    }

    interface Subscription {
      id: string;
      customer: string | { id: string };
      status: string;
      current_period_start: number;
      current_period_end: number;
      cancel_at_period_end: boolean;
      metadata?: Record<string, string>;
    }

    interface Invoice {
      id: string;
      customer: string | { id: string } | null;
      subscription: string | { id: string } | null;
      status: string | null;
      amount_due: number;
      amount_paid: number;
      currency: string;
      invoice_pdf: string | null;
      hosted_invoice_url: string | null;
      created: number;
      status_transitions?: {
        paid_at: number | null;
      };
    }

    interface PaymentMethod {
      id: string;
      card?: {
        brand: string;
        last4: string;
        exp_month: number;
        exp_year: number;
      };
    }

    interface Event {
      type: string;
      data: {
        object: unknown;
      };
    }

    namespace Checkout {
      interface Session {
        id: string;
        url: string | null;
        metadata?: Record<string, string>;
      }

      interface SessionCreateParams {
        customer: string;
        mode: string;
        payment_method_types: string[];
        line_items: {
          price: string;
          quantity: number;
        }[];
        success_url: string;
        cancel_url: string;
        metadata?: Record<string, string>;
        subscription_data?: {
          trial_period_days?: number;
          metadata?: Record<string, string>;
        };
        discounts?: {
          coupon: string;
        }[];
      }
    }

    type LatestApiVersion = string;
  }

  class Stripe {
    constructor(
      apiKey: string,
      options?: {
        apiVersion?: Stripe.LatestApiVersion;
        typescript?: boolean;
      },
    );

    customers: {
      create(params: {
        email: string;
        name?: string;
        metadata?: Record<string, string>;
      }): Promise<Stripe.Customer>;
      retrieve(id: string): Promise<Stripe.Customer>;
      update(
        id: string,
        params: {
          invoice_settings?: {
            default_payment_method: string;
          };
        },
      ): Promise<Stripe.Customer>;
    };

    subscriptions: {
      update(
        id: string,
        params: {
          cancel_at_period_end?: boolean;
        },
      ): Promise<Stripe.Subscription>;
    };

    invoices: {
      list(params: { customer: string; limit?: number }): Promise<{
        data: Stripe.Invoice[];
      }>;
    };

    paymentMethods: {
      list(params: { customer: string; type: string }): Promise<{
        data: Stripe.PaymentMethod[];
      }>;
      detach(id: string): Promise<Stripe.PaymentMethod>;
    };

    checkout: {
      sessions: {
        create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
      };
    };

    billingPortal: {
      sessions: {
        create(params: { customer: string; return_url: string }): Promise<{ url: string }>;
      };
    };

    webhooks: {
      constructEvent(payload: string | Buffer, signature: string, secret: string): Stripe.Event;
    };
  }

  export default Stripe;
  export { Stripe };
}
