/**
 * Initiative form component.
 *
 * AI-native form for creating and editing initiatives.
 * Inline suggestions appear naturally as you type - no buttons, no modes.
 *
 * @packageDocumentation
 */

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SmartInput } from '@/components/ui/smart-input';
import { SmartTextarea } from '@/components/ui/smart-textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSnackbar } from '@/components/ui/snackbar';
import {
  initiativesApi,
  type Initiative,
  type CreateInitiativeInput,
  type UpdateInitiativeInput,
} from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { InitiativeStatusSelect } from './initiative-status-select';

export interface InitiativeFormProps {
  /** Existing initiative for editing (undefined for create) */
  initiative?: Initiative;
  /** Available parent initiatives for nesting */
  parentOptions?: { id: string; name: string }[];
  /** Additional class names */
  className?: string;
}

/**
 * Initiative form with AI-native inline suggestions.
 *
 * How it works:
 * - Start typing a description and a title will be suggested
 * - Press Tab to accept a suggestion
 * - Press Esc to dismiss
 * - Continue typing to ignore suggestions naturally
 *
 * @example
 * ```tsx
 * // Create mode
 * <InitiativeForm />
 *
 * // Edit mode
 * <InitiativeForm initiative={existingInitiative} />
 * ```
 */
export function InitiativeForm({ initiative, parentOptions = [], className }: InitiativeFormProps) {
  const router = useRouter();
  const snackbar = useSnackbar();
  const isEditing = !!initiative;

  // Form state
  const [name, setName] = useState(initiative?.name ?? '');
  const [description, setDescription] = useState(initiative?.description ?? '');
  const [statusId, setStatusId] = useState<string | undefined>(initiative?.statusId ?? undefined);
  const [parentId, setParentId] = useState<string | undefined>(initiative?.parentId ?? undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter out current initiative from parent options (can't be own parent)
  const availableParents = parentOptions.filter((p) => p.id !== initiative?.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      snackbar.show({ message: 'Name is required' });
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditing) {
        const updateData: UpdateInitiativeInput = {
          name: name.trim(),
          description: description.trim() || null,
          statusId,
          parentId: parentId ?? null,
        };
        await initiativesApi.update(initiative.id, updateData);
        snackbar.show({ message: 'Initiative updated' });
        router.push(`/initiatives/${initiative.id}`);
      } else {
        const createData: CreateInitiativeInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          statusId,
          parentId: parentId ?? undefined,
        };
        const response = await initiativesApi.create(createData);
        snackbar.show({ message: 'Initiative created' });
        router.push(`/initiatives/${response.data.id}`);
      }
    } catch {
      snackbar.show({
        message: isEditing ? 'Failed to update initiative' : 'Failed to create initiative',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className={cn('space-y-6', className)}>
      {/* Form Fields */}
      <div className="space-y-4">
        {/* Description - First, because typing here suggests the title */}
        <div className="space-y-2">
          <Label htmlFor="description">What do you want to achieve?</Label>
          <SmartTextarea
            id="description"
            value={description}
            onChange={setDescription}
            placeholder="I want to become proficient at piano by the end of the year..."
            objectType="initiative"
            fieldType="description"
            suggestionContext={{ title: name }}
            suggestionsEnabled={!isEditing}
          />
          <p className="text-on-surface-variant text-xs">
            Start typing and a title will be suggested based on your description.
          </p>
        </div>

        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <SmartInput
            id="name"
            value={name}
            onChange={setName}
            placeholder="Piano Proficiency"
            objectType="initiative"
            fieldType="title"
            suggestionContext={{ description }}
            suggestionsEnabled={!isEditing}
            required
          />
        </div>

        {/* Status and Parent */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <InitiativeStatusSelect value={statusId} onChange={setStatusId} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="parent">Parent Initiative</Label>
            <Select
              value={parentId ?? 'none'}
              onValueChange={(v) => {
                setParentId(v === 'none' ? undefined : v);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {availableParents.map((parent) => (
                  <SelectItem key={parent.id} value={parent.id}>
                    {parent.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button
          type="button"
          variant="text"
          onClick={() => {
            router.back();
          }}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting || !name.trim()}>
          {isSubmitting ? (
            <>
              <SyncOutlined sx={{ fontSize: 16 }} className="mr-2 animate-spin" />
              {isEditing ? 'Saving...' : 'Creating...'}
            </>
          ) : isEditing ? (
            'Save Changes'
          ) : (
            'Create Initiative'
          )}
        </Button>
      </div>
    </form>
  );
}
