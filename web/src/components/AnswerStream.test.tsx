// web/src/components/AnswerStream.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnswerStream } from './AnswerStream.js';

describe('AnswerStream', () => {
  it('renders bold and bullets formatted, not raw', () => {
    render(
      <AnswerStream
        text={'**Status:** Resolved\n\n- one\n- two'}
        stripEnumeration={false}
      />,
    );
    expect(screen.getByText('Status:').tagName.toLowerCase()).toBe('strong');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // Should NOT contain literal ** markers in the DOM text.
    expect(document.body.innerHTML).not.toContain('**Status:**');
  });

  it('renders citations inside markdown structure', () => {
    render(
      <AnswerStream
        text={'**Decision [3]** finalized in [7] meeting'}
        stripEnumeration={false}
      />,
    );
    expect(screen.getByText('[3]').closest('strong')).toBeInTheDocument();
    expect(screen.getByText('[7]')).toBeInTheDocument();
  });

  it('fires citation click handler', () => {
    const onClick = vi.fn();
    render(
      <AnswerStream
        text={'see [2] for details'}
        stripEnumeration={false}
        onCiteClick={onClick}
      />,
    );
    fireEvent.click(screen.getByText('[2]'));
    expect(onClick).toHaveBeenCalledWith(2);
  });

  it('strips Sources: enumeration when finalized', () => {
    render(
      <AnswerStream
        text={'Body text with [1].\n\nSources:\n[1] something'}
        stripEnumeration={true}
      />,
    );
    expect(screen.getByText(/Body text with/)).toBeInTheDocument();
    expect(screen.queryByText(/Sources:/)).toBeNull();
  });

  it('keeps Sources: when not finalized', () => {
    render(
      <AnswerStream
        text={'Body [1].\n\nSources:\n[1] something'}
        stripEnumeration={false}
      />,
    );
    expect(screen.getByText(/Sources:/)).toBeInTheDocument();
  });
});
