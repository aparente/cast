import { Database } from 'bun:sqlite';
import type { ClaudeSession, SessionStatus, TerminalContext, TerminalType, AggregatedStatus, TodoItem, AttentionType } from './types.js';
import { STATUS_PRIORITY } from './types.js';

const DB_PATH = `${process.env.HOME}/.cast.db`;

/**
 * Initialize SQLite database with migrations
 */
function initDb(): Database {
  const db = new Database(DB_PATH);

  // Initial schema
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      project_path TEXT,
      current_task TEXT,
      pending_message TEXT,
      last_activity INTEGER NOT NULL,
      alerting INTEGER NOT NULL DEFAULT 0,
      terminal_type TEXT DEFAULT 'unknown',
      terminal_id TEXT DEFAULT '',
      shell_pid INTEGER,
      tty_path TEXT
    )
  `);

  // Migration: add parent_id for subagent hierarchy
  try {
    db.run(`ALTER TABLE sessions ADD COLUMN parent_id TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Index for efficient child queries
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_parent_id ON sessions(parent_id)`);
  } catch {
    // Index already exists
  }

  // Migration: add todos JSON column for TodoWrite tracking
  try {
    db.run(`ALTER TABLE sessions ADD COLUMN todos TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: add last_status for transcript-parsed status
  try {
    db.run(`ALTER TABLE sessions ADD COLUMN last_status TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: add attention_type for critical vs casual detection
  try {
    db.run(`ALTER TABLE sessions ADD COLUMN attention_type TEXT`);
  } catch {
    // Column already exists, ignore
  }

  return db;
}

/**
 * Session store with SQLite persistence.
 * Sessions survive dashboard restarts.
 */
class SessionStore {
  private db: Database;
  private listeners: Set<() => void> = new Set();
  private cache: Map<string, ClaudeSession> = new Map();

  constructor() {
    this.db = initDb();
    this.loadFromDb();
    // Clean up any stale sessions on startup
    const cleaned = this.cleanupStaleSessions();
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} stale session(s)`);
    }
    // Also prune old completed sessions (>30 min) and very old sessions (>2 hr)
    const pruned = this.pruneOldSessions();
    if (pruned > 0) {
      console.log(`Removed ${pruned} old session(s)`);
    }
  }

  private loadFromDb() {
    const rows = this.db.query('SELECT * FROM sessions').all() as any[];
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.id, this.rowToSession(row));
    }
  }

  private rowToSession(row: any): ClaudeSession {
    // Parse todos JSON if present
    let todos: TodoItem[] | undefined;
    if (row.todos) {
      try {
        todos = JSON.parse(row.todos);
      } catch {
        todos = undefined;
      }
    }

    return {
      id: row.id,
      name: row.name,
      status: row.status as SessionStatus,
      projectPath: row.project_path || undefined,
      currentTask: row.current_task || undefined,
      pendingMessage: row.pending_message || undefined,
      lastActivity: new Date(row.last_activity),
      alerting: Boolean(row.alerting),
      terminal: {
        type: (row.terminal_type || 'unknown') as TerminalType,
        id: row.terminal_id || '',
        shellPid: row.shell_pid || undefined,
        ttyPath: row.tty_path || undefined,
      },
      parentId: row.parent_id || undefined,
      todos,
      lastStatus: row.last_status || undefined,
      attentionType: (row.attention_type as AttentionType) || null,
    };
  }

  /**
   * Register or update a session
   */
  upsert(sessionId: string, updates: Partial<ClaudeSession>): ClaudeSession {
    const existing = this.cache.get(sessionId);

    const terminal: TerminalContext = {
      type: updates.terminal?.type || existing?.terminal?.type || 'unknown',
      id: updates.terminal?.id || existing?.terminal?.id || '',
      shellPid: updates.terminal?.shellPid || existing?.terminal?.shellPid,
      ttyPath: updates.terminal?.ttyPath || existing?.terminal?.ttyPath,
    };

    const session: ClaudeSession = {
      id: sessionId,
      name: updates.name || existing?.name || sessionId.slice(0, 8),
      status: updates.status || existing?.status || 'idle',
      projectPath: updates.projectPath || existing?.projectPath,
      currentTask: updates.currentTask ?? existing?.currentTask,
      pendingMessage: updates.pendingMessage ?? existing?.pendingMessage,
      lastActivity: new Date(),
      alerting: updates.alerting ?? existing?.alerting ?? false,
      attentionType: updates.attentionType ?? existing?.attentionType ?? null,
      terminal,
      parentId: updates.parentId ?? existing?.parentId,
      todos: updates.todos ?? existing?.todos,
      lastStatus: updates.lastStatus ?? existing?.lastStatus,
    };

    // Persist to SQLite
    this.db.run(`
      INSERT OR REPLACE INTO sessions
      (id, name, status, project_path, current_task, pending_message, last_activity, alerting, terminal_type, terminal_id, shell_pid, tty_path, parent_id, todos, last_status, attention_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      session.id,
      session.name,
      session.status,
      session.projectPath || null,
      session.currentTask || null,
      session.pendingMessage || null,
      session.lastActivity.getTime(),
      session.alerting ? 1 : 0,
      session.terminal.type,
      session.terminal.id,
      session.terminal.shellPid || null,
      session.terminal.ttyPath || null,
      session.parentId || null,
      session.todos ? JSON.stringify(session.todos) : null,
      session.lastStatus || null,
      session.attentionType || null,
    ]);

    this.cache.set(sessionId, session);
    this.notifyListeners();
    return session;
  }

  /**
   * Remove a session
   */
  remove(sessionId: string): boolean {
    this.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    const deleted = this.cache.delete(sessionId);
    if (deleted) this.notifyListeners();
    return deleted;
  }

  /**
   * Get a session by ID
   */
  get(sessionId: string): ClaudeSession | undefined {
    return this.cache.get(sessionId);
  }

  /**
   * Get all sessions
   */
  all(): ClaudeSession[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get sessions sorted by urgency
   */
  sorted(): ClaudeSession[] {
    return this.all().sort((a, b) => {
      if (a.alerting && !b.alerting) return -1;
      if (!a.alerting && b.alerting) return 1;
      const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      if (statusDiff !== 0) return statusDiff;
      return b.lastActivity.getTime() - a.lastActivity.getTime();
    });
  }

  /**
   * Subscribe to store changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Get count of sessions needing attention
   */
  alertingCount(): number {
    return this.all().filter(s => s.alerting).length;
  }

  /**
   * Clear pending message for a session
   */
  clearPending(sessionId: string): void {
    const session = this.cache.get(sessionId);
    if (session) {
      this.upsert(sessionId, {
        pendingMessage: undefined,
        alerting: false,
        attentionType: null,
        status: 'working',
      });
    }
  }

  /**
   * Check if a process is still running
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // Signal 0 = check existence without killing
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove sessions whose shell process is no longer running.
   * Also marks sessions without PIDs as stale if inactive for 2+ hours.
   * Returns the number of cleaned up sessions.
   */
  cleanupStaleSessions(): number {
    const sessions = this.all();
    let cleaned = 0;
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);

    for (const session of sessions) {
      // Skip if session is already completed
      if (session.status === 'completed') {
        continue;
      }

      // If we have a PID, check if it's still alive
      if (session.terminal.shellPid) {
        if (!this.isProcessAlive(session.terminal.shellPid)) {
          this.upsert(session.id, { status: 'completed', alerting: false, attentionType: null });
          cleaned++;
        }
      } else {
        // No PID - mark as stale if inactive for 2+ hours
        if (session.lastActivity.getTime() < twoHoursAgo) {
          this.upsert(session.id, { status: 'completed', alerting: false, attentionType: null });
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      this.notifyListeners();
    }

    return cleaned;
  }

  /**
   * Prune stale sessions (older than given minutes)
   */
  pruneStale(olderThanMinutes: number = 60): number {
    const cutoff = Date.now() - (olderThanMinutes * 60 * 1000);
    const stale = this.all().filter(s => s.lastActivity.getTime() < cutoff);
    for (const session of stale) {
      this.remove(session.id);
    }
    return stale.length;
  }

  /**
   * Prune old sessions on startup:
   * - Completed sessions older than 30 minutes
   * - Any session older than 2 hours (regardless of status)
   */
  pruneOldSessions(): number {
    const thirtyMinAgo = Date.now() - (30 * 60 * 1000);
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);

    const toRemove = this.all().filter(s => {
      // Remove any session older than 2 hours
      if (s.lastActivity.getTime() < twoHoursAgo) return true;
      // Remove completed sessions older than 30 minutes
      if (s.status === 'completed' && s.lastActivity.getTime() < thirtyMinAgo) return true;
      return false;
    });

    for (const session of toRemove) {
      this.remove(session.id);
    }
    return toRemove.length;
  }

  // ─────────────────────────────────────────────────────────────
  // SUBAGENT HIERARCHY METHODS
  // ─────────────────────────────────────────────────────────────

  /**
   * Get children of a session (subagents)
   */
  getChildren(parentId: string): ClaudeSession[] {
    return this.all().filter(s => s.parentId === parentId);
  }

  /**
   * Get root sessions (sessions without parents)
   */
  getRootSessions(): ClaudeSession[] {
    return this.all().filter(s => !s.parentId);
  }

  /**
   * Get aggregated status for a session including its children
   * Used for status bubbling - if any child needs input, parent shows it
   */
  getAggregatedStatus(sessionId: string): AggregatedStatus {
    const session = this.cache.get(sessionId);
    if (!session) {
      return { status: 'idle', alerting: false, childCount: 0, alertingChildCount: 0 };
    }

    const children = this.getChildren(sessionId);
    const alertingChildren = children.filter(c => c.alerting || this.getAggregatedStatus(c.id).alerting);

    // Find highest priority status among session and all descendants
    let highestStatus = session.status;
    for (const child of children) {
      const childAgg = this.getAggregatedStatus(child.id);
      if (STATUS_PRIORITY[childAgg.status] < STATUS_PRIORITY[highestStatus]) {
        highestStatus = childAgg.status;
      }
    }

    return {
      status: highestStatus,
      alerting: session.alerting || alertingChildren.length > 0,
      childCount: children.length,
      alertingChildCount: alertingChildren.length,
    };
  }

  /**
   * Get all descendants (children, grandchildren, etc.)
   */
  getDescendants(sessionId: string): ClaudeSession[] {
    const children = this.getChildren(sessionId);
    const descendants: ClaudeSession[] = [...children];
    for (const child of children) {
      descendants.push(...this.getDescendants(child.id));
    }
    return descendants;
  }

  /**
   * Get sessions sorted for tree display (roots first, sorted by urgency)
   */
  sortedRoots(): ClaudeSession[] {
    return this.getRootSessions().sort((a, b) => {
      const aggA = this.getAggregatedStatus(a.id);
      const aggB = this.getAggregatedStatus(b.id);

      if (aggA.alerting && !aggB.alerting) return -1;
      if (!aggA.alerting && aggB.alerting) return 1;

      const statusDiff = STATUS_PRIORITY[aggA.status] - STATUS_PRIORITY[aggB.status];
      if (statusDiff !== 0) return statusDiff;

      return b.lastActivity.getTime() - a.lastActivity.getTime();
    });
  }
}

// Singleton instance
export const sessionStore = new SessionStore();
