// web/src/components/StatusPip.tsx
import type { JSX } from 'react';

interface Props {
  tool: string;
}

export function StatusPip({ tool }: Props): JSX.Element {
  // Strip the mcp__<server>__ prefix for readability.
  const display = tool.replace(/^mcp__[^_]+__/, '');
  return (
    <span className="status-pip inline-flex items-center gap-2 text-text-tertiary text-xs font-mono mr-3">
      <span className="text-accent">→</span>
      {display}
    </span>
  );
}
