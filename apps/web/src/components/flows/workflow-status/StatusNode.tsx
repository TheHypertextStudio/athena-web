'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PendingIcon from '@mui/icons-material/Pending';
import CancelIcon from '@mui/icons-material/Cancel';
import StarIcon from '@mui/icons-material/Star';
import { cn } from '@/lib/utils';

export interface StatusNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  category: 'not_started' | 'in_progress' | 'done' | 'cancelled';
  color: string;
  isDefault?: boolean;
  position?: number;
}

export type StatusNodeType = Node<StatusNodeData, 'status'>;

const categoryConfig = {
  not_started: {
    icon: RadioButtonUncheckedIcon,
    label: 'Not Started',
    bgClass: 'bg-surface-variant',
    textClass: 'text-on-surface-variant',
  },
  in_progress: {
    icon: PendingIcon,
    label: 'In Progress',
    bgClass: 'bg-tertiary-container',
    textClass: 'text-on-tertiary-container',
  },
  done: {
    icon: CheckCircleIcon,
    label: 'Done',
    bgClass: 'bg-primary-container',
    textClass: 'text-on-primary-container',
  },
  cancelled: {
    icon: CancelIcon,
    label: 'Cancelled',
    bgClass: 'bg-error-container',
    textClass: 'text-on-error-container',
  },
};

function StatusNodeComponent({ data, selected }: NodeProps<StatusNodeType>) {
  const categoryInfo = categoryConfig[data.category];
  const CategoryIcon = categoryInfo.icon;

  return (
    <div
      className={cn(
        'relative min-w-[150px] rounded-xl border p-3 shadow-sm transition-all',
        selected
          ? 'border-primary ring-primary/20 ring-2'
          : 'border-outline-variant hover:border-outline',
      )}
      style={{ backgroundColor: `${data.color}15` }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-surface !h-3 !w-3 !border-2"
        style={{ backgroundColor: data.color }}
      />

      <div className="flex items-center gap-2">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${data.color}30` }}
        >
          <CategoryIcon sx={{ fontSize: 18 }} style={{ color: data.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h4 className="text-on-surface truncate text-sm font-medium">{data.name}</h4>
            {data.isDefault && (
              <StarIcon
                sx={{ fontSize: 14 }}
                className="text-tertiary flex-shrink-0"
                titleAccess="Default status"
              />
            )}
          </div>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-1.5 py-0.5 text-xs',
              categoryInfo.bgClass,
              categoryInfo.textClass,
            )}
          >
            {categoryInfo.label}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!border-surface !h-3 !w-3 !border-2"
        style={{ backgroundColor: data.color }}
      />
    </div>
  );
}

export const StatusNode = memo(StatusNodeComponent);
