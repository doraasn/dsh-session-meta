/**
 * Client half of dsh-session-meta.
 *
 * 注册到「侧栏会话行的悬浮卡」里（sidebar.session.row.hover）：悬浮卡打开时按会话 id
 * 向 Host 取统计，展示创建时间、结束时间、涉及模型与累计 token。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-meta',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** 文案：跟随界面当前语言。 */
    const TEXT = {
      zh: {
        created: '创建',
        ended: '结束',
        models: '模型',
        tokens: 'Token',
        loading: '统计中…',
        failed: '读取失败',
        count: ' 个',
        input: '入',
        output: '出',
        cacheRead: '缓存命中',
        calls: '次调用',
      },
      en: {
        created: 'Created',
        ended: 'Ended',
        models: 'Models',
        tokens: 'Tokens',
        loading: 'Loading…',
        failed: 'Unavailable',
        count: '',
        input: 'in',
        output: 'out',
        cacheRead: 'cache read',
        calls: 'calls',
      },
    };

    /** 行容器：标签 + 值两列。 */
    const ROW_STYLE = {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 8,
      minWidth: 0,
      fontSize: 12,
      lineHeight: '18px',
    };
    const LABEL_STYLE = {
      flex: 'none',
      width: 42,
      color: 'var(--dsw-alias-label-secondary)',
    };
    const VALUE_STYLE = {
      flex: '1 1 auto',
      minWidth: 0,
      color: 'var(--dsw-alias-label-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    };

    /** 两位补零。 */
    const pad = (value) => String(value).padStart(2, '0');

    /** 时间显示：同年 `MM-DD HH:mm`，跨年补年份。 */
    function clockOf(timestamp) {
      const time = Number(timestamp);
      if (!Number.isFinite(time) || time <= 0) return '';
      const date = new Date(time);
      const now = new Date();
      const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
      return date.getFullYear() === now.getFullYear()
        ? `${day} ${clock}`
        : `${date.getFullYear()}-${day} ${clock}`;
    }

    /** token 显示的紧凑写法：1.02B / 12.34M / 12.3k / 842。 */
    function compactTokens(value) {
      const count = Number(value);
      if (!Number.isFinite(count) || count <= 0) return '0';
      if (count >= 1e9) return `${(count / 1e9).toFixed(2)}B`;
      if (count >= 1e6) return `${(count / 1e6).toFixed(2)}M`;
      if (count >= 1e4) return `${(count / 1e3).toFixed(1)}k`;
      return String(Math.round(count));
    }

    /** 千分位，用于 title 悬浮提示里的精确值。 */
    function exactTokens(value) {
      return Math.round(Number(value) || 0).toLocaleString('en-US');
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        /** 当前语言：优先 Client locale 服务，取不到时退回浏览器语言。 */
        const text = () => {
          let active = '';
          try {
            active = String(ctx.get('locale')?.getLocale?.().active || '');
          } catch {
            active = '';
          }
          if (!active) {
            active = typeof navigator === 'undefined' ? '' : String(navigator.language || '');
          }
          return active.toLowerCase().startsWith('zh') ? TEXT.zh : TEXT.en;
        };

        /** 一行「标签 + 值」。 */
        const row = (key, label, value, title) => h(
          'div',
          { key, style: ROW_STYLE },
          h('span', { style: LABEL_STYLE }, label),
          h('span', { style: VALUE_STYLE, title: title || undefined }, value),
        );

        /** 会话悬浮卡里的统计区块。 */
        function SessionMeta(props) {
          const sessionId = props?.sessionId;
          const [state, setState] = React.useState({ status: 'loading' });

          React.useEffect(() => {
            if (!sessionId) return undefined;
            let alive = true;
            const controller = new AbortController();
            setState({ status: 'loading' });
            fetch(`/dsh-session-meta/api/stat?session=${encodeURIComponent(sessionId)}`, {
              cache: 'no-store',
              signal: controller.signal,
            })
              .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
              .then((data) => {
                if (alive) setState({ status: 'ready', data });
              })
              .catch((error) => {
                if (alive && error?.name !== 'AbortError') setState({ status: 'error' });
              });
            return () => {
              alive = false;
              controller.abort();
            };
          }, [sessionId]);

          const labels = text();
          if (!sessionId) return null;

          if (state.status !== 'ready') {
            const message = state.status === 'error' ? labels.failed : labels.loading;
            return h(
              'div',
              {
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  paddingTop: 6,
                  marginTop: 2,
                  borderTop: '1px solid var(--dsw-alias-border-l1)',
                  fontSize: 12,
                  lineHeight: '18px',
                  color: 'var(--dsw-alias-label-secondary)',
                },
              },
              message,
            );
          }

          const data = state.data || {};
          const models = Array.isArray(data.models) ? data.models : [];
          const tokens = data.tokens || {};
          const names = [...new Set(models.map((item) => item.model).filter(Boolean))];
          const shown = names.slice(0, 3).join(labels === TEXT.zh ? '、' : ', ');
          const rest = names.length > 3 ? ` +${names.length - 3}` : '';
          const modelsValue = names.length === 0
            ? '—'
            : `${data.modelCount ?? names.length}${labels.count}${labels.count ? ' · ' : ' '}${shown}${rest}`;
          const modelsTitle = models
            .map((item) => `${item.provider ? `${item.provider}/` : ''}${item.model} × ${item.calls} ${labels.calls}`)
            .join('\n');
          const tokenTitle = `${exactTokens(tokens.total)} = ${labels.input} ${exactTokens(tokens.input)}`
            + ` + ${labels.cacheRead} ${exactTokens(tokens.cacheRead)}`
            + ` + ${labels.output} ${exactTokens(tokens.output)}`;

          return h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
                paddingTop: 6,
                marginTop: 2,
                borderTop: '1px solid var(--dsw-alias-border-l1)',
              },
            },
            row('created', labels.created, clockOf(data.createdAt)),
            row('ended', labels.ended, clockOf(data.endedAt)),
            row('models', labels.models, modelsValue, modelsTitle),
            row(
              'tokens',
              labels.tokens,
              compactTokens(tokens.total),
              tokenTitle,
            ),
          );
        }

        ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
          name: 'sidebar.session.row.hover',
          id: 'session-meta',
          order: 20,
        }, SessionMeta));
      },
    };
  },
});
