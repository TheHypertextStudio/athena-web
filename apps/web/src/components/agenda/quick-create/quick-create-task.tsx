/**
 * Quick task creation form.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, X, Clock } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { tasksApi, type Task } from '@/lib/api-client';
import { agendaKeys } from '@/lib/agenda-api';
import { cn } from '@/lib/utils';

interface QuickCreateTaskProps {
  /** Called when a task is successfully created */
  onCreated?: (task: Task) => void;
  /** Optional date for the task deadline */
  date?: string;
}

/**
 * Inline form for quickly creating new tasks.
 */
export function QuickCreateTask({ onCreated, date }: QuickCreateTaskProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [estimatedMinutes, setEstimatedMinutes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  function handleOpen() {
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    setTitle('');
    setPriority('medium');
    setEstimatedMinutes('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const result = await tasksApi.create({
        title: title.trim(),
        priority,
        estimatedMinutes: estimatedMinutes ? parseInt(estimatedMinutes, 10) : undefined,
        deadline: date,
      });

      // Invalidate agenda queries to refresh the list
      void queryClient.invalidateQueries({ queryKey: agendaKeys.all });

      onCreated?.(result.data);
      handleClose();
    } catch {
      // Could show error toast here
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  if (!isOpen) {
    return (
      <Button
        variant="text"
        size="sm"
        onClick={handleOpen}
        className="text-muted-foreground hover:text-foreground w-full justify-start gap-2"
      >
        <Plus className="h-4 w-4" />
        Add task
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      onKeyDown={handleKeyDown}
      className="bg-card space-y-3 rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          placeholder="Task title..."
          className="flex-1"
          disabled={isSubmitting}
        />
        <Button type="button" variant="text" size="icon" onClick={handleClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={priority}
          onValueChange={(value) => {
            setPriority(value as Task['priority']);
          }}
          disabled={isSubmitting}
        >
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1">
          <Clock className="text-muted-foreground h-4 w-4" />
          <Input
            type="number"
            value={estimatedMinutes}
            onChange={(e) => {
              setEstimatedMinutes(e.target.value);
            }}
            placeholder="min"
            className="w-20"
            min={1}
            max={480}
            disabled={isSubmitting}
          />
        </div>

        <div className="flex-1" />

        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || isSubmitting}
          className={cn(isSubmitting && 'opacity-50')}
        >
          {isSubmitting ? 'Adding...' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
