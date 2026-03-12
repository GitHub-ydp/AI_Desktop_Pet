const { randomUUID } = require('crypto');

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value == null ? null : value);
}

class AgentSessionStore {
  constructor(db) {
    this.db = db;
  }

  initialize() {
    if (!this.db) {
      throw new Error('AgentSessionStore requires an initialized database');
    }
  }

  archiveExpiredSessions(options = {}) {
    const now = Date.now();
    const inactiveMs = (options.inactiveDays || 30) * 24 * 60 * 60 * 1000;
    const cleanupMs = (options.cleanupDays || 90) * 24 * 60 * 60 * 1000;

    this.db.prepare(`
      UPDATE agent_sessions
      SET state = 'archived', archived_at = COALESCE(archived_at, ?)
      WHERE state != 'archived' AND last_active_at < ?
    `).run(now, now - inactiveMs);

    const staleSessions = this.db.prepare(`
      SELECT id FROM agent_sessions
      WHERE state = 'archived' AND archived_at IS NOT NULL AND archived_at < ?
    `).all(now - cleanupMs);

    const cleanup = this.db.transaction((sessionIds) => {
      const deleteApprovals = this.db.prepare(`
        DELETE FROM agent_approvals
        WHERE run_id IN (SELECT id FROM agent_runs WHERE session_id = ?)
      `);
      const deleteEvents = this.db.prepare('DELETE FROM agent_events WHERE session_id = ?');
      const deleteRuns = this.db.prepare('DELETE FROM agent_runs WHERE session_id = ?');
      const deleteSession = this.db.prepare('DELETE FROM agent_sessions WHERE id = ?');

      for (const row of sessionIds) {
        deleteApprovals.run(row.id);
        deleteEvents.run(row.id);
        deleteRuns.run(row.id);
        deleteSession.run(row.id);
      }
    });

    cleanup(staleSessions);
    return staleSessions.length;
  }

  failOpenRunsOnStartup(reason = 'interrupted_on_restart') {
    const now = Date.now();
    return this.db.prepare(`
      UPDATE agent_runs
      SET status = 'failed', error_code = ?, ended_at = COALESCE(ended_at, ?)
      WHERE status IN ('queued', 'running', 'awaiting_approval')
    `).run(reason, now).changes;
  }

