'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    const stored = localStorage.getItem('theme') as Theme | null;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initial = stored ?? (prefersDark ? 'dark' : 'light');
    setTheme(initial);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    void setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
  }

  if (!mounted) {
    // Render nothing until mounted to avoid hydration mismatch.
    return <div className="h-9 w-9 shrink-0" aria-hidden />;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Cambiar a modo ${theme === 'dark' ? 'claro' : 'oscuro'}`}
      title={`Modo ${theme === 'dark' ? 'claro' : 'oscuro'}`}
      className="btn-ghost shrink-0 h-9 w-9 p-0 rounded-lg"
    >
      {theme === 'dark' ? (
        // Sun icon — switch to light
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden
        >
          <circle cx={12} cy={12} r={4} />
          <line x1={12} y1={2} x2={12} y2={4} />
          <line x1={12} y1={20} x2={12} y2={22} />
          <line x1={4.22} y1={4.22} x2={5.64} y2={5.64} />
          <line x1={18.36} y1={18.36} x2={19.78} y2={19.78} />
          <line x1={2} y1={12} x2={4} y2={12} />
          <line x1={20} y1={12} x2={22} y2={12} />
          <line x1={4.22} y1={19.78} x2={5.64} y2={18.36} />
          <line x1={18.36} y1={5.64} x2={19.78} y2={4.22} />
        </svg>
      ) : (
        // Moon icon — switch to dark
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
          aria-hidden
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
