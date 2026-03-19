const express = require('express');
const config = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { rateLimitMiddleware } = require('../middleware/rate-limit');
const { normalizeUsageMetrics, recordChatUsageAsync } = require('../services/usage');

const router = express.Router();

function createEmptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function mergeUsageMetrics(baseUsage, nextUsage) {
  if (!nextUsage || typeof nextUsage !== 'object') {
    return { ...baseUsage };
  }

  const normalized = normalizeUsageMetrics(nextUsage);
  const merged = {
    inputTokens: Math.max(baseUsage.inputTokens, normalized.inputTokens),
    outputTokens: Math.max(baseUsage.outputTokens, normalized.outputTokens),
    totalTokens: Math.max(baseUsage.totalTokens, normalized.totalTokens),
  };

  if (!merged.totalTokens) {
    merged.totalTokens = merged.inputTokens + merged.outputTokens;
  }

  return merged;
}

function extractUsageFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return (
    payload.usage ||
    payload.output?.usage ||
    payload.result?.usage ||
    null
  );
}

function parseSseEvent(rawEvent) {
  const dataLines = rawEvent
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart());

  if (!dataLines.length) {
    return null;
  }

  const data = dataLines.join('\n').trim();
  if (!data || data === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

async function readUpstreamError(upstream) {
  const contentType = upstream.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      return await upstream.json();
    }

    return await upstream.text();
  } catch (error) {
    return null;
  }
}

async function pipeSseResponse(upstream, res) {
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage = createEmptyUsage();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    res.write(Buffer.from(value));
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const event of events) {
      const payload = parseSseEvent(event);
      if (!payload) {
        continue;
      }

      const payloadUsage = extractUsageFromPayload(payload);
      if (payloadUsage) {
        usage = mergeUsageMetrics(usage, payloadUsage);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const payload = parseSseEvent(buffer);
    const payloadUsage = extractUsageFromPayload(payload);
    if (payloadUsage) {
      usage = mergeUsageMetrics(usage, payloadUsage);
    }
  }

  return usage;
}

router.post('/completions', authMiddleware, rateLimitMiddleware, async (req, res) => {
  if (!config.dashscopeApiKey) {
    return res.status(500).json({
      error: {
        code: 'CONFIG_MISSING',
        message: '服务端未配置 DashScope API Key。',
      },
    });
  }

  const { model, messages, stream } = req.body || {};
  if (!model || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: '请求体必须包含 model 和 messages。',
      },
    });
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  req.on('close', () => {
    controller.abort();
  });
  const upstreamSignal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(60000),
  ]);

  try {
    // 服务端保底：强制关闭思考模式，避免响应过慢
    const upstreamBody = { ...req.body };
    if (upstreamBody.enable_thinking === undefined) {
      upstreamBody.enable_thinking = false;
    }

    const upstream = await fetch(config.dashscopeBaseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.dashscopeApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
      signal: upstreamSignal,
    });

    if (!upstream.ok) {
      const details = await readUpstreamError(upstream);
      return res.status(502).json({
        error: {
          code: 'UPSTREAM_ERROR',
          message: '上游 AI 服务返回错误。',
          details,
          upstreamStatus: upstream.status,
        },
      });
    }

    if (stream) {
      res.status(200);
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      );
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const usage = await pipeSseResponse(upstream, res);
      res.end();

      recordChatUsageAsync({
        userId: req.user.id,
        model,
        usage,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
      });

      return;
    }

    const data = await upstream.json();
    const usage = mergeUsageMetrics(createEmptyUsage(), extractUsageFromPayload(data));

    recordChatUsageAsync({
      userId: req.user.id,
      model,
      usage,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    });

    return res.json(data);
  } catch (error) {
    if (error.name === 'AbortError' && req.destroyed) {
      return;
    }

    if (upstreamSignal.aborted && !req.destroyed) {
      return res.status(502).json({
        error: {
          code: 'UPSTREAM_TIMEOUT',
          message: '上游 AI 服务响应超时。',
        },
      });
    }

    console.error('[chat] Proxy request failed:', error);
    return res.status(502).json({
      error: {
        code: 'UPSTREAM_ERROR',
        message: '转发请求到上游 AI 服务失败。',
      },
    });
  }
});

module.exports = router;
