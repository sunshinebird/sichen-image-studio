import { computed, onUnmounted, shallowRef, watch, type Ref } from 'vue'
import { ApiError, studioApi, type AccountUpdate, type Session, type Wallet, type WalletPack } from './api'

const referralKey = 'sichen.studio.invite'
const codePattern = /^[A-Za-z0-9_-]{43}$/

export function useStudioAccount(options: {
  session: Ref<Session | null>
  page: Ref<'gallery' | 'editor'>
  update: (data: AccountUpdate) => void
  refresh: () => Promise<void>
  save: () => void
}) {
  const initial = new URL(location.href)
  const embedded = initial.searchParams.get('embed') === '1' && window.parent !== window
  const returnTicket = /^#sub2=([\w-]{43})\.([\w-]{43})$/.exec(initial.hash)
  let referral: string | undefined
  try {
    const invited = initial.searchParams.get('invite')
    if (invited && /^[A-Za-z0-9_-]{1,32}$/.test(invited)) sessionStorage.setItem(referralKey, invited)
    referral = sessionStorage.getItem(referralKey) ?? undefined
  } catch { /* the page still works without session storage */ }
  if (returnTicket || initial.searchParams.has('invite')) {
    if (returnTicket) initial.hash = ''
    initial.searchParams.delete('invite')
    history.replaceState(history.state, '', initial)
  }

  const busy = shallowRef(false)
  const loadingWallet = shallowRef(false)
  const wallet = shallowRef<Wallet | null>(null)
  const message = shallowRef('')
  const error = shallowRef('')
  const purchaseError = shallowRef('')
  const linked = computed(() => Boolean(options.session.value?.sub2.linked))
  const retryOrder = shallowRef<{ id: string; pack?: WalletPack }>()
  let embedState: string | undefined
  let embedTimer: ReturnType<typeof setTimeout> | undefined
  let walletSequence = 0

  async function loadWallet() {
    if (!linked.value) return
    const sequence = ++walletSequence
    loadingWallet.value = true
    try {
      const result = await studioApi.accountWallet()
      if (sequence !== walletSequence) return
      options.update(result)
      wallet.value = result.wallet
    } catch (cause) {
      if (sequence !== walletSequence) return
      error.value = cause instanceof Error ? cause.message : '无法读取中转站余额。'
      if (cause instanceof ApiError && cause.code === 'sub2_expired') {
        wallet.value = null
        await options.refresh().catch(() => {})
      }
    } finally { if (sequence === walletSequence) loadingWallet.value = false }
  }

  function report(cause: unknown) {
    error.value = cause instanceof Error ? cause.message : '操作未完成，请再试一次。'
  }

  async function complete(code: string, state: string) {
    const result = await studioApi.completeAccount(code, state)
    options.update(result)
    wallet.value = null
    message.value = embedded ? '' : '已连接中转站，继续你的创作。'
  }

  async function connect(mode: 'login' | 'register') {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      options.save()
      const result = await studioApi.startAccount(mode, options.page.value, mode === 'register' ? referral : undefined)
      if (result.url) window.location.assign(result.url)
    } catch (cause) { report(cause) } finally { busy.value = false }
  }

  async function receive(event: MessageEvent<unknown>) {
    if (!embedded || event.source !== window.parent || event.origin !== options.session.value?.sub2.origin) return
    if (!event.data || typeof event.data !== 'object') return
    const data = event.data as Record<string, unknown>
    if (data.type !== 'sichen-studio:ticket' || !embedState || data.state !== embedState) return
    const state = embedState
    embedState = undefined
    clearTimeout(embedTimer)
    try {
      if (typeof data.code !== 'string' || !codePattern.test(data.code)) throw new Error('无法连接中转站，请刷新此页面。')
      await complete(data.code, state)
    } catch (cause) { report(cause) } finally { busy.value = false }
  }

  if (embedded) window.addEventListener('message', receive)
  watch(() => options.session.value?.sub2.enabled, async enabled => {
    if (!enabled) return
    if (returnTicket) {
      busy.value = true
      try { await complete(returnTicket[1], returnTicket[2]) }
      catch (cause) { report(cause) } finally { busy.value = false }
    } else if (embedded) {
      const origin = options.session.value?.sub2.origin
      if (!origin) return
      busy.value = true
      try {
        const result = await studioApi.startAccount('embed', options.page.value)
        if (!result.state) throw new Error('无法连接中转站。')
        embedState = result.state
        window.parent.postMessage({ type: 'sichen-studio:connect', state: embedState }, origin)
        embedTimer = setTimeout(() => {
          embedState = undefined
          busy.value = false
          error.value = '连接中转站超时，请刷新此页面。'
        }, 12000)
      } catch (cause) { report(cause); busy.value = false }
    }
  }, { immediate: true })
  onUnmounted(() => {
    window.removeEventListener('message', receive)
    clearTimeout(embedTimer)
  })

  async function purchase(pack?: WalletPack) {
    if (busy.value) return
    purchaseError.value = ''
    message.value = ''
    const pending = wallet.value?.purchasePending
    const order = pending ? { id: pending.id } : retryOrder.value ?? (pack ? { id: crypto.randomUUID(), pack } : undefined)
    if (!order) return
    retryOrder.value = order
    busy.value = true
    try {
      const result = await studioApi.accountPurchase(order.id, order.pack)
      options.update(result)
      retryOrder.value = undefined
      message.value = '已到账 ' + result.images + ' 张，可以继续创作。'
    } catch (cause) {
      if (cause instanceof ApiError && ['balance_low', 'quote_changed', 'order_rejected', 'order_pending', 'sub2_expired'].includes(cause.code)) {
        retryOrder.value = undefined
      }
      purchaseError.value = cause instanceof Error ? cause.message : '订单暂未确认，请核对原订单。'
    } finally {
      await loadWallet()
      busy.value = false
    }
  }

  async function logout() {
    if (busy.value) return
    busy.value = true
    error.value = ''
    message.value = ''
    try {
      options.update(await studioApi.unlinkAccount())
      walletSequence++
      loadingWallet.value = false
      wallet.value = null
      retryOrder.value = undefined
    } catch (cause) { report(cause) } finally { busy.value = false }
  }

  return { embedded, referral, linked, busy, wallet, loadingWallet, message, error, purchaseError, retryOrder,
    connect, loadWallet, purchase, logout }
}
