import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchInput } from './SearchInput.js';

describe('SearchInput', () => {
  it('searches all configured sources by default', () => {
    const onSubmit = vi.fn();
    render(<SearchInput onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText(/ask anything/i), {
      target: { value: 'pricing decision' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    expect(onSubmit).toHaveBeenCalledWith('pricing decision', true);
  });

  it('lets the user opt out of all-source search', () => {
    const onSubmit = vi.fn();
    render(<SearchInput onSubmit={onSubmit} />);

    fireEvent.click(screen.getByLabelText(/search all configured sources/i));
    fireEvent.change(screen.getByPlaceholderText(/ask anything/i), {
      target: { value: 'pricing decision' },
    });
    fireEvent.click(screen.getByRole('button', { name: /search/i }));

    expect(onSubmit).toHaveBeenCalledWith('pricing decision', false);
  });
});
