/**
 * Client half of dsh-session-meta.
 *
 * 注册到「侧栏会话行的悬浮卡」里（sidebar.session.row.hover）：悬浮卡打开时按会话 id
 * 向 Host 取统计，展示创建时间、结束时间、涉及模型与累计 token；模型行与 Token 行
 * 用 kit 的 HoverCard 悬浮出明细。
 *
 * 组件、token、字号全部来自内联的 client-ui kit（v3）；不要在此文件里另写颜色与字号。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-meta',
  factory(require) {
    const React = require('react');
    /** kit 的 HoverCard 用 portal 渲染；拿不到 react-dom 时退化成行内节点。 */
    let createPortal;
    try {
      createPortal = require('react-dom').createPortal;
    } catch {
      createPortal = undefined;
    }

/**
 * DSH 客户端 UI kit v4（2026-11-06，按官方设置页分区头 18/13 对齐）—— 整段粘进 `lib/client.js` 的 factory 里（`const react = require('react')` 之后）。
 *
 * 为什么是"粘贴"而不是 import：插件的浏览器 bundle 由宿主按单文件 `/plugins/<id>/client.js`
 * 提供，没有打包器，`import './ui.js'` 在浏览器里跑不起来。所以公用组件以「可粘贴的片段」分发。
 *
 *   const ui = createUi(react, require('react-dom').createPortal)
 *   const { h, Card, StatusDot, Switch, TextField, Button, Section, SettingsCard, SettingRow,
 *           createStore, useStore, usePoll, placeNear, HoverCard, T, TYPE } = ui
 *
 * 约定：所有颜色/圆角走 DSH token；所有字号走 TYPE 里的档位（小字行高固定 13px，
 * 否则 baseline 行盒会被撑高，同排卡片高度就会差 3px）。
 */
