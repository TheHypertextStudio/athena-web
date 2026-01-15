'use client';

import { useState, useCallback } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsSection, SettingsAlertBanner } from '@/components/settings/settings-section';
import {
  useInitiativeStatuses,
  useGroupedInitiativeStatuses,
  type CustomInitiativeStatus,
  type InitiativeStatusCategory,
  type CreateInitiativeStatusInput,
} from '@/hooks/use-initiative-statuses';
import { cn } from '@/lib/utils';

const CATEGORY_LABELS: Record<InitiativeStatusCategory, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
  archived: 'Archived',
};

const CATEGORY_DESCRIPTIONS: Record<InitiativeStatusCategory, string> = {
  planning: 'Initiatives in the planning phase, not yet started',
  active: 'Initiatives that are actively being worked on',
  completed: 'Initiatives that have been achieved',
  archived: 'Initiatives that are no longer relevant',
};

const DEFAULT_COLORS = [
  '#6B7280', // Gray
  '#3B82F6', // Blue
  '#10B981', // Green
  '#EF4444', // Red
  '#F59E0B', // Amber
  '#8B5CF6', // Purple
  '#EC4899', // Pink
  '#06B6D4', // Cyan
];

interface SortableStatusItemProps {
  status: CustomInitiativeStatus;
  onEdit: (status: CustomInitiativeStatus) => void;
  onDelete: (status: CustomInitiativeStatus) => void;
  onSetDefault: (status: CustomInitiativeStatus) => void;
}

function SortableStatusItem({ status, onEdit, onDelete, onSetDefault }: SortableStatusItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-surface-container-high flex items-center justify-between rounded-xl p-3',
        isDragging && 'opacity-50',
      )}
    >
      <div className="flex items-center gap-3">
        <button
          {...attributes}
          {...listeners}
          className="text-on-surface-variant hover:text-on-surface cursor-grab touch-none"
        >
          <DragIndicatorIcon sx={{ fontSize: 20 }} />
        </button>
        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.color }} />
        <div>
          <div className="flex items-center gap-2">
            <span className="text-on-surface font-medium">{status.name}</span>
            {status.isDefault && (
              <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 text-xs font-medium">
                Default
              </span>
            )}
          </div>
          {status.description && (
            <p className="text-on-surface-variant text-xs">{status.description}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!status.isDefault && (
          <Button
            variant="text"
            size="icon"
            onClick={() => {
              onSetDefault(status);
            }}
            title="Set as default"
          >
            <CheckCircleOutlineIcon sx={{ fontSize: 18 }} />
          </Button>
        )}
        <Button
          variant="text"
          size="icon"
          onClick={() => {
            onEdit(status);
          }}
        >
          <EditOutlinedIcon sx={{ fontSize: 18 }} />
        </Button>
        <Button
          variant="text"
          size="icon"
          onClick={() => {
            onDelete(status);
          }}
        >
          <DeleteOutlineIcon sx={{ fontSize: 18 }} />
        </Button>
      </div>
    </div>
  );
}

interface CategorySectionProps {
  category: InitiativeStatusCategory;
  statuses: CustomInitiativeStatus[];
  onEdit: (status: CustomInitiativeStatus) => void;
  onDelete: (status: CustomInitiativeStatus) => void;
  onSetDefault: (status: CustomInitiativeStatus) => void;
  onReorder: (category: InitiativeStatusCategory, statusIds: string[]) => void;
  onAddNew: (category: InitiativeStatusCategory) => void;
}

