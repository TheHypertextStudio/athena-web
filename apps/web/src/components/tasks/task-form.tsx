'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CreateTaskInput, Task } from '@/lib/api-client';

interface TaskFormProps {
  initialData?: Partial<Task>;
  onSubmit: (data: CreateTaskInput) => void;
  isSubmitting?: boolean;
  onCancel?: () => void;
}

export function TaskForm({ initialData, onSubmit, isSubmitting, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(initialData?.title ?? '');
  const [description, setDescription] = useState(initialData?.description ?? '');
  const [status, setStatus] = useState<Task['status']>(initialData?.status ?? 'pending');
  const [priority, setPriority] = useState<Task['priority']>(initialData?.priority ?? 'medium');
  const [deadline, setDeadline] = useState(
    initialData?.deadline ? new Date(initialData.deadline).toISOString().slice(0, 16) : '',
  );
  const [estimatedMinutes, setEstimatedMinutes] = useState(
    initialData?.estimatedMinutes?.toString() ?? '',
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const data: CreateTaskInput = {
      title,
      description: description ? description : undefined,
      status,
      priority,
      deadline: deadline ? new Date(deadline).toISOString() : undefined,
      estimatedMinutes: estimatedMinutes ? parseInt(estimatedMinutes, 10) : undefined,
    };

    onSubmit(data);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialData ? 'Edit Task' : 'Create New Task'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="title" className="text-sm font-medium">
              Title <span className="text-destructive">*</span>
            </label>
            <input
              id="title"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              placeholder="Enter task title"
              required
              className="bg-background border-input placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="description" className="text-sm font-medium">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              placeholder="Enter task description"
              rows={4}
              className="bg-background border-input placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="status" className="text-sm font-medium">
                Status
              </label>
              <select
                id="status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as Task['status']);
                }}
                className="bg-background border-input focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1"
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="priority" className="text-sm font-medium">
                Priority
              </label>
              <select
                id="priority"
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value as Task['priority']);
                }}
                className="bg-background border-input focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="deadline" className="text-sm font-medium">
                Deadline
              </label>
              <input
                id="deadline"
                type="datetime-local"
                value={deadline}
                onChange={(e) => {
                  setDeadline(e.target.value);
                }}
                className="bg-background border-input focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="estimatedMinutes" className="text-sm font-medium">
                Estimated Time (minutes)
              </label>
              <input
                id="estimatedMinutes"
                type="number"
                min="0"
                value={estimatedMinutes}
                onChange={(e) => {
                  setEstimatedMinutes(e.target.value);
                }}
                placeholder="e.g., 60"
                className="bg-background border-input placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            {onCancel && (
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={Boolean(isSubmitting) || !title.trim()}>
              {isSubmitting ? 'Saving...' : initialData ? 'Update Task' : 'Create Task'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
