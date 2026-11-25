import { readLimited } from './provider.mjs'
import { StudioError } from './store.mjs'

const proof = /^[A-Za-z0-9_-]{43}$/
const accountID = /^[1-9][0-9]{0,18}$/
const orderID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const sku = /^[a-z][a-z0-9-]{0,31}$/

function trustedURL(value) {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new Error('Studio links require HTTPS or a local loopback URL')
  }
  return url
}

export function publicRepository(value = process.env.STUDIO_GITHUB_URL) {
  if (!value) return null
  const url = trustedURL(value)
  if (url.origin !== 'https://github.com' || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname) || url.search || url.hash) {
    throw new Error('STUDIO_GITHUB_URL must point to a GitHub repository')
  }
  return url.href.replace(/\/$/, '')
}

async function body(req) {
  try {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('invalid type')
    const input = JSON.parse(await readLimited(req, 4096))
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid body')
    return input
  } catch {
    throw new StudioError(400, '无法读取此次操作。')
  }
}

function walletPack(value) {
  return value && typeof value.id === 'string' && sku.test(value.id) &&
    Number.isSafeInteger(value.images) && value.images >= 1 && value.images <= 1000 &&
    Number.isSafeInteger(value.cents) && value.cents >= 1 && value.cents <= 1000000
}

