import { runConfirmedCreateCallback } from '@/components/create-object/create-object-completion';

/** Share the named-work completion path without changing callback order or draft continuation. */
export function completeNamedWork<T>(options: {
  created: T;
  continueCreating: boolean;
  hosted: ((created: T, continueCreating: boolean) => void) | undefined;
  onCreated: (created: T) => void;
  onClose: () => void;
  continueWith: (reset: () => void) => void;
  reset: () => void;
}): void {
  if (options.hosted) options.hosted(options.created, options.continueCreating);
  else
    runConfirmedCreateCallback(() => {
      options.onCreated(options.created);
    });
  if (options.continueCreating) options.continueWith(options.reset);
  else options.onClose();
}