function CategorySection({
  category,
  statuses,
  onEdit,
  onDelete,
  onSetDefault,
  onReorder,
  onAddNew,
}: CategorySectionProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = statuses.findIndex((s) => s.id === active.id);
      const newIndex = statuses.findIndex((s) => s.id === over.id);
      const newOrder = arrayMove(statuses, oldIndex, newIndex);
      onReorder(
        category,
        newOrder.map((s) => s.id),
      );
    },
    [statuses, category, onReorder],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-on-surface font-medium">{CATEGORY_LABELS[category]}</h3>
          <p className="text-on-surface-variant text-xs">{CATEGORY_DESCRIPTIONS[category]}</p>
        </div>
        <Button
          variant="text"
          size="sm"
          onClick={() => {
            onAddNew(category);
          }}
        >
          <AddIcon sx={{ fontSize: 18 }} className="mr-1" />
          Add Status
        </Button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={statuses.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {statuses.map((status) => (
              <SortableStatusItem
                key={status.id}
                status={status}
                onEdit={onEdit}
                onDelete={onDelete}
                onSetDefault={onSetDefault}
              />
            ))}
            {statuses.length === 0 && (
              <p className="text-on-surface-variant py-4 text-center text-sm">
                No statuses in this category.
              </p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface StatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status?: CustomInitiativeStatus | null;
  defaultCategory?: InitiativeStatusCategory;
  onSave: (
    data: CreateInitiativeStatusInput | { id: string; data: Partial<CreateInitiativeStatusInput> },
  ) => void;
  isLoading?: boolean;
}

function StatusDialog({
  open,
  onOpenChange,
  status,
  defaultCategory,
  onSave,
  isLoading,
}: StatusDialogProps) {
  const [name, setName] = useState<string>(status?.name ?? '');
  const [description, setDescription] = useState<string>(status?.description ?? '');
  const [category, setCategory] = useState<InitiativeStatusCategory>(
    status?.category ?? defaultCategory ?? 'planning',
  );
  const [color, setColor] = useState<string>(status?.color ?? DEFAULT_COLORS[0] ?? '#6B7280');

  const isEditing = !!status;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditing) {
      onSave({
        id: status.id,
        data: { name, description: description || undefined, color },
      });
    } else {
      onSave({ name, description: description || undefined, category, color });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Status' : 'Add Status'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              placeholder="e.g., On Hold"
              required
              maxLength={50}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <textarea
              id="description"
              value={description}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                setDescription(e.target.value);
              }}
              placeholder="When should initiatives have this status?"
              maxLength={500}
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => {
                  setCategory(v as InitiativeStatusCategory);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    setColor(c);
                  }}
                  className={cn(
                    'h-8 w-8 rounded-full border-2 transition-all',
                    color === c ? 'border-primary scale-110' : 'border-transparent',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <Input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
              }}
              className="h-10 w-full cursor-pointer"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outlined"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name || isLoading}>
              {isLoading ? 'Saving...' : isEditing ? 'Save Changes' : 'Add Status'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function InitiativeStatusesSection() {
  const { groupedStatuses, isLoading: isLoadingGrouped } = useGroupedInitiativeStatuses();
  const {
    create,
    update,
    delete: deleteStatus,
    reorder,
    setDefault,
    isCreating,
    isUpdating,
    isDeleting,
  } = useInitiativeStatuses();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStatus, setEditingStatus] = useState<CustomInitiativeStatus | null>(null);
  const [defaultCategory, setDefaultCategory] = useState<InitiativeStatusCategory>('planning');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [statusToDelete, setStatusToDelete] = useState<CustomInitiativeStatus | null>(null);

  const handleEdit = useCallback((status: CustomInitiativeStatus) => {
    setEditingStatus(status);
    setDialogOpen(true);
  }, []);

  const handleAddNew = useCallback((category: InitiativeStatusCategory) => {
    setEditingStatus(null);
    setDefaultCategory(category);
    setDialogOpen(true);
  }, []);

  const handleDelete = useCallback((status: CustomInitiativeStatus) => {
    setStatusToDelete(status);
    setDeleteDialogOpen(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (statusToDelete) {
      deleteStatus(statusToDelete.id);
      setDeleteDialogOpen(false);
      setStatusToDelete(null);
    }
  }, [statusToDelete, deleteStatus]);

  const handleSetDefault = useCallback(
    (status: CustomInitiativeStatus) => {
      setDefault({ id: status.id });
    },
    [setDefault],
  );

  const handleReorder = useCallback(
    (category: InitiativeStatusCategory, statusIds: string[]) => {
      reorder({ category, statusIds });
    },
    [reorder],
  );

  const handleSave = useCallback(
    (
      data:
        | CreateInitiativeStatusInput
        | { id: string; data: Partial<CreateInitiativeStatusInput> },
    ) => {
      if ('id' in data) {
        update(data);
      } else {
        create(data);
      }
    },
    [create, update],
  );

  if (isLoadingGrouped) {
    return (
      <SettingsSection
        title="Initiative Statuses"
        description="Configure custom workflow statuses for initiatives"
      >
        <div className="animate-pulse space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-muted h-24 rounded-xl" />
          ))}
        </div>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        title="Initiative Statuses"
        description="Configure custom workflow statuses for initiatives. Drag to reorder within categories."
      >
        <SettingsAlertBanner variant="info" className="mb-4">
          Custom statuses are grouped by category. Categories determine how initiatives are filtered
          and displayed across Athena.
        </SettingsAlertBanner>

        <div className="space-y-6">
          <CategorySection
            category="planning"
            statuses={groupedStatuses.planning}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
            onReorder={handleReorder}
            onAddNew={handleAddNew}
          />
          <CategorySection
            category="active"
            statuses={groupedStatuses.active}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
            onReorder={handleReorder}
            onAddNew={handleAddNew}
          />
          <CategorySection
            category="completed"
            statuses={groupedStatuses.completed}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
            onReorder={handleReorder}
            onAddNew={handleAddNew}
          />
          <CategorySection
            category="archived"
            statuses={groupedStatuses.archived}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSetDefault={handleSetDefault}
            onReorder={handleReorder}
            onAddNew={handleAddNew}
          />
        </div>
      </SettingsSection>

      <StatusDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        status={editingStatus}
        defaultCategory={defaultCategory}
        onSave={handleSave}
        isLoading={isCreating || isUpdating}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Status</DialogTitle>
          </DialogHeader>
          <p className="text-on-surface-variant text-sm">
            Are you sure you want to delete the status &quot;{statusToDelete?.name}&quot;?
            Initiatives with this status should be reassigned to a different status first.
          </p>
          <DialogFooter>
            <Button
              variant="outlined"
              onClick={() => {
                setDeleteDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="filled"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-error text-on-error hover:bg-error/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