function createUi(react, createPortal) {
  const h = react.createElement
  const { useState, useEffect, useCallback, useRef } = react

  /* ---------- token 与字号 ---------- */
  const T = {
    text1: 'var(--dsw-alias-label-primary)',
    text2: 'var(--dsw-alias-label-secondary)',
    text3: 'var(--dsw-alias-label-tertiary, #8b929c)',
    line: 'var(--dsw-alias-border-l3)',
    cardFill: 'var(--dsw-alias-settings-card-fill, #2c2c2e)',
    cardStroke: 'var(--dsw-alias-settings-card-stroke, #ffffff26)',
    inputFill: 'var(--dsw-alias-bg-layer-1, #1b1b1c)',
    accent: 'var(--dsw-alias-button-primary-fill, #f9fafb)',
    accentText: 'var(--dsw-alias-label-primary-foreground, #0f1115)',
    radiusMd: 'var(--dsw-radius-md, 12px)',
    radiusXl: 'var(--dsw-radius-xl, 20px)',
  }
  const CARD_BG = 'color-mix(in srgb, currentColor 6%, transparent)'
  const TYPE = {
    /* 官方设置页分区头：标题 18/600，说明 13 弱色（宿主 PluginsSettingsSection.css） */
    h1: { fontSize: 18, fontWeight: 600, lineHeight: '26px', color: T.text1 },
    h2: { fontSize: 15, fontWeight: 600, lineHeight: '20px', color: T.text1 },
    body: { fontSize: 13, lineHeight: '20px', color: T.text1 },
    secondary: { fontSize: 13, lineHeight: '20px', color: T.text2 },
    intro: { fontSize: 13, lineHeight: '20px', color: T.text3 },
    small: { fontSize: 12, lineHeight: '18px', color: T.text2 },
    micro: { fontSize: 11, lineHeight: '14px', color: T.text2 },
    num: { fontSize: 15, fontWeight: 600, lineHeight: '20px', color: T.text1, fontVariantNumeric: 'tabular-nums' },
    ellipsis: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }

  /* ---------- 纯函数 ---------- */
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max))

  /** 浮层定位：优先右侧，放不下翻左；上下夹在视口内。pure，便于脱离 DOM 测试。 */
  function placeNear(rect, options = {}) {
    const width = options.width ?? 248
    const height = options.height ?? 120
    const gap = options.gap ?? 8
    const vw = options.viewport?.width ?? (typeof window === 'undefined' ? 1280 : window.innerWidth)
    const vh = options.viewport?.height ?? (typeof window === 'undefined' ? 800 : window.innerHeight)
    let side = 'right'
    let left = rect.right + gap
    if (left + width > vw - gap) {
      side = 'left'
      left = rect.left - gap - width
    }
    return {
      side,
      left: clamp(left, gap, Math.max(gap, vw - width - gap)),
      top: clamp(rect.top, gap, Math.max(gap, vh - height - gap)),
    }
  }

  const formatBytes = (bytes) => {
    const n = Number(bytes) || 0
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB'
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
  }

  /* ---------- 本地状态：模块级 store + hook ---------- */
  /** 按设备持久化；只存差异值也安全（读取时与默认值合并）。 */
  function createStore(key, defaults = {}) {
    const read = () => {
      try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }
      } catch {
        return { ...defaults }
      }
    }
    const store = {
      key,
      value: read(),
      listeners: new Set(),
      set(next) {
        store.value = typeof next === 'function' ? next(store.value) : next
        try { localStorage.setItem(key, JSON.stringify(store.value)) } catch {}
        for (const listener of store.listeners) listener(store.value)
      },
      patch(part) { store.set({ ...store.value, ...part }) },
      subscribe(listener) {
        store.listeners.add(listener)
        return () => { store.listeners.delete(listener) }
      },
    }
    return store
  }

  function useStore(store) {
    const [value, setValue] = useState(store.value)
    useEffect(() => store.subscribe(setValue), [store])
    return value
  }

  /** 轮询 + 失败保留上一帧（不要闪成空）。返回 [data, error, refresh]。 */
  function usePoll(task, intervalMs, deps = []) {
    const [state, setState] = useState({ data: null, error: false })
    const run = useCallback(async () => {
      try {
        const data = await task()
        setState({ data, error: false })
      } catch {
        setState((prev) => ({ data: prev.data, error: true }))
      }
    }, deps)
    useEffect(() => {
      run()
      const timer = setInterval(run, intervalMs)
      return () => clearInterval(timer)
    }, [run, intervalMs])
    return [state.data, state.error, run]
  }

  /* ---------- 侧栏卡片 ---------- */
  const StatusDot = ({ color, size = 6, offset = 1.5 }) => h('span', {
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      backgroundColor: color || T.text3,
      flex: '0 0 auto',
      alignSelf: 'center',
      transform: `translateY(${offset}px)`,
    },
  })

  /** 侧栏卡片：一行，圆点 + 名称 + 右侧数字。左右两组用同一 baseline。 */
  const Card = ({ children, style, ...rest }) => h('div', {
    ...rest,
    style: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 6,
      padding: '2px 12px 5px',
      borderRadius: T.radiusMd,
      background: CARD_BG,
      minWidth: 0,
      overflow: 'hidden',
      ...style,
    },
  }, children)

  /** 侧栏卡片容器：竖排 + 3px 间距 + 左右 2px 内缩（与 newSession 对齐）。 */
  const CardStack = ({ children }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 3, padding: '0 2px 2px', minWidth: 0 },
  }, children)

  const CardName = ({ children }) => h('span', { style: { ...TYPE.h2, fontSize: 12, flex: '1 1 auto', ...TYPE.ellipsis } }, children)
  const CardValue = ({ children }) => h('span', {
    style: { display: 'flex', alignItems: 'baseline', gap: 4, flex: '0 0 auto', ...TYPE.num },
  }, children)

  /* ---------- 设置页 ---------- */
  /* 官方分区结构：flex column gap 12，h2 标题 + p 说明（说明 13 弱色），下面才是内容 */
  const Section = ({ title, description, children }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640, minWidth: 0 },
  },
  h('h2', { style: { margin: 0, ...TYPE.h1 } }, title),
  description ? h('p', { style: { margin: 0, ...TYPE.intro } }, description) : null,
  children)

  /** 设置卡片：官方那种 20px 圆角、深色填充、细描边。 */
  const SettingsCard = ({ children, style }) => h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
      padding: '14px 16px',
      borderRadius: T.radiusXl,
      border: `.5px solid ${T.cardStroke}`,
      background: T.cardFill,
      minWidth: 0,
      ...style,
    },
  }, children)

  /** 左标签 + 右控件的一行。副标签行高与 TYPE.micro 对齐（11/14），复用行高就不会差 2px。 */
  const SettingRow = ({ label, hint, children }) => h('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 },
  },
  h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
    h('span', { style: TYPE.body }, label),
    hint ? h('span', { style: { ...TYPE.micro, ...TYPE.ellipsis } }, hint) : null),
  children)

  /** 药丸开关：36×20，白色底 + 深色旋钮，与官方设置页一致。 */
  const Switch = ({ checked, onChange, title, disabled = false }) => h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': checked,
    disabled,
    onClick: onChange,
    title,
    style: {
      boxSizing: 'border-box',
      position: 'relative',
      flex: '0 0 auto',
      width: 36,
      height: 20,
      padding: 2,
      border: 0,
      borderRadius: 999,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: checked ? 'flex-end' : 'flex-start',
      transition: 'background-color .12s ease',
      backgroundColor: checked ? T.accent : 'var(--dsw-alias-border-l3, #4a4a4d)',
    },
  }, h('span', {
    style: {
      display: 'block',
      width: 16,
      height: 16,
      borderRadius: '50%',
      backgroundColor: checked ? T.accentText : 'var(--dsw-alias-label-primary, #f9fafb)',
      transition: 'background-color .12s ease',
    },
  }))

  const Button = ({ children, onClick, variant = 'primary', disabled = false, type = 'button' }) => h('button', {
    type,
    onClick,
    disabled,
    style: {
      boxSizing: 'border-box',
      height: 36,
      padding: '0 16px',
      borderRadius: T.radiusMd,
      whiteSpace: 'nowrap',
      flex: 'none',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
      fontSize: 13,
      lineHeight: '20px',
      fontWeight: 500,
      ...(variant === 'primary'
        ? { border: 'none', background: T.accent, color: T.accentText }
        : { border: `.5px solid ${T.cardStroke}`, background: 'transparent', color: T.text1 }),
    },
  }, children)

  /** 文本输入：44px 高、12px 圆角，与官方设置字段一致。 */
  /** 输入框：与 Select / Button 同高（36px），支持单位后缀、禁用、错误态、回车提交。 */
  const Input = ({
    value,
    onChange,
    placeholder = '',
    type = 'text',
    width = 220,
    unit,
    disabled = false,
    invalid = false,
    min,
    max,
    step,
    autoFocus = false,
    onEnter,
  }) => {
    const [focused, setFocused] = useState(false)
    const border = invalid ? 'var(--dsw-alias-state-error-primary, #ff6262)' : focused ? T.text3 : T.cardStroke
    return h('div', {
      style: {
        width,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: 36,
        boxSizing: 'border-box',
        padding: '0 10px',
        borderRadius: T.radiusMd,
        border: `.5px solid ${border}`,
        background: T.inputFill,
        opacity: disabled ? 0.6 : 1,
        transition: 'border-color .12s ease',
      },
    },
      h('input', {
        type,
        value: value ?? '',
        placeholder,
        disabled,
        min,
        max,
        step,
        autoFocus,
        onChange: (event) => onChange?.(event.target.value),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        onKeyDown: (event) => { if (event.key === 'Enter') onEnter?.(event.target.value) },
        style: {
          flex: 1,
          minWidth: 0,
          border: 0,
          outline: 'none',
          background: 'transparent',
          color: T.text1,
          fontSize: 13,
          lineHeight: '20px',
          padding: 0,
        },
      }),
      unit ? h('span', { style: { ...TYPE.micro, flex: 'none' } }, unit) : null,
    )
  }

  /** 带标签/说明的输入框（Input 的组合封装，保留旧 API）。 */
  const TextField = ({ label, hint, width = '100%', ...props }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
  },
  label ? h('span', { style: { fontSize: 12, lineHeight: '16px', color: T.text2 } }, label) : null,
  h(Input, { width, ...props }),
  hint ? h('span', { style: TYPE.micro }, hint) : null)

  /* ---------- 浮层 ---------- */
  /** 悬停详情卡：portal 到 body，先按估算高度定位，挂载后按实测高度夹取。 */
  function HoverCard({ rect, width = 248, estimated = 120, children }) {
    const ref = useRef(null)
    const [placement, setPlacement] = useState(() => placeNear(rect, { width, height: estimated }))
    useEffect(() => {
      const node = ref.current
      if (!node) return
      const measured = node.getBoundingClientRect().height || estimated
      setPlacement(placeNear(rect, { width, height: measured }))
    }, [rect, width, estimated])
    const node = h('div', {
      ref,
      style: {
        position: 'fixed',
        left: placement.left,
        top: placement.top,
        width,
        zIndex: 2147400000,
        background: T.cardFill,
        border: `.5px solid ${T.cardStroke}`,
        borderRadius: T.radiusXl,
        padding: '12px 14px',
        boxShadow: '0 12px 32px rgba(0, 0, 0, .45)',
        color: T.text1,
      },
    }, children)
    return createPortal && typeof document !== 'undefined' ? createPortal(node, document.body) : node
  }

  /** 详情卡里的一行：左标题、右值。 */
  const InfoRow = ({ label, value }) => h('div', {
    style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, minWidth: 0 },
  },
  h('span', { style: { fontSize: 12, lineHeight: '18px', color: T.text2 } }, label),
  h('span', { style: { fontSize: 12, lineHeight: '18px', color: T.text1, fontVariantNumeric: 'tabular-nums' } }, value))

  /* ---------- 通用控件 ---------- */

  /** 下拉：触发器与设置输入框同高；浮层在触发器内绝对定位（不 portal），宽度与触发器一致。 */
  function Select({ value, options = [], onChange, width = 220, placeholder = '', disabled = false }) {
    const [open, setOpen] = useState(false)
    const [hover, setHover] = useState(-1)
    const ref = useRef(null)
    const current = options.find((option) => option.value === value)

    useEffect(() => {
      if (!open) return undefined
      const onDown = (event) => { if (ref.current && ref.current.contains(event.target)) return; setOpen(false) }
      const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }, [open])

    const trigger = {
      boxSizing: 'border-box',
      width: '100%',
      height: 36,
      padding: '0 8px 0 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      borderRadius: T.radiusMd,
      border: `.5px solid ${T.cardStroke}`,
      background: T.inputFill,
      color: T.text1,
      fontSize: 13,
      lineHeight: '20px',
      cursor: disabled ? 'default' : 'pointer',
      textAlign: 'left',
      opacity: disabled ? 0.55 : 1,
    }

    return h('div', { ref, style: { position: 'relative', width, minWidth: 0 } },
      h('button', {
        type: 'button',
        disabled,
        onClick: () => { if (disabled) return; setHover(-1); setOpen((previous) => !previous) },
        style: trigger,
        'aria-haspopup': 'listbox',
        'aria-expanded': open,
      },
        h('span', { style: { ...TYPE.ellipsis, flex: 1, textAlign: 'left', color: current ? T.text1 : T.text2 } }, current ? current.label : placeholder),
        h('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: T.text2,
          strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
          style: { flex: 'none', transition: 'transform .12s ease', transform: open ? 'rotate(180deg)' : 'none' },
        }, h('path', { d: 'M6 9l6 6 6-6' })),
      ),
      open && !disabled ? h('div', {
        role: 'listbox',
        style: {
          boxSizing: 'border-box',
          position: 'absolute',
          left: 0,
          top: 'calc(100% + 6px)',
          width,
          maxHeight: 320,
          overflowY: 'auto',
          padding: 4,
          zIndex: 40,
          background: T.cardFill,
          border: `.5px solid ${T.cardStroke}`,
          borderRadius: T.radiusMd,
          boxShadow: '0 12px 32px rgba(0, 0, 0, .45)',
        },
      }, options.map((option, index) => h('div', {
        key: option.value,
        role: 'option',
        'aria-selected': option.value === value,
        onMouseEnter: () => setHover(index),
        onMouseLeave: () => setHover(-1),
        onClick: () => { onChange?.(option.value); setOpen(false) },
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          height: 32,
          padding: '0 10px',
          borderRadius: 8,
          fontSize: 13,
          lineHeight: '20px',
          color: T.text1,
          cursor: 'pointer',
          background: hover === index
            ? 'color-mix(in srgb, currentColor 8%, transparent)'
            : option.value === value ? 'color-mix(in srgb, currentColor 4%, transparent)' : 'transparent',
        },
      },
        h('span', { style: { ...TYPE.ellipsis } }, option.label),
        option.value === value ? h('svg', {
          width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: T.text1,
          strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        }, h('path', { d: 'M5 13l4 4L19 7' })) : null,
      ))) : null,
    )
  }

  /** 分段切换（2~4 项）：选中项白底黑字，未选中透明，整组与输入框同高。 */
  function Segmented({ value, options = [], onChange }) {
    return h('div', {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        height: 36,
        padding: 2,
        boxSizing: 'border-box',
        borderRadius: T.radiusMd,
        border: `.5px solid ${T.cardStroke}`,
        background: T.inputFill,
      },
    }, options.map((option) => {
      const active = option.value === value
      return h('button', {
        key: option.value,
        type: 'button',
        onClick: () => onChange?.(option.value),
        style: {
          height: 30,
          padding: '0 12px',
          border: 'none',
          borderRadius: 9,
          cursor: 'pointer',
          fontSize: 13,
          lineHeight: '20px',
          background: active ? T.accent : 'transparent',
          color: active ? T.accentText : T.text2,
          transition: 'background-color .12s ease, color .12s ease',
        },
      }, option.label)
    }))
  }

  /** 图标按钮：28×28，hover 有底色；用于行内删除、刷新等。 */
  const IconButton = ({ label, onClick, disabled = false, children }) => h('button', {
    type: 'button',
    title: label,
    'aria-label': label,
    onClick,
    disabled,
    style: {
      width: 28,
      height: 28,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 0,
      borderRadius: 8,
      background: 'transparent',
      color: disabled ? T.text3 : T.text2,
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.6 : 1,
    },
  }, children)

  /** 指标块：上标签、下数值，用于面板顶部摘要。 */
  const StatTile = ({ label, value, hint }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 96 },
  },
  h('span', { style: TYPE.micro }, label),
  h('span', { style: { ...TYPE.num } }, value),
  hint ? h('span', { style: TYPE.micro }, hint) : null)

  /** 空态：居中提示，不占空容器。 */
  const EmptyState = ({ title, hint }) => h('div', {
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '24px 12px', textAlign: 'center' },
  },
  h('span', { style: TYPE.body }, title),
  hint ? h('span', { style: TYPE.small }, hint) : null)

  return {
    h, T, TYPE, CARD_BG,
    clamp, placeNear, formatBytes,
    createStore, useStore, usePoll,
    Card, CardStack, CardName, CardValue, StatusDot,
    Section, SettingsCard, SettingRow, Switch, Button, Input, TextField,
    Select, Segmented, IconButton, StatTile, EmptyState,
    HoverCard, InfoRow,
  }
}

    const ui = createUi(React, typeof createPortal === 'function' ? createPortal : undefined);

    const { h, InfoRow, HoverCard, T, TYPE } = ui

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
        calls: '次',
        breakdown: '用量明细',
        input: '输入',
        cacheRead: '缓存命中',
        output: '输出',
      },
      en: {
        created: 'Created',
        ended: 'Ended',
        models: 'Models',
        tokens: 'Tokens',
        loading: 'Loading…',
        failed: 'Unavailable',
        count: '',
        calls: 'calls',
        breakdown: 'Usage',
        input: 'Input',
        cacheRead: 'Cache hit',
        output: 'Output',
      },
    };

    /** 区块容器：只负责排版，颜色/字体全部来自 kit 的 token 与 TYPE。 */
    const SECTION_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 0,
      paddingTop: 8,
      borderTop: `.5px solid ${T.cardStroke}`,
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

    /** 千分位，用于明细里的精确值。 */
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

        /** 会话悬浮卡里的统计区块。 */
        function SessionMeta(props) {
          const sessionId = props?.sessionId;
          const [state, setState] = React.useState({ status: 'loading' });
          /** 明细：{ kind: 'models' | 'tokens', rect }，用 kit 的 HoverCard 呈现。 */
          const [detail, setDetail] = React.useState(null);
          /** 点击/回车钉住的明细 kind：触屏没有 hover，靠它提供等价入口。 */
          const [pinned, setPinned] = React.useState(null);

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
            return h('div', { style: SECTION_STYLE },
              h('span', { style: TYPE.small }, state.status === 'error' ? labels.failed : labels.loading));
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

          /** 明细内容：模型调用次数 / token 精确分解。 */
          const detailRows = (kind) => {
            if (kind === 'models') {
              return models.map((item, index) => h(InfoRow, {
                key: `m${index}`,
                label: item.provider ? `${item.provider}/${item.model}` : item.model,
                value: `${item.calls} ${labels.calls}`,
              }));
            }
            return [
              h(InfoRow, { key: 'total', label: labels.tokens, value: exactTokens(tokens.total) }),
              h(InfoRow, { key: 'input', label: labels.input, value: exactTokens(tokens.input) }),
              h(InfoRow, { key: 'cache', label: labels.cacheRead, value: exactTokens(tokens.cacheRead) }),
              h(InfoRow, { key: 'output', label: labels.output, value: exactTokens(tokens.output) }),
            ];
          };

          /** 明细内容块：浮层与点击后的行内展开共用同一份。 */
          const detailBody = (kind, extraStyle) => h('div', {
            style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, ...extraStyle },
          },
          h('span', { style: TYPE.h2 }, kind === 'models' ? labels.models : labels.breakdown),
          ...detailRows(kind));

          /** 打开/切换某一行明细；rect 用触发行的实测位置，交给 kit 的 placeNear 夹取。 */
          const toggleDetail = (kind, node) => {
            if (pinned === kind) {
              setPinned(null);
              setDetail(null);
              return;
            }
            setPinned(kind);
            setDetail({ kind, rect: node.getBoundingClientRect() });
          };

          /**
           * 可查看明细的一行：鼠标 hover 预览，点击/回车钉住。
           * 触屏没有 hover，点击是等价入口；触点按规范给到 32px 高。
           */
          const detailRow = (kind, label, value) => h('div', {
            key: kind,
            role: 'button',
            tabIndex: 0,
            'aria-expanded': Boolean(detail && detail.kind === kind),
            style: {
              display: 'flex',
              alignItems: 'center',
              minWidth: 0,
              minHeight: 32,
              cursor: 'pointer',
            },
            onMouseEnter: (event) => {
              if (!pinned) setDetail({ kind, rect: event.currentTarget.getBoundingClientRect() });
            },
            onMouseLeave: () => {
              if (!pinned) setDetail(null);
            },
            onClick: (event) => toggleDetail(kind, event.currentTarget),
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              toggleDetail(kind, event.currentTarget);
            },
          }, h('div', { style: { flex: '1 1 auto', minWidth: 0 } }, h(InfoRow, { label, value })));

          return h('div', {
            style: { ...SECTION_STYLE, gap: 6 },
            onMouseLeave: () => {
              if (!pinned) setDetail(null);
            },
          },
          h(InfoRow, { label: labels.created, value: clockOf(data.createdAt) }),
          h(InfoRow, { label: labels.ended, value: clockOf(data.endedAt) }),
          detailRow('models', labels.models, modelsValue),
          pinned === 'models' ? detailBody('models', { paddingBottom: 4 }) : null,
          detailRow('tokens', labels.tokens, compactTokens(tokens.total)),
          pinned === 'tokens' ? detailBody('tokens', { paddingBottom: 4 }) : null,
          detail && detail.kind !== pinned ? h(HoverCard, {
            rect: detail.rect,
            width: 272,
            estimated: 120,
          }, detailBody(detail.kind)) : null);
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
