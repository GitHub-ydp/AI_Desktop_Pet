const { MessageChannelMain } = require('electron');

function formatSSE(event) {
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

class ChannelRegistry {
  constructor(eventBus, options = {}) {
    this.eventBus = eventBus;
    this.keepAliveMs = options.keepAliveMs || 15000;
    this.summaryListeners = new Set();
  }

  createRendererStream(webContents, options = {}) {
    const { streamId, sessionId, runId = null } = options;
    const afterSeq = Number(options.afterSeq || 0);
    const channel = new MessageChannelMain();
    const port = channel.port1;
    const outgoingPort = channel.port2;

    let replayedUntilSeq = afterSeq;
    let replayTruncated = false;

    if (runId) {
      const replay = this.eventBus.replay(runId, afterSeq);
      replayedUntilSeq = replay.replayedUntilSeq;
      replayTruncated = replay.replayTruncated;
      for (const event of replay.events) {
        port.postMessage(event);
      }
    }

    const unsubscribe = runId
      ? this.eventBus.subscribeRun(runId, (event) => port.postMessage(event))
      : this.eventBus.subscribeSession(sessionId, (event) => port.postMessage(event));

    port.on('close', () => {
      unsubscribe();
    });

    webContents.postMessage('agent:stream-port', { streamId }, [outgoingPort]);

    return {
      streamId,
      replayedUntilSeq,
      replayTruncated
    };
  }

  attachSSE(response, options = {}) {
    const { sessionId, runId = null } = options;
    const afterSeq = Number(options.afterSeq || 0);
    let replayedUntilSeq = afterSeq;
    let replayTruncated = false;

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });

    if (runId) {
      const replay = this.eventBus.replay(runId, afterSeq);
      replayedUntilSeq = replay.replayedUntilSeq;
      replayTruncated = replay.replayTruncated;
      for (const event of replay.events) {
        response.write(formatSSE(event));
      }
    }

    const unsubscribe = runId
      ? this.eventBus.subscribeRun(runId, (event) => response.write(formatSSE(event)))
      : this.eventBus.subscribeSession(sessionId, (event) => response.write(formatSSE(event)));

    const keepAlive = setInterval(() => {
      response.write(': keepalive\n\n');
    }, this.keepAliveMs);

    const cleanup = () => {
      clearInterval(keepAlive);
      unsubscribe();
    };

    response.on('close', cleanup);
    response.on('finish', cleanup);
    response.on('error', cleanup);

    return {
      replayedUntilSeq,
      replayTruncated,
      cleanup
    };
  }

  onSummary(listener) {
    if (typeof listener !== 'function') return () => {};
    this.summaryListeners.add(listener);
    return () => this.summaryListeners.delete(listener);
  }

  emitSummary(event) {
    for (const listener of this.summaryListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ChannelRegistry] summary listener failed:', error);
      }
    }
  }
}

module.exports = ChannelRegistry;
