'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { cn } from '@/lib/utils';

export interface ProjectNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  deadline?: string | null;
  progress?: number;
  taskCount?: number;
  initiativeId?: string | null;
  color?: string;
}

export type ProjectNodeType = Node<ProjectNodeData, 'project'>;

const statusConfig = {
  planning: { label: 'Planning', className: 'bg-surface-variant text-on-surface-variant' },
  active: { label: 'Active', className: 'bg-primary-container text-on-primary-container' },
  paused: { label: 'Paused', className: 'bg-tertiary-container text-on-tertiary-container' },
  completed: {
    label: 'Completed',
    className: 'bg-secondary-container text-on-secondary-container',
  },
  archived: { label: 'Archived', className: 'bg-surface-variant text-on-surface-variant' },
};

function ProjectNodeComponent({ data, selected }: NodeProps<ProjectNodeType>) {
  const statusInfo = statusConfig[data.status];
  const progress = data.progress ?? 0;

  return (
    <div
      className={cn(
        'bg-surface-container max-w-[280px] min-w-[200px] rounded-xl border p-3 shadow-sm transition-all',
        selected
          ? 'border-primary ring-primary/20 ring-2'
          : 'border-outline-variant hover:border-outline',
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!border-surface !bg-primary !h-3 !w-3 !border-2"
      />

      <div className="flex items-start gap-2">
        <div className="bg-primary-container flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg">
          <AccountTreeIcon className="text-on-primary-container" sx={{ fontSize: 18 }} />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-on-surface truncate text-sm font-medium">{data.name}</h4>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                statusInfo.className,
              )}
            >
              {statusInfo.label}
            </span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-on-surface-variant">Progress</span>
          <span className="text-on-surface font-medium">{progress}%</span>
        </div>
        <div className="bg-surface-variant mt-1 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              progress === 100 ? 'bg-primary' : 'bg-tertiary',
            )}
            style={{ width: `${String(progress)}%` }}
          />
        </div>
      </div>

      {data.deadline && (
        <div className="text-on-surface-variant mt-2 flex items-center gap-1 text-xs">
          <CalendarTodayIcon sx={{ fontSize: 12 }} />
          <span>Due: {new Date(data.deadline).toLocaleDateString()}</span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!border-surface !bg-primary !h-3 !w-3 !border-2"
      />
    </div>
  );
}

export const ProjectNode = memo(ProjectNodeComponent);
