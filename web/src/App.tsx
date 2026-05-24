// Placeholder shell. Demos the visual identity (accent + palette + fonts)
// so the rebrand can be eyeballed before any real surface ships.
// Replaced wholesale when Plan C lands the search route.

const swatches = [
  { name: 'bg.primary', value: 'var(--scry-bg-primary)', text: 'var(--scry-text-primary)' },
  { name: 'bg.secondary', value: 'var(--scry-bg-secondary)', text: 'var(--scry-text-primary)' },
  { name: 'bg.elevated', value: 'var(--scry-bg-elevated)', text: 'var(--scry-text-primary)' },
  { name: 'accent', value: 'var(--scry-accent)', text: 'var(--scry-bg-primary)' },
  { name: 'accent.dim', value: 'var(--scry-accent-dim)', text: 'var(--scry-text-primary)' },
  { name: 'success', value: 'var(--scry-success)', text: 'var(--scry-bg-primary)' },
  { name: 'warning', value: 'var(--scry-warning)', text: 'var(--scry-bg-primary)' },
  { name: 'error', value: 'var(--scry-error)', text: 'var(--scry-bg-primary)' },
];

export default function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-8">
      <div className="flex items-center gap-3 mb-2">
        <span className="inline-block w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
        <h1 className="text-5xl font-sans font-semibold tracking-tight text-text-primary">
          <span className="text-accent">s</span>cry
        </h1>
      </div>
      <p className="text-text-secondary mb-12 text-sm">
        foundation ready — features land in subsequent plans
      </p>

      <div className="grid grid-cols-4 gap-2 max-w-2xl w-full mb-8">
        {swatches.map((s) => (
          <div
            key={s.name}
            className="rounded p-3 font-mono text-xs border border-border"
            style={{ background: s.value, color: s.text }}
          >
            {s.name}
          </div>
        ))}
      </div>

      <div className="font-mono text-xs text-text-tertiary">
        <span className="text-accent">{'>'}</span> Inter (sans){'  '}·{'  '}
        <code className="font-mono">JetBrains Mono</code>
      </div>
    </div>
  );
}
