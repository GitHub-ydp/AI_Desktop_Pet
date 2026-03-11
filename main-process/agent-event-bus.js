const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');

const FINAL_EVENT_TYPES = new Set(['run.completed', 'run.failed', 'run.cancelled']);

class AgentEventBus {
  constructor(store, options = {}) {
    this.store = store;
    this.maxEventsPerRun = options.maxEventsPerRun || 100;
    this.emitter = new EventEmitter();
    this.buffers = new Map();
    this.seqCounters = new Map();
  }

  publish({ sessionId, runId, type, payload = {} }) {
    const nextSeq = this._nextSeq(runId);
    const event = {
      eventId: `evt_${randomUUID()}`,
      sessionId,
      runId,
      seq: nextSeq,
      ts: Date.now(),
      type,
      payload
    };

    this.store.insertEvent(event);
    this._appendToBuffer(event);
    this.emitter.emit('event', event);
    this.emitter.emit(`session:${sessionId}`, event);
    this.emitter.emit(`run:${runId}`, event);
    return event;
  }

  subscribeSession(sessionId, handler) {
    const channel = `session:${sessionId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  subscribeRun(runId, handler) {
    const channel = `run:${runId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }

  replay(runId, afterSeq = 0, limit = this.maxEventsPerRun) {
    const countAfter = this.store.countEventsAfter(runId, afterSeq);
    const events = this.store.getEvents(runId, afterSeq, limit);
    const replayedUntilSeq = events.length > 0 ? events[events.length - 1].seq : afterSeq;
    return {
      events,
      replayedUntilSeq,
      replayTruncated: countAfter > limit
    };
  }

  getLastSeq(runId) {
    if (this.seqCounters.has(runId)) {
      return this.seqCounters.get(runId);
    }
    const lastSeq = this.store.getLastSeq(runId);
    this.seqCounters.set(runId, lastSeq);
    return lastSeq;
  }

  async waitForRunCompletion(runId, timeoutMs = 90000) {
    const existing = this.store.getRun(runId);
    if (existing && this._isFinalStatus(existing.status)) {
      return this._mapCompletedRun(existing);
    }

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;

      const unsubscribe = this.subscribeRun(runId, (event) => {
        if (!FINAL_EVENT_TYPES.has(event.type) || settled) {
          return;
        }
        settled = true;
        if (timer) clearTimeout(timer);
        unsubscribe();
        const run = this.store.getRun(runId);
        resolve(this._mapCompletedRun(run));
      });

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
    });
  }

  _nextSeq(runId) {
    const current = this.getLastSeq(runId);
    const next = current + 1;
    this.seqCounters.set(runId, next);
    return next;
  }

  _appendToBuffer(event) {
    const list = this.buffers.get(event.runId) || [];
    list.push(event);
    if (list.length > this.maxEventsPerRun) {
      list.splice(0, list.length - this.maxEventsPerRun);
    }
    this.buffers.set(event.runId, list);
  }

  _isFinalStatus(status) {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }

  _mapCompletedRun(run) {
    if (!run) {
      return { ok: false, error: 'run_not_found' };
    }
    if (run.status === 'completed') {
      return { ok: true, finalText: run.finalText || '' };
    }

    const events = this.store.getEvents(run.id, 0, this.maxEventsPerRun);
    const finalEvent = [...events].reverse().find((event) =>
      event.type === 'run.failed' || event.type === 'run.cancelled'
    );

    return {
      ok: false,
      error: run.errorCode || run.status || 'run_failed',
      message: finalEvent?.payload?.message || finalEvent?.payload?.reason || ''
    };
  }
}

module.exports = AgentEventBus;
