import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { McpManager } from './McpManager.js';
import { ApiCallError } from '../lib/api.js';
import * as api from '../lib/mcps.js';

vi.mock('../lib/mcps.js');

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  document.head.innerHTML = '<meta name="scry-csrf" content="test-token">';
});

const renderWithRouter = () =>
  render(
    <MemoryRouter initialEntries={['/mcps']}>
      <Routes>
        <Route path="/mcps" element={<McpManager />} />
        <Route path="/onboarding" element={<div>onboarding page</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('McpManager', () => {
  it('redirects to /onboarding on 412', async () => {
    vi.mocked(api.listMcps).mockRejectedValue(
      new ApiCallError(412, { error: 'config-required' }),
    );
    renderWithRouter();
    await waitFor(() => expect(screen.getByText(/onboarding page/i)).toBeInTheDocument());
  });

  it('renders rows from API', async () => {
    vi.mocked(api.listMcps).mockResolvedValue([
      { name: 'slack', command: 'slack-mcp', enabled: true },
    ]);
    renderWithRouter();
    await waitFor(() => expect(screen.getByText('slack')).toBeInTheDocument());
    expect(screen.getByText('slack-mcp')).toBeInTheDocument();
  });

  it('opens Add modal and creates an MCP', async () => {
    vi.mocked(api.listMcps).mockResolvedValue([]);
    vi.mocked(api.createMcp).mockResolvedValue({ name: 'x', command: 'x', enabled: true });
    renderWithRouter();
    await waitFor(() => expect(screen.getByRole('button', { name: /\+ add mcp/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /\+ add mcp/i }));
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/command/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(api.createMcp).toHaveBeenCalled());
  });

  it('runs Test and updates row status', async () => {
    vi.mocked(api.listMcps).mockResolvedValue([{ name: 'slack', command: 'slack-mcp', enabled: true }]);
    vi.mocked(api.testMcp).mockResolvedValue({ ok: true, toolCount: 5 });
    renderWithRouter();
    await waitFor(() => screen.getByText('slack'));
    fireEvent.click(screen.getByRole('button', { name: /^test$/i }));
    await waitFor(() => expect(screen.getByText(/🟢 OK/)).toBeInTheDocument());
  });

  it('confirms then deletes a row', async () => {
    vi.mocked(api.listMcps).mockResolvedValue([{ name: 'slack', command: 'slack-mcp', enabled: true }]);
    vi.mocked(api.deleteMcp).mockResolvedValue(undefined);
    renderWithRouter();
    await waitFor(() => screen.getByText('slack'));
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(api.deleteMcp).toHaveBeenCalledWith('slack'));
    await waitFor(() => expect(screen.queryByText('slack')).not.toBeInTheDocument());
  });
});
