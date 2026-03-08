const http = require('http');
const { randomBytes } = require('crypto');
const { writeFileSync } = require('fs');

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

class AgentHttpServer {
  constructor(options = {}) {
    this.runtime = options.runtime;
    this.channelRegistry = options.channelRegistry;
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 47831;
    this.tokenFilePath = options.tokenFilePath;
    this.server = null;
    this.token = null;
  }

  start() {
    this.token = randomBytes(24).toString('hex');
    if (this.tokenFilePath) {
      writeFileSync(this.tokenFilePath, `${this.token}\n`, 'utf-8');
    }

    this.server = http.createServer(async (request, response) => {
      try {
        if (!this._isLocalRequest(request)) {
          sendJson(response, 403, { error: 'forbidden' });
          return;
        }

        if (!this._isAllowedOrigin(request)) {
          sendJson(response, 403, { error: 'invalid_origin' });
          return;
        }

        if (!this._isAuthorized(request)) {
          sendJson(response, 401, { error: 'unauthorized' });
          return;
        }

        await this._handleRequest(request, response);
      } catch (error) {
        const status = error.message === 'invalid_json' ? 400 : 500;
        sendJson(response, status, { error: error.message });
      }
    });

    this.server.listen(this.port, this.host, () => {
      console.log(`[AgentHttpServer] listening on http://${this.host}:${this.port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  _isLocalRequest(request) {
    const address = request.socket && request.socket.remoteAddress;
    return LOCAL_ADDRESSES.has(address);
  }

  _isAllowedOrigin(request) {
    const origin = request.headers.origin;
    return !origin || origin === 'null';
  }

  _isAuthorized(request) {
    const header = request.headers.authorization || '';
    return header === `Bearer ${this.token}`;
  }

  async _handleRequest(request, response) {
    const url = new URL(request.url, `http://${this.host}:${this.port}`);
    const pathname = url.pathname;

    if (request.method === 'POST' && pathname === '/sessions') {
      const body = await readBody(request);
      const session = this.runtime.startSession({
        channel: 'http-api',
        metadata: body.metadata || {}
      });
      sendJson(response, 200, { sessionId: session.id });
      return;
    }

    const sessionMessageMatch = pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (request.method === 'POST' && sessionMessageMatch) {
      const body = await readBody(request);
      const result = await this.runtime.send({
        sessionId: decodeURIComponent(sessionMessageMatch[1]),
        text: body.text || '',
        attachments: body.attachments || null,
        source: 'http-api'
      });
      sendJson(response, 200, result);
      return;
    }

    const sessionEventsMatch = pathname.match(/^\/sessions\/([^/]+)\/events$/);
    if (request.method === 'GET' && sessionEventsMatch) {
      const sessionId = decodeURIComponent(sessionEventsMatch[1]);
      const requestedRunId = url.searchParams.get('runId');
      const state = this.runtime.getState({ sessionId, runId: requestedRunId || null });
      const resolvedRunId = requestedRunId || state?.activeRun?.id || null;
      const afterSeq = Number(url.searchParams.get('afterSeq') || 0);
      this.channelRegistry.attachSSE(response, {
        sessionId,
        runId: resolvedRunId,
        afterSeq
      });
      return;
    }

    const approvalMatch = pathname.match(/^\/runs\/([^/]+)\/approvals\/([^/]+)$/);
    if (request.method === 'POST' && approvalMatch) {
      const body = await readBody(request);
      const result = await this.runtime.approve({
        runId: decodeURIComponent(approvalMatch[1]),
        approvalId: decodeURIComponent(approvalMatch[2]),
        approved: !!body.approved
      });
      sendJson(response, 200, result);
      return;
    }

    const cancelMatch = pathname.match(/^\/runs\/([^/]+)\/cancel$/);
    if (request.method === 'POST' && cancelMatch) {
      const result = await this.runtime.cancel({
        runId: decodeURIComponent(cancelMatch[1])
      });
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { error: 'not_found' });
  }
}

module.exports = AgentHttpServer;
