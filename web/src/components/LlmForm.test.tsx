import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LlmForm } from './LlmForm.js';

vi.mock('../lib/llm.js', () => ({
  testLlm: vi.fn(),
  putLlm: vi.fn(),
}));

describe('LlmForm', () => {

  it('uses provider-specific defaults on initial render', () => {
    render(<LlmForm initialValues={{ provider: 'gemini' }} detectedRefs={['GEMINI_API_KEY']} />);

    expect((screen.getByLabelText(/provider/i) as HTMLSelectElement).value).toBe('gemini');
    expect((screen.getByLabelText(/base url/i) as HTMLInputElement).value).toBe('https://generativelanguage.googleapis.com');
    expect((screen.getByLabelText(/model/i) as HTMLInputElement).value).toBe('gemini-2.0-flash');
    expect((screen.getByLabelText(/auth token/i) as HTMLInputElement).value).toBe('${GEMINI_API_KEY}');
  });
  it('switches provider defaults and detected auth refs', () => {
    render(<LlmForm detectedRefs={['OPENAI_API_KEY', 'GEMINI_API_KEY']} />);

    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'openai' } });
    expect((screen.getByLabelText(/base url/i) as HTMLInputElement).value).toBe('https://api.openai.com');
    expect((screen.getByLabelText(/model/i) as HTMLInputElement).value).toBe('gpt-4o-mini');
    expect((screen.getByLabelText(/auth token/i) as HTMLInputElement).value).toBe('${OPENAI_API_KEY}');

    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'gemini' } });
    expect((screen.getByLabelText(/base url/i) as HTMLInputElement).value).toBe('https://generativelanguage.googleapis.com');
    expect((screen.getByLabelText(/model/i) as HTMLInputElement).value).toBe('gemini-2.0-flash');
    expect((screen.getByLabelText(/auth token/i) as HTMLInputElement).value).toBe('${GEMINI_API_KEY}');
  });

  it('defaults Ollama to local no-auth mode', () => {
    render(<LlmForm />);

    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'ollama' } });

    expect((screen.getByLabelText(/base url/i) as HTMLInputElement).value).toBe('http://localhost:11434');
    expect((screen.getByLabelText(/model/i) as HTMLInputElement).value).toBe('llama3.2');
    expect((screen.getByLabelText(/no auth required/i) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText(/auth token/i)).toBeNull();
  });
});
