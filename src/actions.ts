// Outbound actions on a session — all via cmux, all guarded, none throw.

import type { ActionResult, Session, SurfaceRef } from './types';

export interface ActionDeps {
  readScreen: (surface: SurfaceRef) => Promise<string | null>;
  send: (surface: SurfaceRef, text: string) => Promise<{ ok: boolean }>;
  sendKey: (surface: SurfaceRef, key: string) => Promise<{ ok: boolean }>;
  focusTab: (surface: SurfaceRef) => Promise<{ ok: boolean }>;
}

const VIEW_ONLY: ActionResult = { ok: false, reason: 'view-only · not in cmux' };

/**
 * Does the visible screen actually show a prompt awaiting y/n-style input?
 * Tuned against real Claude Code permission dialogs; deliberately broad on
 * phrasing, but it must match SOMETHING — never send keys into a blind tab.
 */
export function screenShowsPrompt(screen: string): boolean {
  return /do you want|allow .+\?|❯\s*1\. yes|\by\/n\b|waiting for your input|permission|approve/i.test(
    screen,
  );
}

async function answer(s: Session, key: 'y' | 'n', deps: ActionDeps): Promise<ActionResult> {
  if (!s.surface?.surface) return VIEW_ONLY;
  const screen = await deps.readScreen(s.surface);
  if (screen === null) return { ok: false, reason: 'could not read screen' };
  if (!screenShowsPrompt(screen)) {
    return { ok: false, reason: 'no visible prompt — already handled? refreshed.' };
  }
  const sent = await deps.sendKey(s.surface, key);
  return sent.ok ? { ok: true } : { ok: false, reason: `send-key failed` };
}

export function approve(s: Session, deps: ActionDeps): Promise<ActionResult> {
  return answer(s, 'y', deps);
}

export function deny(s: Session, deps: ActionDeps): Promise<ActionResult> {
  return answer(s, 'n', deps);
}

export async function message(s: Session, text: string, deps: ActionDeps): Promise<ActionResult> {
  if (!s.surface?.surface) return VIEW_ONLY;
  if (!text.trim()) return { ok: false, reason: 'empty message' };
  const sent = await deps.send(s.surface, text);
  return sent.ok ? { ok: true } : { ok: false, reason: 'send failed' };
}

export async function focus(s: Session, deps: ActionDeps): Promise<ActionResult> {
  if (!s.surface || (!s.surface.tab && !s.surface.surface)) return VIEW_ONLY;
  const r = await deps.focusTab(s.surface);
  return r.ok ? { ok: true } : { ok: false, reason: 'focus failed' };
}
