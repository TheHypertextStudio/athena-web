'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import FolderIcon from '@mui/icons-material/Folder';
import { cn } from '@/lib/utils';

export interface InitiativeNodeData extends Record<string, unknown> {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  projectCount?: number;
  color?: string;
}

export type InitiativeNodeType = Node<InitiativeNodeData, 'initiative'>;

const statusConfig = {
  draft: { label: 'Draft', className: 'bg-surface-variant text-on-surface-variant' },
  active: { label: 'Active', className: 'bg-primary-container text-on-primary-container' },
  completed: {
    label: 'Completed',
    className: 'bg-secondary-container text-on-secondary-container',
  },
  archived: { label: 'Archived', className: 'bg-surface-variant text-on-surface-variant' },
};

function InitiativeNodeComponent({ data, selected }: NodeProps<InitiativeNodeType>) {
  const statusInfo = statusConfig[data.status];

  return (
    <div
      className={cn(
        'bg-surface-container-low min-w-[220px] rounded-2xl border-2 p-4 shadow-md transition-all',
        selected
          ? 'border-primary ring-primary/20 ring-2'
          : 'border-outline-variant hover:border-outline',
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!border-surface !bg-tertiary !h-3 !w-3 !border-2"
      />

      <div className="flex items-center gap-3">
        <div className="bg-tertiary-container flex h-10 w-10 items-center justify-center rounded-xl">
          <FolderIcon className="text-on-tertiary-container" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-on-surface truncate font-semibold">{data.name}</h3>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                statusInfo.className,
              )}
            >
              {statusInfo.label}
            </span>
            {data.projectCount !== undefined && (
              <span className="text-on-surface-variant text-xs">
                {data.projectCount} project{data.projectCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!border-surface !bg-tertiary !h-3 !w-3 !border-2"
      />
    </div>
  );
}

export const InitiativeNode = memo(InitiativeNodeComponent);
