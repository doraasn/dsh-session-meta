/**
 * 自测：路由守卫、会话 id 校验、错误脱敏。不联网、不写盘。
 * 用法: npm test
 */
import { apply } from '../index.js'

const SELF_ORIGIN = 'http://127.0.0.1:59681'
const HOST = '127.0.0.1:59681'

let handler = null
const query = {
  async readSession(id) {
    if (id === 'missing') throw new Error('session "missing" not found at C:\\Users\\x\\.dsh\\logs')
    return { session: { id, createdAt: 1000 }, events: [] }
  },
}

apply({
  webServer: { register: (route) => { handler = route.handler }, getOrigin: () => SELF_ORIGIN },
  on: () => {},
  get: (name) => (name === 'sessionQuery' ? query : undefined),
})

let passed = 0
let failed = 0
const check = (name, condition, extra = '') => {
  if (condition) passed++
  else {
    failed++
    console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`)
  }
}

const call = (url, headers = { host: HOST }) => new Promise((resolve) => {
  const req = { url, method: 'GET', headers }
  const res = {
    statusCode: 200,
    setHeader() {},
    end(text) {
      let parsed = null
      try { parsed = JSON.parse(text) } catch { parsed = text }
      resolve({ status: res.statusCode, body: parsed })
    },
  }
  handler(req, res).catch(() => resolve({ status: 500, body: null }))
})

const ok = await call(`/dsh-session-meta/api/stat?session=abc-123`)
check('正常统计 200', ok.status === 200 && ok.body.createdAt === 1000, `实际 ${ok.status}`)

check('未知路径 404', (await call('/dsh-session-meta/api/nope')).status === 404)
check('穿越式 id 被拒', (await call('/dsh-session-meta/api/stat?session=../x')).status === 400)
check('"." 被拒', (await call('/dsh-session-meta/api/stat?session=.')).status === 400)
check('缺少 session 参数被拒', (await call('/dsh-session-meta/api/stat')).status === 400)

const rebindHost = await call('/dsh-session-meta/api/stat?session=abc-123', { host: 'evil.example' })
check('伪造 Host 被拒', rebindHost.status === 403 && rebindHost.body.error === 'forbidden-host')
const csrf = await call('/dsh-session-meta/api/stat?session=abc-123', { host: HOST, origin: 'https://evil.example' })
check('跨站 Origin 被拒', csrf.status === 403 && csrf.body.error === 'forbidden-origin')
check('同源放行', (await call('/dsh-session-meta/api/stat?session=abc-123', { host: HOST, origin: SELF_ORIGIN })).status === 200)

const missing = await call('/dsh-session-meta/api/stat?session=missing')
check('读取失败返回固定文案', missing.status === 404 && missing.body.error === 'unreadable-session' && missing.body.message === undefined,
  JSON.stringify(missing.body))
check('错误里不回显内部路径', !JSON.stringify(missing.body).includes('C:\\\\Users'), JSON.stringify(missing.body))

console.log(`\n结果: ${passed} 通过 / ${failed} 失败`)
process.exitCode = failed === 0 ? 0 : 1
