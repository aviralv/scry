import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Registry } from './Registry.js';
import * as api from '../lib/registry.js';
import { ApiCallError } from '../lib/api.js';

vi.mock('../lib/registry.js');

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  document.head.innerHTML = '<meta name="scry-csrf" content="test-token">';
});

const renderWithRouter = (search = '') =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/registry', search }]}>
      <Registry />
    </MemoryRouter>,
  );

describe('Registry', () => {
  it('shows onboarding stub on 412', async () => {
    vi.mocked(api.getRegistry).mockRejectedValue(
      new ApiCallError(412, { error: 'config-required' }),
    );
    renderWithRouter();
    await waitFor(() => expect(screen.getByText(/onboarding/i)).toBeInTheDocument());
  });

  it('renders People tab by default', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: { ea: { name: 'EA', routing: {} } },
    });
    renderWithRouter();
    await waitFor(() => expect(screen.getByText('Andre')).toBeInTheDocument());
    expect(screen.queryByText('EA')).not.toBeInTheDocument();
  });

  it('switches to Projects tab via URL', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: { ea: { name: 'EA', routing: {} } },
    });
    renderWithRouter('?tab=projects');
    await waitFor(() => expect(screen.getByText('EA')).toBeInTheDocument());
    expect(screen.queryByText('Andre')).not.toBeInTheDocument();
  });

  it('marks a row dirty when its name changes and clears on Save', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    vi.mocked(api.putRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre Christ', identifiers: {} } },
      projects: {},
    });

    renderWithRouter();
    await waitFor(() => screen.getByText('Andre'));
    fireEvent.click(screen.getByLabelText('expand'));
    const nameInput = screen.getByLabelText(/^name$/i);
    fireEvent.change(nameInput, { target: { value: 'Andre Christ' } });

    await waitFor(() => expect(screen.getByLabelText('dirty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(api.putRegistry).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByLabelText('dirty')).not.toBeInTheDocument());
  });

  it('Discard reverts working copy to server snapshot', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    renderWithRouter();
    await waitFor(() => screen.getByText('Andre'));
    fireEvent.click(screen.getByLabelText('expand'));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Changed' } });
    await waitFor(() => expect(screen.getByLabelText('dirty')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    await waitFor(() => expect(screen.queryByLabelText('dirty')).not.toBeInTheDocument());
  });

  it('renders path-scoped errors per row on 400 and auto-expands the row', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    vi.mocked(api.putRegistry).mockRejectedValue(
      new ApiCallError(400, {
        error: 'invalid-body',
        errors: [{ path: ['people', 'andre', 'name'], message: 'Name is required' }],
      }),
    );
    renderWithRouter();
    await waitFor(() => screen.getByText('Andre'));
    fireEvent.click(screen.getByLabelText('expand'));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/name is required/i)).toBeInTheDocument());
    expect(screen.getByText(/validation failed/i)).toBeInTheDocument();
  });

  it('opens add-Person modal and adds a row', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({ people: {}, projects: {} });
    renderWithRouter();
    await waitFor(() => screen.getByRole('button', { name: /add person/i }));
    fireEvent.click(screen.getByRole('button', { name: /add person/i }));
    fireEvent.change(screen.getByLabelText(/key/i), { target: { value: 'jens' } });
    fireEvent.change(screen.getAllByLabelText(/name/i)[0], { target: { value: 'Jens' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(screen.getByText('Jens')).toBeInTheDocument());
    expect(screen.getByLabelText('dirty')).toBeInTheDocument();
  });

  it('confirms then deletes a row from the working copy', async () => {
    vi.mocked(api.getRegistry).mockResolvedValue({
      people: { andre: { name: 'Andre', identifiers: {} } },
      projects: {},
    });
    renderWithRouter();
    await waitFor(() => screen.getByText('Andre'));
    fireEvent.click(screen.getByRole('button', { name: /delete andre/i }));
    await waitFor(() => expect(screen.queryByText('Andre')).not.toBeInTheDocument());
    expect(screen.getByLabelText('dirty')).toBeInTheDocument();
  });
});
