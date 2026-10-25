/** Agent artwork with an explicit glyph fallback instead of an ambiguous client monogram. */
import { ActorAvatar } from '@docket/ui/components';
import { Bot, Sparkles } from '@docket/ui/icons';
import type { JSX } from 'react';

/** Show stored agent artwork when available and retain identity when an image fails. */
export function ActivityAgentAvatar({
  name,
  iconUrl,
  native = false,
  size = 32,
}: {
  readonly name: string;
  readonly iconUrl?: string | null;
  readonly native?: boolean;
  readonly size?: number;
}): JSX.Element {
  const Glyph = native ? Sparkles : Bot;
  return (
    <ActorAvatar
      kind="agent"
      name={name}
      avatarUrl={iconUrl}
      size={size}
      fallback={<Glyph aria-hidden="true" className="size-5" />}
    />
  );
}
