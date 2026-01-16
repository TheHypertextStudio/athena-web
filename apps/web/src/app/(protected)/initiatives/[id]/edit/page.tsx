/**
 * Edit initiative page.
 *
 * @packageDocumentation
 */

'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SurfaceContainer } from '@/components/ui/surface';
import { Skeleton } from '@/components/ui/skeleton';
import { InitiativeForm } from '@/components/initiatives/initiative-form';
import { initiativesApi } from '@/lib/api-client';

/** Width for the form surface container */
const SURFACE_WIDTH = 560;

interface EditInitiativePageProps {
  params: Promise<{ id: string }>;
}

/**
 * Loading skeleton for the form.
 */
function FormSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
      <div className="flex justify-end gap-3">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}

export default function EditInitiativePage({ params }: EditInitiativePageProps) {
  const { id } = use(params);
  const prefersReducedMotion = useReducedMotion();

  // Fetch the initiative to edit
  const { data: initiativeData, isLoading: isLoadingInitiative } = useQuery({
    queryKey: ['initiative', id],
    queryFn: () => initiativesApi.get(id),
  });

  // Fetch all initiatives for parent selection
  const { data: initiativesData, isLoading: isLoadingInitiatives } = useQuery({
    queryKey: ['initiatives'],
    queryFn: () => initiativesApi.list(),
  });

  const isLoading = isLoadingInitiative || isLoadingInitiatives;
  const initiative = initiativeData?.data;

  const parentOptions = (initiativesData?.data ?? [])
    .filter((i) => i.statusCategory !== 'archived' && i.id !== id)
    .map((i) => ({ id: i.id, name: i.name }));

  return (
    <main className="h-screen overflow-y-auto p-4 md:p-6">
      <motion.div
        className="mx-auto"
        animate={{ maxWidth: SURFACE_WIDTH }}
        initial={false}
        transition={
          prefersReducedMotion ? { duration: 0 } : { duration: 0.3, ease: [0.2, 0, 0, 1] }
        }
      >
        <SurfaceContainer rounded="xl" padding="lg">
          {/* Header */}
          <div className="mb-6">
            <Button variant="text" size="sm" asChild className="text-on-surface-variant">
              <Link href={`/initiatives/${id}`}>
                <ArrowBackOutlined sx={{ fontSize: 16 }} className="mr-1" />
                Back
              </Link>
            </Button>
            <h1 className="text-on-surface mt-4 text-2xl font-bold">Edit Initiative</h1>
            {initiative && (
              <p className="text-on-surface-variant mt-1 text-sm">
                Update details for "{initiative.name}"
              </p>
            )}
          </div>

          {/* Form */}
          {isLoading ? (
            <FormSkeleton />
          ) : initiative ? (
            <InitiativeForm initiative={initiative} parentOptions={parentOptions} />
          ) : (
            <div className="py-8 text-center">
              <p className="text-on-surface-variant">Initiative not found</p>
              <Button asChild className="mt-4">
                <Link href="/initiatives">Back to Initiatives</Link>
              </Button>
            </div>
          )}
        </SurfaceContainer>
      </motion.div>
    </main>
  );
}