export function openSub2(store, { enabled, env = process.env }) {
  const ledger = store.entitlements
  const secret = enabled ? env.STUDIO_SUB2_SECRET : ''
  if (secret && !/^[A-Za-z0-9_-]{32,128}$/.test(secret)) throw new Error('Invalid STUDIO_SUB2_SECRET')
  const sub2 = secret ? trustedURL(env.STUDIO_SUB2_ORIGIN) : null
  const endpoint = secret ? trustedURL(env.STUDIO_SUB2_API_ORIGIN || env.STUDIO_SUB2_ORIGIN) : null
  const action = name => env['STUDIO_SUB2_' + name + '_URL'] ? trustedURL(env['STUDIO_SUB2_' + name + '_URL']).href : null
  const register = sub2 ? new URL('/register', sub2).href : action('REGISTER')
  const login = sub2 ? new URL('/login', sub2).href : action('LOGIN')
  const recharge = sub2 ? new URL('/purchase', sub2).href : action('WALLET')
  const attempts = new Set()
  const settling = new Map()

  function info(owner) {
    return {
      enabled: Boolean(endpoint),
      origin: sub2?.origin ?? null,
      linked: Boolean(endpoint && ledger.member(owner)),
      register, login, wallet: recharge,
    }
  }

  async function remote(path, input, credential) {
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secret }
    if (credential) headers['X-Studio-Session'] = credential
    let response
    let result
    try {
      response = await fetch(new URL('/api/v1/image-studio/' + path, endpoint), {
        method: 'POST', redirect: 'error', headers, body: JSON.stringify(input), signal: AbortSignal.timeout(8000),
      })
      result = JSON.parse(await readLimited(response.body, 32768))
    } catch {
      throw new StudioError(503, '暂时无法连接中转站，请稍后重试。', 'sub2_unavailable')
    }
    if (!response.ok) {
      if (result.reason === 'STUDIO_SESSION_EXPIRED') throw new StudioError(401, '登录已过期，请重新连接中转站。', 'sub2_expired')
      if (result.reason === 'STUDIO_TICKET_INVALID') throw new StudioError(401, '登录链接已失效，请重新登录。', 'sub2_ticket')
      if (result.reason === 'STUDIO_BALANCE_LOW') throw new StudioError(402, '中转站余额不足，可充值后再购买。', 'balance_low')
      if (result.reason === 'STUDIO_QUOTE_CHANGED') throw new StudioError(409, '套餐已更新，请刷新后重新确认。', 'quote_changed')
      if (result.reason === 'STUDIO_ORDER_CONFLICT') throw new StudioError(409, '订单无法核对，请联系中转站。', 'order_conflict')
      throw new StudioError(503, '中转站暂时无法处理，请稍后重试。', 'sub2_unavailable')
    }
    return result.data
  }

  async function memberCall(owner, member, path, input = {}) {
    try {
      return await remote(path, input, member.credential)
    } catch (error) {
      if (error.code === 'sub2_expired') ledger.unlink(owner, member.credential)
      throw error
    }
  }

  async function wallet(owner, member) {
    const data = await memberCall(owner, member, 'wallet')
    if (!Number.isFinite(data?.balance) || !Array.isArray(data.packages) || !data.packages.every(walletPack)) {
      throw new StudioError(503, '暂时无法读取中转站余额。', 'sub2_unavailable')
    }
    const invite = typeof data.affCode === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(data.affCode)
      ? new URL('/?invite=' + encodeURIComponent(data.affCode), env.STUDIO_PUBLIC_ORIGIN).href
      : null
    const pending = ledger.pendingOrder(member.id)
    return {
      balance: data.balance, packages: data.packages, invite,
      purchasePending: pending ? { id: pending.id, package: pending.package, images: pending.images, cents: pending.cents } : null,
    }
  }

  async function confirmOrder(owner, member, order) {
    let receipt
    try {
      receipt = await memberCall(owner, member, 'purchase', {
        id: order.id, package: order.package, images: order.images, cents: order.cents,
      })
    } catch (error) {
      if (['balance_low', 'quote_changed'].includes(error.code)) ledger.rejectOrder(member.id, order.id)
      throw error
    }
    ledger.creditOrder(member.id, order, receipt)
  }

  if (endpoint) trustedURL(env.STUDIO_PUBLIC_ORIGIN)

  async function handle(req, path, owner, quota) {
    if (!endpoint) throw new StudioError(404, '中转站连接尚未启用。')
    const finish = () => ({ sub2: info(owner), quota: quota() })
    if (path === '/api/account/start' && req.method === 'POST') {
      const { mode, page, referral } = await body(req)
      if (!['login', 'register', 'embed'].includes(mode)) throw new StudioError(400, '无法识别登录方式。')
      const state = ledger.start(owner)
      if (mode === 'embed') return { state }
      const next = '/image-studio?state=' + state + (page === 'editor' ? '&work=1' : '')
      const target = new URL(mode === 'register' ? register : '/image-studio', sub2)
      if (mode === 'login') {
        target.searchParams.set('state', state)
        if (page === 'editor') target.searchParams.set('work', '1')
      } else {
        target.searchParams.set('redirect', next)
        if (typeof referral === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(referral)) target.searchParams.set('aff', referral)
      }
      return { url: target.href }
    }
    if (path === '/api/account/complete' && req.method === 'POST') {
      const { code, state } = await body(req)
      if (typeof code !== 'string' || !proof.test(code) || typeof state !== 'string' || !proof.test(state) ||
          !ledger.allows(owner, state) || attempts.has(state)) {
        throw new StudioError(401, '登录链接已失效，请重新登录。', 'sub2_ticket')
      }
      attempts.add(state)
      try {
        const identity = await remote('exchange', { code, state })
        if (typeof identity?.id !== 'string' || !accountID.test(identity.id) ||
            typeof identity.credential !== 'string' || !proof.test(identity.credential) ||
            (identity.inviter != null && (typeof identity.inviter !== 'string' || !accountID.test(identity.inviter)))) {
          throw new StudioError(503, '中转站暂时无法确认登录。', 'sub2_unavailable')
        }
        if (!ledger.claim(owner, state, identity)) throw new StudioError(401, '请重新登录。', 'sub2_ticket')
        return finish()
      } finally { attempts.delete(state) }
    }
    const member = ledger.member(owner)
    if (path === '/api/account/logout' && req.method === 'POST') {
      if (member) {
        ledger.unlink(owner, member.credential)
        await remote('logout', {}, member.credential).catch(() => {})
      }
      return finish()
    }
    if (!member) throw new StudioError(401, '请先登录中转站。', 'sub2_expired')
    if (path === '/api/account/wallet' && req.method === 'GET') {
      return { ...finish(), wallet: await wallet(owner, member) }
    }
    if (path === '/api/account/order' && req.method === 'POST') {
      const input = await body(req)
      if (typeof input.id !== 'string' || !orderID.test(input.id)) throw new StudioError(400, '无法识别此订单。')
      let order = ledger.order(member.id, input.id)
      if (!order) {
        if (!walletPack(input.pack)) throw new StudioError(400, '请选择购买的图张套餐。')
        const latest = await wallet(owner, member)
        const pack = latest.packages.find(item => item.id === input.pack.id)
        if (!pack || pack.cents !== input.pack.cents || pack.images !== input.pack.images) {
          throw new StudioError(409, '套餐已更新，请刷新后重新确认。', 'quote_changed')
        }
        order = ledger.startOrder(member.id, input.id, pack)
        if (order.id !== input.id) throw new StudioError(409, '请先核对上一笔购买。', 'order_pending')
      }
      if (order.status === 'credited') return { ...finish(), images: order.images }
      if (order.status === 'rejected') throw new StudioError(409, '这笔订单已结束，请重新选择套餐。', 'order_rejected')
      let confirmation = settling.get(order.id)
      if (!confirmation) {
        confirmation = confirmOrder(owner, member, order).finally(() => settling.delete(order.id))
        settling.set(order.id, confirmation)
      }
      await confirmation
      return { ...finish(), images: order.images }
    }
    throw new StudioError(404, '找不到这个入口。')
  }

  return { info, handle, origin: sub2?.origin ?? null }
}