  createSession({ channel = 'desktop-chat', metadata = {} } = {}) {
    const id = `session_${randomUUID()}`;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO agent_sessions (
        id, channel, metadata_json, state, last_active_at, archived_at, created_at
      ) VALUES (?, ?, ?, 'active', ?, NULL, ?)
    `).run(id, channel, stringifyJson(metadata), now, now);
    return this.getSession(id);
  }

  getSession(sessionId) {
    const row = this.db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(sessionId);
    return row ? this._mapSession(row) : null;
  }

  touchSession(sessionId, timestamp = Date.now()) {
    this.db.prepare(`
      UPDATE agent_sessions
      SET last_active_at = ?, state = CASE WHEN state = 'archived' THEN state ELSE 'active' END
      WHERE id = ?
    `).run(timestamp, sessionId);
  }

  createRun({ sessionId, sourceText, source = 'desktop-chat', attachments = null, status = 'running', queuePosition = 0 }) {
    const id = `run_${randomUUID()}`;
    const now = Date.now();
    const startedAt = status === 'running' ? now : null;
    this.db.prepare(`
      INSERT INTO agent_runs (
        id, session_id, status, source_text, source, attachments_json,
        final_text, conversation_summary, error_code, queue_position, created_at, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL)
    `).run(id, sessionId, status, sourceText || '', source, stringifyJson(attachments), queuePosition, now, startedAt);
    this.touchSession(sessionId, now);
    return this.getRun(id);
  }

  getRun(runId) {
    const row = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId);
    return row ? this._mapRun(row) : null;
  }

  updateRun(runId, updates = {}) {
    const allowed = {
      status: 'status',
      finalText: 'final_text',
      conversationSummary: 'conversation_summary',
      errorCode: 'error_code',
      queuePosition: 'queue_position',
      startedAt: 'started_at',
      endedAt: 'ended_at'
    };

    const assignments = [];
    const values = [];

    for (const [key, column] of Object.entries(allowed)) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        assignments.push(`${column} = ?`);
        values.push(updates[key]);
      }
    }

    if (assignments.length === 0) {
      return this.getRun(runId);
    }

    values.push(runId);
    this.db.prepare(`
      UPDATE agent_runs
      SET ${assignments.join(', ')}
      WHERE id = ?
    `).run(...values);

    const run = this.getRun(runId);
    if (run) {
      this.touchSession(run.sessionId, Date.now());
    }
    return run;
  }

  getSessionActiveRun(sessionId) {
    const row = this.db.prepare(`
      SELECT * FROM agent_runs
      WHERE session_id = ? AND status IN ('running', 'awaiting_approval')
      ORDER BY created_at ASC
      LIMIT 1
    `).get(sessionId);
    return row ? this._mapRun(row) : null;
  }

  getQueuedRuns(sessionId) {
    const rows = this.db.prepare(`
      SELECT * FROM agent_runs
      WHERE session_id = ? AND status = 'queued'
      ORDER BY queue_position ASC, created_at ASC
    `).all(sessionId);
    return rows.map((row) => this._mapRun(row));
  }

  getLatestCompletedRun(sessionId) {
    const row = this.db.prepare(`
      SELECT * FROM agent_runs
      WHERE session_id = ? AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sessionId);
    return row ? this._mapRun(row) : null;
  }

  getRecentConversationMessages(sessionId, limit = 6) {
    const rows = this.db.prepare(`
      SELECT source_text, final_text
      FROM agent_runs
      WHERE session_id = ? AND status = 'completed'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit);

    return rows.reverse().flatMap((row) => {
      const messages = [];
      if (row.source_text) {
        messages.push({ role: 'user', content: row.source_text });
      }
      if (row.final_text) {
        messages.push({ role: 'assistant', content: row.final_text });
      }
      return messages;
    });
  }

  createApproval({ runId, toolName, summary, args = {}, expiresAt }) {
    const id = `approval_${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO agent_approvals (
        id, run_id, tool_name, summary, args_json, status, expires_at, resolved_at, decision
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL)
    `).run(id, runId, toolName, summary || '', stringifyJson(args), expiresAt || null);
    return this.getApproval(id);
  }

  getApproval(approvalId) {
    const row = this.db.prepare('SELECT * FROM agent_approvals WHERE id = ?').get(approvalId);
    return row ? this._mapApproval(row) : null;
  }

  getPendingApprovalsForSession(sessionId) {
    const rows = this.db.prepare(`
      SELECT a.*
      FROM agent_approvals a
      INNER JOIN agent_runs r ON r.id = a.run_id
      WHERE r.session_id = ? AND a.status = 'pending'
      ORDER BY a.expires_at ASC, a.id ASC
    `).all(sessionId);
    return rows.map((row) => this._mapApproval(row));
  }

  getRecentApprovals(limit = 50) {
    const rows = this.db.prepare(`
      SELECT a.*, r.session_id
      FROM agent_approvals a
      INNER JOIN agent_runs r ON r.id = a.run_id
      ORDER BY COALESCE(a.resolved_at, a.expires_at, r.created_at) DESC, a.id DESC
      LIMIT ?
    `).all(limit);

    return rows.map((row) => ({
      ...this._mapApproval(row),
      sessionId: row.session_id
    }));
  }

  resolveApproval(approvalId, { status, decision = null, resolvedAt = Date.now() }) {
    this.db.prepare(`
      UPDATE agent_approvals
      SET status = ?, decision = ?, resolved_at = ?
      WHERE id = ?
    `).run(status, decision, resolvedAt, approvalId);
    return this.getApproval(approvalId);
  }

  insertEvent(event) {
    this.db.prepare(`
      INSERT INTO agent_events (
        event_id, session_id, run_id, seq, type, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId,
      event.sessionId,
      event.runId,
      event.seq,
      event.type,
      stringifyJson(event.payload),
      event.ts
    );
  }

  getEvents(runId, afterSeq = 0, limit = 100) {
    const rows = this.db.prepare(`
      SELECT * FROM agent_events
      WHERE run_id = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(runId, afterSeq, limit);
    return rows.map((row) => this._mapEvent(row));
  }

  getSessionEvents(sessionId, limit = 100) {
    const rows = this.db.prepare(`
      SELECT * FROM agent_events
      WHERE session_id = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(sessionId, limit);
    return rows.reverse().map((row) => this._mapEvent(row));
  }

  countEventsAfter(runId, afterSeq = 0) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM agent_events
      WHERE run_id = ? AND seq > ?
    `).get(runId, afterSeq);
    return row ? row.count : 0;
  }

  getLastSeq(runId) {
    const row = this.db.prepare(`
      SELECT MAX(seq) AS max_seq
      FROM agent_events
      WHERE run_id = ?
    `).get(runId);
    return row && row.max_seq ? row.max_seq : 0;
  }

  _mapSession(row) {
    return {
      id: row.id,
      channel: row.channel,
      metadata: parseJson(row.metadata_json, {}),
      state: row.state,
      lastActiveAt: row.last_active_at,
      archivedAt: row.archived_at,
      createdAt: row.created_at
    };
  }

  _mapRun(row) {
    return {
      id: row.id,
      sessionId: row.session_id,
      status: row.status,
      sourceText: row.source_text,
      source: row.source,
      attachments: parseJson(row.attachments_json, null),
      finalText: row.final_text,
      conversationSummary: row.conversation_summary || '',
      errorCode: row.error_code,
      queuePosition: row.queue_position,
      createdAt: row.created_at,
      startedAt: row.started_at,
      endedAt: row.ended_at
    };
  }

  _mapApproval(row) {
    return {
      id: row.id,
      runId: row.run_id,
      toolName: row.tool_name,
      summary: row.summary,
      args: parseJson(row.args_json, {}),
      status: row.status,
      expiresAt: row.expires_at,
      resolvedAt: row.resolved_at,
      decision: row.decision
    };
  }

  _mapEvent(row) {
    return {
      eventId: row.event_id,
      sessionId: row.session_id,
      runId: row.run_id,
      seq: row.seq,
      ts: row.created_at,
      type: row.type,
      payload: parseJson(row.payload_json, {})
    };
  }
}

module.exports = AgentSessionStore;
