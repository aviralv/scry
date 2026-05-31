/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { McpAddModal } from './McpAddModal.js';
import type { McpServerEntry } from '../lib/mcps.js';

beforeEach(() => {
  document.head.innerHTML = '<meta name="scry-csrf" content="test-token">';
});

describe('McpAddModal', () => {
  it('renders empty form for add mode and submits', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<McpAddModal mode="add" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'slack' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'slack-mcp' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ name: 'slack', command: 'slack-mcp', args: undefined, env: undefined, enabled: true });
    });
  });

  it('disables Save and form fields while submitting', async () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => {/* never resolves */}));
    render(<McpAddModal mode="add" onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
      expect(screen.getByLabelText(/name/i)).toBeDisabled();
      expect(screen.getByLabelText(/command/i)).toBeDisabled();
    });
  });

  it('shows error and stays open when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('health-check-failed: timeout'));
    const onClose = vi.fn();
    render(<McpAddModal mode="add" onSubmit={onSubmit} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      expect(screen.getByText(/timeout/i)).toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders pre-filled form for edit mode and disables name field', () => {
    const initial: McpServerEntry = { name: 'slack', command: 'slack-mcp', enabled: true };
    render(<McpAddModal mode="edit" initial={initial} onSubmit={vi.fn()} onClose={() => {}} />);
    expect(screen.getByLabelText(/name/i)).toHaveValue('slack');
    expect(screen.getByLabelText(/name/i)).toBeDisabled();
    expect(screen.getByLabelText(/command/i)).toHaveValue('slack-mcp');
  });

  it('rejects env values that are not env-refs (UI-side check)', async () => {
    const onSubmit = vi.fn();
    render(<McpAddModal mode="add" onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /add env/i }));
    fireEvent.change(screen.getByLabelText(/env key/i), { target: { value: 'TOKEN' } });
    fireEvent.change(screen.getByLabelText(/env value/i), { target: { value: 'literal-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/must be \$\{NAME\}/i)).toBeInTheDocument());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
