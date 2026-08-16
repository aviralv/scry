import { type JSX } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const navItems = [
  { to: '/settings/llm', label: 'LLM Provider' },
  { to: '/settings/mcps', label: 'MCP Servers' },
  { to: '/settings/registry', label: 'Registry' },
];

export function Settings(): JSX.Element {
  return (
    <div className="flex h-full">
      <nav className="w-48 shrink-0 border-r border-border bg-bg-secondary p-4">
        <h2 className="text-text-primary text-sm font-sans mb-4">Settings</h2>
        <ul className="flex flex-col gap-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }: { isActive: boolean }) =>
                  `block px-3 py-1.5 rounded text-sm ${isActive ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-bg-elevated/50'}`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
