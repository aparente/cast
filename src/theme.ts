// Visual language: quiet monochrome density, one coral accent.
// Color budget — grayscale structure, coral exclusively for needs-you,
// dim cyan for busy spinners. No other color anywhere.

import type { RowStatus } from './types';

export const CORAL = '#ff6b5e';
export const CYAN_DIM = '#4a8a8a';
export const GRAY = 'gray';

export const GLYPH: Record<RowStatus, string> = {
  needs_you: '◐',
  busy: '●',
  idle: '○',
  stale: '◌',
};

export const SPINNER = ['⡿', '⣟', '⣯', '⣷', '⣾', '⣽', '⣻', '⢿'];

export const RULE = '─';
export const TOOL_MARK = '⚒';

/** Compact age: 3s / 12m / 4h / 2d. Floors at 0s. */
export function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Squash any string to a single ellipsized line. */
export function oneLine(text: string, max = 64): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/** ~-abbreviate a home-prefixed path. */
export function tildify(p: string, home = process.env.HOME ?? ''): string {
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}
