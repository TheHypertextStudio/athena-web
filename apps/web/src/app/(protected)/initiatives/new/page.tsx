/**
 * Create new initiative page.
 *
 * @packageDocumentation
 */

'use client';

import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { SurfaceContainer } from '@/components/ui/surface';
import { InitiativeForm } from '@/components/initiatives/initiative-form';
import { initiativesApi } from '@/lib/api-client';

/** Width for the form surface container */
const SURFACE_WIDTH = 560;

export default function NewInitiativePage() {
  const prefersReducedMotion = useReducedMotion();

  // Fetch existing initiatives for parent selection
  const { data: initiativesData } = useQuery({
    queryKey: ['initiatives'],
    queryFn: () => initiativesApi.list(),
  });

  const parentOptions = (initiativesData?.data ?? [])
    .filter((i) => i.statusCategory !== 'archived')
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
              <Link href="/initiatives">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Link>
            </Button>
            <h1 className="text-on-surface mt-4 text-2xl font-bold">New Initiative</h1>
            <p className="text-on-surface-variant mt-1 text-sm">
              Create a strategic objective to organize your projects and track progress toward
              meaningful goals.
            </p>
          </div>

          {/* Form */}
          <InitiativeForm parentOptions={parentOptions} />
        </SurfaceContainer>
      </motion.div>
    </main>
  );
}
