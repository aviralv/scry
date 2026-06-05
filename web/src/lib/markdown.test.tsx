// web/src/lib/markdown.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReactMarkdown from 'react-markdown';
import { splitCitations, createMarkdownComponents } from './markdown.js';

describe('splitCitations', () => {
  it('splits a single citation marker', () => {
    const out = splitCitations('foo [1] bar', 'k');
    expect(out).toHaveLength(3);
    expect(out[0]).toBe('foo ');
    expect(out[2]).toBe(' bar');
  });

  it('returns the input unchanged when no markers are present', () => {
    const out = splitCitations('plain text', 'k');
    expect(out).toEqual(['plain text']);
  });

  it('splits multiple markers in order', () => {
    const out = splitCitations('a [1] b [2] c', 'k');
    expect(out).toHaveLength(5);
    expect(out[0]).toBe('a ');
    expect(out[2]).toBe(' b ');
    expect(out[4]).toBe(' c');
  });

  it('handles consecutive markers with no text between', () => {
    const out = splitCitations('[1][2]', 'k');
    expect(out).toHaveLength(2);
    // Both nodes are React elements (sup), no string parts.
    out.forEach((p) => expect(typeof p).not.toBe('string'));
  });

  it('renders citation sup with hover and click handlers', () => {
    const onHover = vi.fn();
    const onClick = vi.fn();
    render(
      <p>{splitCitations('see [3] now', 'k', onHover, onClick)}</p>,
    );
    const sup = screen.getByText('[3]');
    expect(sup.tagName.toLowerCase()).toBe('sup');
    expect(sup.getAttribute('data-cite')).toBe('3');
    expect(sup.getAttribute('role')).toBe('button');
    expect(sup.getAttribute('tabindex')).toBe('0');
    expect(sup.getAttribute('aria-label')).toBe('Citation 3');
    fireEvent.mouseEnter(sup);
    expect(onHover).toHaveBeenCalledWith(3);
    fireEvent.mouseLeave(sup);
    expect(onHover).toHaveBeenCalledWith(null);
    fireEvent.click(sup);
    expect(onClick).toHaveBeenCalledWith(3);
  });

  it('activates citation on Enter key', () => {
    const onClick = vi.fn();
    render(<p>{splitCitations('cite [4]', 'k', undefined, onClick)}</p>);
    const sup = screen.getByText('[4]');
    fireEvent.keyDown(sup, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledWith(4);
  });

  it('activates citation on Space key', () => {
    const onClick = vi.fn();
    render(<p>{splitCitations('cite [5]', 'k', undefined, onClick)}</p>);
    const sup = screen.getByText('[5]');
    fireEvent.keyDown(sup, { key: ' ' });
    expect(onClick).toHaveBeenCalledWith(5);
  });

  it('does not activate citation on other keys', () => {
    const onClick = vi.fn();
    render(<p>{splitCitations('cite [6]', 'k', undefined, onClick)}</p>);
    const sup = screen.getByText('[6]');
    fireEvent.keyDown(sup, { key: 'a' });
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires hover via focus/blur for keyboard users', () => {
    const onHover = vi.fn();
    render(<p>{splitCitations('cite [9]', 'k', onHover)}</p>);
    const sup = screen.getByText('[9]');
    fireEvent.focus(sup);
    expect(onHover).toHaveBeenCalledWith(9);
    fireEvent.blur(sup);
    expect(onHover).toHaveBeenCalledWith(null);
  });

  it('does not split numbers without brackets', () => {
    const out = splitCitations('result 42 found', 'k');
    expect(out).toEqual(['result 42 found']);
  });
});

describe('createMarkdownComponents — markdown rendering', () => {
  function renderMd(text: string, onHover?: (i: number | null) => void, onClick?: (i: number) => void) {
    const components = createMarkdownComponents(onHover, onClick);
    return render(<ReactMarkdown components={components}>{text}</ReactMarkdown>);
  }

  it('renders bold as <strong>', () => {
    renderMd('this is **bold** text');
    const strong = screen.getByText('bold');
    expect(strong.tagName.toLowerCase()).toBe('strong');
  });

  it('renders unordered lists', () => {
    renderMd('- alpha\n- beta\n- gamma');
    expect(screen.getByText('alpha').closest('li')).toBeInTheDocument();
    expect(screen.getByText('beta').closest('li')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('preserves citations inside paragraph', () => {
    renderMd('the answer is X [4] and also Y');
    const sup = screen.getByText('[4]');
    expect(sup.tagName.toLowerCase()).toBe('sup');
    expect(sup.getAttribute('data-cite')).toBe('4');
  });

  it('preserves citations inside bold', () => {
    renderMd('**Status: Resolved [7]**');
    const sup = screen.getByText('[7]');
    expect(sup.tagName.toLowerCase()).toBe('sup');
    expect(sup.closest('strong')).toBeInTheDocument();
  });

  it('preserves citations inside list items', () => {
    renderMd('- item one [1]\n- item two [2]');
    const sup1 = screen.getByText('[1]');
    const sup2 = screen.getByText('[2]');
    expect(sup1.closest('li')).toBeInTheDocument();
    expect(sup2.closest('li')).toBeInTheDocument();
  });

  it('preserves citations inside headings', () => {
    renderMd('## Background [9]');
    const sup = screen.getByText('[9]');
    expect(sup.closest('h2')).toBeInTheDocument();
  });

  it('citation hover/click handlers fire from inside markdown', () => {
    const onHover = vi.fn();
    const onClick = vi.fn();
    renderMd('see **bold [5] mark** done', onHover, onClick);
    const sup = screen.getByText('[5]');
    fireEvent.click(sup);
    expect(onClick).toHaveBeenCalledWith(5);
  });

  it('renders safe http(s) links', () => {
    renderMd('[example](https://example.com)');
    const a = screen.getByRole('link', { name: /example/ });
    expect(a.getAttribute('href')).toBe('https://example.com/');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer noopener');
  });

  it('announces new-tab links to screen readers', () => {
    renderMd('[example](https://example.com)');
    expect(screen.getByText(/opens in a new tab/i)).toBeInTheDocument();
  });

  it('strips javascript: hrefs but keeps the text', () => {
    renderMd('[click](javascript:alert(1))');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('click')).toBeInTheDocument();
  });

  it('strips data: hrefs but keeps the text', () => {
    renderMd('[evil](data:text/html,<script>alert(1)</script>)');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders bracket notation inside inline code verbatim (no citation)', () => {
    renderMd('use `array[1]` to access the first element');
    const code = screen.getByText('array[1]');
    expect(code.tagName.toLowerCase()).toBe('code');
    // The bracketed text inside code must NOT be a citation sup.
    expect(code.querySelector('sup[data-cite]')).toBeNull();
  });

  it('does not render images', () => {
    renderMd('![alt text](https://example.com/x.png)');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('does not render data: image URLs even via markdown image syntax', () => {
    renderMd('![evil](data:image/svg+xml,<svg onload=alert(1)/>)');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
