/**
 * Host half of dsh-session-meta.
 *
 * 侧栏会话悬浮卡要的四个数（创建时间 / 结束时间 / 涉及模型 / 累计 token）都从会话日志
 * 推导：`sessionQuery.readSession` 读一次完整日志，按会话缓存；该会话有新事件写入时
 * 缓存失效，下次 hover 重算。Client 只渲染，不折叠日志。
 */

/** 缓存上限（个会话）：超了淘汰最久未用的一个。 */
const CACHE_LIMIT = 300;
/** 路由前缀：Client 通过它取统计。 */
const ROUTE_PREFIX = '/dsh-session-meta';
/** 统计接口路径。 */
const STAT_PATH = `${ROUTE_PREFIX}/api/stat`;

export const inject = ['webServer'];

/** 取数字，非法值按 0 处理。 */
function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 折叠一份完整会话日志，得到悬浮卡需要的统计。
 *
 * @param {{ session?: object, events?: object[] }} snapshot `sessionQuery.readSession` 的结果
 * @returns 统计对象；`createdAt` 取会话头，`endedAt` 取最后一条事件时间
 */
function summarize(snapshot) {
  const header = snapshot?.session || {};
  const events = Array.isArray(snapshot?.events) ? snapshot.events : [];
  const models = new Map();
  const tokens = {
    input: 0,
    output: 0,
    total: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  };
  let calls = 0;
  let turns = 0;
  let endedAt = num(header.createdAt);

  for (const event of events) {
    const time = num(event?.time);
    if (time > endedAt) endedAt = time;
    if (event?.type === 'turn/end') {
      turns += 1;
      continue;
    }
    if (event?.type !== 'assistant/message') continue;
    calls += 1;

    const source = event.data?.message?.source;
    if (source && source.model) {
      const key = `${source.provider || ''}/${source.model}`;
      const entry = models.get(key) || { provider: source.provider || '', model: source.model, calls: 0 };
      entry.calls += 1;
      models.set(key, entry);
    }

    const usage = event.data?.usage;
    if (usage) {
      const input = num(usage.inputTokens);
      const output = num(usage.outputTokens);
      tokens.input += input;
      tokens.output += output;
      tokens.total += num(usage.totalTokens) || input + output;
      tokens.cacheRead += num(usage.cacheReadTokens);
      tokens.cacheWrite += num(usage.cacheWriteTokens);
      tokens.reasoning += num(usage.reasoningTokens);
    }
  }

  const list = [...models.values()].sort((left, right) => right.calls - left.calls);
  return {
    sessionId: header.id,
    createdAt: num(header.createdAt),
    endedAt,
    models: list,
    modelCount: new Set(list.map((item) => item.model)).size,
    tokens,
    calls,
    turns,
    events: events.length,
  };
}

/** 写一个 JSON 响应。 */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function apply(ctx) {
  /** 已统计过的会话：sessionId -> 统计结果。 */
  const stats = new Map();
  /** 正在读取的会话：同一会话并发 hover 只读一次日志。 */
  const pending = new Map();

  // 会话日志增长后旧统计失效；归档会话没有新事件，缓存一直有效。
  ctx.on('session/event', (session) => {
    stats.delete(session.id);
  });

  /** 取一个会话的统计（带缓存与并发合并）。 */
  const statOf = (query, sessionId) => {
    const cached = stats.get(sessionId);
    if (cached) {
      // 命中后移到末尾，保持「最近使用」顺序。
      stats.delete(sessionId);
      stats.set(sessionId, cached);
      return Promise.resolve(cached);
    }
    const running = pending.get(sessionId);
    if (running) return running;

    const task = query
      .readSession(sessionId)
      .then((snapshot) => {
        const value = summarize(snapshot);
        stats.set(sessionId, value);
        while (stats.size > CACHE_LIMIT) {
          stats.delete(stats.keys().next().value);
        }
        return value;
      })
      .finally(() => pending.delete(sessionId));
    pending.set(sessionId, task);
    return task;
  };

  ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname !== STAT_PATH) {
        sendJson(res, 404, { error: 'not-found' });
        return;
      }
      const sessionId = url.searchParams.get('session') || '';
      if (!/^[A-Za-z0-9._-]{1,128}$/.test(sessionId)) {
        sendJson(res, 400, { error: 'bad-session-id' });
        return;
      }
      const query = ctx.get('sessionQuery');
      if (!query) {
        sendJson(res, 503, { error: 'session-query-unavailable' });
        return;
      }
      try {
        sendJson(res, 200, await statOf(query, sessionId));
      } catch (error) {
        sendJson(res, 404, {
          error: 'unreadable-session',
          message: String(error?.message || error),
        });
      }
    },
  });
}
