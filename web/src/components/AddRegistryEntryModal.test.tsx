import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddRegistryEntryModal } from './AddRegistryEntryModal.js';

describe('AddRegistryEntryModal', () => {
  it('renders fields for a Person', () => {
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/add person/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/key/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it('renders fields for a Project', () => {
    render(<AddRegistryEntryModal group="projects" existingKeys={[]} onConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/add project/i)).toBeInTheDocument();
  });

  it('rejects malformed slug key', () => {
    const onConfirm = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'BAD KEY' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Some Name' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByText(/lowercase|slug|invalid key/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects duplicate key', () => {
    const onConfirm = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={['andre']} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'andre' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Another' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(screen.getByText(/already exists|duplicate/i)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects empty name', () => {
    const onConfirm = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'jens' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('confirms with the typed group on valid submit', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'jens-r' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Jens R' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onConfirm).toHaveBeenCalledWith({ key: 'jens-r', name: 'Jens R' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel closes without confirming', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<AddRegistryEntryModal group="people" existingKeys={[]} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
