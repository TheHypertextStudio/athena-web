'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import PendingIcon from '@mui/icons-material/Pending';
import CancelIcon from '@mui/icons-material/Cancel';
import FlagIcon from '@mui/icons-material/Flag';
import { cn } from '@/lib/utils';

export interface TaskNodeData extends Record<string, unknown> {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assignee?: string | null;
  deadline?: string | null;
  isBlocking?: boolean;
  color?: string;
}

export type TaskNodeType = Node<TaskNodeData, 'task'>;

const statusConfig = {
  pending: {
    icon: RadioButtonUncheckedIcon,
    label: 'Pending',
    className: 'text-on-surface-variant',
  },
  in_progress: {
    icon: PendingIcon,
    label: 'In Progress',
    className: 'text-tertiary',
  },
  completed: {
    icon: CheckCircleIcon,
    label: 'Done',
    className: 'text-primary',
  },
  cancelled: {
    icon: CancelIcon,
    label: 'Cancelled',
    className: 'text-error',
  },
};

const priorityConfig = {
  low: { label: 'Low', className: 'bg-surface-variant text-on-surface-variant' },
  medium: { label: 'Medium', className: 'bg-secondary-container text-on-secondary-container' },
  high: { label: 'High', className: 'bg-tertiary-container text-on-tertiary-container' },
  urgent: { label: 'Urgent', className: 'bg-error-container text-on-error-container' },
};

function TaskNodeComponent({ data, selected }: NodeProps<TaskNodeType>) {
  const statusInfo = statusConfig[data.status];
  const priorityInfo = priorityConfig[data.priority];
  const StatusIcon = statusInfo.icon;

  return (
    <div
      className={cn(
        'bg-surface-container max-w-[280px] min-w-[180px] rounded-xl border p-3 shadow-sm transition-all',
        selected
          ? 'border-primary ring-primary/20 ring-2'
          : 'border-outline-variant hover:border-outline',
        data.isBlocking && 'ring-error/30 ring-2',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-surface !bg-primary !h-3 !w-3 !border-2"
      />

      <div className="flex items-start gap-2">
        <StatusIcon className={cn('mt-0.5 h-5 w-5 flex-shrink-0', statusInfo.className)} />
        <div className="min-w-0 flex-1">
          <h4 className="text-on-surface truncate text-sm font-medium">{data.title}</h4>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                priorityInfo.className,
              )}
            >
              <FlagIcon sx={{ fontSize: 12 }} className="mr-0.5" />
              {priorityInfo.label}
            </span>

            {data.assignee && (
              <span className="bg-surface-variant text-on-surface-variant inline-flex items-center rounded-full px-2 py-0.5 text-xs">
                {data.assignee}
              </span>
            )}
          </div>

          {data.deadline && (
            <p className="text-on-surface-variant mt-1.5 text-xs">
              Due: {new Date(data.deadline).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!border-surface !bg-primary !h-3 !w-3 !border-2"
      />
    </div>
  );
}

export const TaskNode = memo(TaskNodeComponent);
