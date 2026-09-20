/**
 * FTTH-Copilot Design System Tokens
 *
 * Single source of truth for all platform colors, typography, spacing, and
 * semantic roles. Used by:
 *   - apps/web  (Next.js, via CSS custom properties in globals.css)
 *   - apps/capacitor (Capacitor, same CSS tokens)
 *   - apps/tauri (Tauri, same CSS tokens)
 *
 * Brand palette (hex):
 *   --color-bg:       #1a1218  — App shell / deepest background
 *   --color-surface:  #20161e  — Main surfaces, cards, navigation
 *   --color-muted:    #7b4d68  — Secondary text, dividers, inactive
 *   --color-text:     #f6eff3  — Primary text
 *   --color-accent:   #f23077  — Primary actions, focus, active states
 *
 * Usage in React/TypeScript:
 *   import { tokens } from '@ftth-copilot/shared/design-system'
 *   style={{ color: tokens.color.text }}
 *
 * Usage in CSS:
 *   import './design-system.css'
 *   style={{ color: 'var(--color-text)' }}
 */

/* ── Color tokens ─────────────────────────────────── */
export const color = {
  /** Deepest background */
  bg:        '#1a1218',
  /** Surface (cards, sidebar, nav) */
  surface:   '#20161e',
  /** Elevated surface (modals, dropdowns) */
  surfaceElevated: '#2a2028',
  /** Secondary text, dividers, inactive */
  muted:     '#7b4d68',
  /** Primary text */
  text:      '#f6eff3',
  /** Primary actions, focus, active states */
  accent:    '#f23077',
  /** Success (green) */
  success:   '#4ade80',
  /** Warning (amber) */
  warning:   '#fbbf24',
  /** Danger (red) */
  danger:    '#f87171',
  /** Info (accent) */
  info:      '#f23077',
} as const;

export type ColorToken = keyof typeof color;

/* ── Semantic role aliases ─────────────────────────── */
export const semantic = {
  action:      color.accent,
  focus:       color.accent,
  border:      color.muted,
  divider:     color.muted,
  successText: color.success,
  warningText: color.warning,
  dangerText:  color.danger,
} as const;

/* ── Typography ───────────────────────────────────── */
export const font = {
  display: '"Space Grotesk", Inter, system-ui, sans-serif',
  body:    'Inter, system-ui, sans-serif',
  mono:    '"JetBrains Mono", ui-monospace, monospace',
} as const;

/* ── Spacing (8px grid) ───────────────────────────── */
export const space = {
  unit: 8,
  xs:   4,
  sm:   8,
  md:   16,
  lg:   24,
  xl:   32,
  '2xl': 40,
  '3xl': 48,
} as const;

/* ── Border radius ────────────────────────────────── */
export const radius = {
  card:    '16px',
  control: '12px',
  pill:    '999px',
  sm:      '8px',
  md:      '12px',
  lg:      '16px',
} as const;

/* ── Transitions ──────────────────────────────────── */
export const transition = {
  std: '180ms ease',
  fast: '100ms ease',
  slow: '300ms ease',
} as const;

/* ── Shadows ───────────────────────────────────────── */
export const shadow = {
  card:   '0 16px 40px rgb(0 0 0 / 32%)',
  float:  '0 4px 24px rgb(0 0 0 / 28%)',
  glow:   '0 0 20px rgb(242 48 119 / 22%)',
  inset:  '0 1px 0 rgb(246 239 243 / 5%) inset',
} as const;

/* ── Platform detection ───────────────────────────── */
export type Platform = 'web' | 'android' | 'ios' | 'linux' | 'windows' | 'macos';

let _platform: Platform = 'web';

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'web';
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/(iphone|ipad|ipod|ios)/.test(ua)) return 'ios';
  if (/win/.test(ua)) return 'windows';
  if (/mac/.test(ua)) return 'macos';
  if (/linux/.test(ua)) return 'linux';
  return 'web';
}

export function getPlatform(): Platform {
  if (_platform === 'web') _platform = detectPlatform();
  return _platform;
}

export const isMobile = (): boolean =>
  ['android', 'ios'].includes(getPlatform());

export const isDesktop = (): boolean =>
  ['linux', 'windows', 'macos'].includes(getPlatform());

export const isNative = (): boolean =>
  isMobile() || isDesktop();

/* ── Full token object ────────────────────────────── */
export const tokens = {
  color,
  semantic,
  font,
  space,
  radius,
  transition,
  shadow,
} as const;

export type Tokens = typeof tokens;
