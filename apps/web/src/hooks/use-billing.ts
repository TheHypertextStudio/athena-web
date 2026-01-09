'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '@/lib/api-client';
import type { Subscription } from '@/lib/api-client';

/**
 * Hook for managing billing and subscription.
 */
export function useBilling() {
  const queryClient = useQueryClient();

  const defaultSubscription: Subscription = {
    planTier: 'free',
    status: 'active',
    entitlements: [],
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };

  const subscriptionQuery = useQuery<Awaited<ReturnType<typeof billingApi.getSubscription>>>({
    queryKey: ['billing', 'subscription'],
    queryFn: () => billingApi.getSubscription(),
  });

  const plansQuery = useQuery<Awaited<ReturnType<typeof billingApi.getPlans>>>({
    queryKey: ['billing', 'plans'],
    queryFn: () => billingApi.getPlans(),
  });

  const invoicesQuery = useQuery<Awaited<ReturnType<typeof billingApi.getInvoices>>>({
    queryKey: ['billing', 'invoices'],
    queryFn: () => billingApi.getInvoices(5),
  });

  const paymentMethodsQuery = useQuery<Awaited<ReturnType<typeof billingApi.getPaymentMethods>>>({
    queryKey: ['billing', 'payment-methods'],
    queryFn: () => billingApi.getPaymentMethods(),
  });

  const checkoutMutation = useMutation({
    mutationFn: billingApi.createCheckout,
  });

  const portalMutation = useMutation({
    mutationFn: billingApi.createPortal,
  });

  const cancelMutation = useMutation({
    mutationFn: billingApi.cancel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: billingApi.resume,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    },
  });

  return {
    subscription: subscriptionQuery.data?.data ?? defaultSubscription,
    isLoadingSubscription: subscriptionQuery.isLoading,
    plans: plansQuery.data?.data.plans ?? [],
    isLoadingPlans: plansQuery.isLoading,
    invoices: invoicesQuery.data?.data.invoices ?? [],
    isLoadingInvoices: invoicesQuery.isLoading,
    paymentMethods: paymentMethodsQuery.data?.data.paymentMethods ?? [],
    isLoadingPaymentMethods: paymentMethodsQuery.isLoading,
    createCheckout: checkoutMutation.mutateAsync,
    isCreatingCheckout: checkoutMutation.isPending,
    openPortal: portalMutation.mutateAsync,
    isOpeningPortal: portalMutation.isPending,
    cancelSubscription: cancelMutation.mutate,
    isCanceling: cancelMutation.isPending,
    resumeSubscription: resumeMutation.mutate,
    isResuming: resumeMutation.isPending,
  };
}
