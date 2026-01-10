'use client';

import { useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateAIPreferences } from '@/lib/ai-actions';
import type { AIProvider } from '@/lib/ai-data';

const PROVIDER_NAMES: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

interface ProviderSelectionActionsProps {
  currentProvider: AIProvider;
  availableProviders: AIProvider[];
}

export function ProviderSelectionActions({
  currentProvider,
  availableProviders,
}: ProviderSelectionActionsProps) {
  const [isPending, startTransition] = useTransition();

  const handleProviderChange = (provider: string) => {
    startTransition(async () => {
      await updateAIPreferences({ preferredProvider: provider as AIProvider });
    });
  };

  return (
    <Select
      value={currentProvider}
      onValueChange={handleProviderChange}
      disabled={isPending || availableProviders.length === 0}
    >
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Select provider" />
      </SelectTrigger>
      <SelectContent>
        {availableProviders.map((provider) => (
          <SelectItem key={provider} value={provider}>
            {PROVIDER_NAMES[provider]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
