import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChipsInput } from './ChipsInput.js';

describe('ChipsInput', () => {
  it('renders existing chips', () => {
    render(<ChipsInput label="teams" values={['eng', 'pm']} onChange={() => {}} />);
    expect(screen.getByText('eng')).toBeInTheDocument();
    expect(screen.getByText('pm')).toBeInTheDocument();
  });

  it('adds a chip on Enter', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: 'design' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['eng', 'design']);
  });

  it('adds a chip on comma', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: 'eng' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenCalledWith(['eng']);
  });

  it('removes the last chip on Backspace when input is empty', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng', 'pm']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['eng']);
  });

  it('does NOT remove chips on Backspace when input has text', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: 'd' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a chip when its × button is clicked', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng', 'pm']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove eng/i }));
    expect(onChange).toHaveBeenCalledWith(['pm']);
  });

  it('trims whitespace and ignores empty input on Enter', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not add a duplicate chip', () => {
    const onChange = vi.fn();
    render(<ChipsInput label="teams" values={['eng']} onChange={onChange} />);
    const input = screen.getByLabelText(/teams/i);
    fireEvent.change(input, { target: { value: 'eng' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables input and chip-remove buttons when disabled prop is true', () => {
    render(<ChipsInput label="teams" values={['eng']} onChange={() => {}} disabled />);
    expect(screen.getByLabelText(/teams/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /remove eng/i })).toBeDisabled();
  });
});
