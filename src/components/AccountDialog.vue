<script setup lang="ts">
import { computed, shallowRef, toRef, useTemplateRef, watch } from 'vue'
import { ArrowUpRight, Coins, Copy, Gift, LogIn, UserPlus, X } from 'lucide-vue-next'
import { useStudioAccount } from '../studio/useStudioAccount'
import type { AccountUpdate, Session, WalletPack } from '../studio/api'

const props = defineProps<{
  session: Session | null
  page: 'editor' | 'gallery'
  refresh: () => Promise<void>
  save: () => void
}>()
const emit = defineEmits<{ update: [data: AccountUpdate] }>()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const inviteField = useTemplateRef<HTMLInputElement>('invite')
const selected = shallowRef<WalletPack | null>(null)
const copied = shallowRef(false)
const openNow = shallowRef(false)
const account = useStudioAccount({
  session: toRef(props, 'session'), page: toRef(props, 'page'), update: value => emit('update', value),
  refresh: props.refresh, save: props.save,
})
const { embedded, linked, wallet, loadingWallet, busy, error, message, purchaseError, retryOrder } = account
const quota = computed(() => props.session?.quota)
const availableFree = computed(() => quota.value?.available ? quota.value.remaining : 0)
const dollars = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const amount = (pack: WalletPack) => dollars.format(pack.cents / 100)
const enough = computed(() => Boolean(selected.value && wallet.value && wallet.value.balance >= selected.value.cents / 100))

function open() {
  selected.value = null
  copied.value = false
  dialog.value?.showModal()
  openNow.value = true
  void props.refresh().then(() => account.loadWallet()).catch(() => {})
}
defineExpose({ open })

watch(linked, value => {
  selected.value = null
  if (value && openNow.value) void account.loadWallet()
})

async function copyInvite() {
  if (!wallet.value?.invite) return
  try {
    await navigator.clipboard.writeText(wallet.value.invite)
    copied.value = true
  } catch {
    inviteField.value?.select()
  }
}

async function pay() {
  await account.purchase(selected.value ?? undefined)
  if (!purchaseError.value) selected.value = null
}
</script>

<template>
  <div v-if="!openNow && !embedded && (message || error)" class="account-toast" role="status">
    {{ error || message }}
    <button type="button" class="base-button icon-button" aria-label="关闭提示" @click="message = ''; error = ''"><X :size="16" /></button>
  </div>
  <dialog ref="dialog" class="studio-modal studio-account-modal" aria-labelledby="account-heading"
    @close="openNow = false" @click.self="dialog?.close()">
    <section class="studio-modal-content">
      <div class="modal-head">
        <h2 id="account-heading">创作额度</h2>
        <button type="button" class="base-button icon-button" aria-label="关闭" autofocus @click="dialog?.close()"><X :size="18" /></button>
      </div>
      <template v-if="quota && !session?.provider.demo">
        <div class="credit-summary">
          <div><span>今日免费</span><strong>{{ availableFree }}<small> / {{ quota.limit }} 张</small></strong></div>
          <div v-if="linked"><span>账户图张</span><strong>{{ quota.memberRemaining ?? 0 }}<small> 张</small></strong></div>
        </div>
        <p class="credit-note">{{ quota.resetTime }}刷新试用。{{ linked ? '优先用今日免费额度。' : '明确出图失败会退回次数。' }}</p>
      </template>
      <p v-else-if="session?.provider.demo">本地演示可体验示例创作。</p>
      <p v-else>正在读取创作额度…</p>

      <template v-if="session?.sub2.enabled && !linked">
        <p v-if="account.referral" class="credit-note">你通过好友邀请来到工作站。</p>
        <div class="credit-option">
          <Gift :size="18" aria-hidden="true" /><span><strong>验证邮箱注册送 5 张</strong><small>注册中转站账号，继续当前作品。</small></span>
          <button class="base-button primary" type="button" :disabled="busy" @click="account.connect('register')">注册并领取</button>
        </div>
        <div class="credit-option">
          <Coins :size="18" aria-hidden="true" /><span><strong>已有中转站账号</strong><small>登录后可邀请好友或用余额购买图张。</small></span>
          <button class="base-button" type="button" :disabled="busy" @click="account.connect('login')"><LogIn :size="15" />登录</button>
        </div>
      </template>
      <template v-else-if="linked">
        <div v-if="loadingWallet && !wallet" class="credit-note" role="status">正在同步中转站账户…</div>
        <template v-if="wallet">
          <div v-if="wallet.invite" class="credit-option credit-invite">
            <UserPlus :size="18" aria-hidden="true" />
            <span><strong>邀请好友得 5 张</strong><small>好友通过链接注册、验证邮箱并成功生成首张图后到账。</small></span>
            <button class="base-button" type="button" @click="copyInvite"><Copy :size="14" />{{ copied ? '已复制' : '复制邀请链接' }}</button>
            <input ref="invite" :value="wallet.invite" aria-label="邀请链接" readonly class="invite-url" @focus="inviteField?.select()">
          </div>
          <div class="wallet-heading">
            <span><strong>用余额购买图张</strong><small>中转站余额 {{ dollars.format(wallet.balance) }}</small></span>
            <a v-if="session?.sub2.wallet" class="base-button" :href="session.sub2.wallet" target="_blank" rel="noopener noreferrer">前往充值<ArrowUpRight :size="14" /></a>
          </div>
          <div v-if="wallet.purchasePending || retryOrder" class="wallet-confirm">
            <span>请先核对上一笔购买</span>
            <button class="base-button primary" type="button" :disabled="busy" @click="pay">{{ busy ? '正在核对…' : '核对订单' }}</button>
          </div>
          <template v-else-if="wallet.packages.length">
            <div class="wallet-packs" aria-label="图张套餐">
              <button v-for="pack in wallet.packages" :key="pack.id" class="wallet-pack" type="button"
                :aria-pressed="selected?.id === pack.id" :disabled="busy" @click="selected = pack">
                <strong>{{ pack.images }} 张</strong><span>{{ amount(pack) }}</span>
              </button>
            </div>
            <div v-if="selected" class="wallet-confirm">
              <span>{{ enough ? '确认后从中转站余额扣款。' : '余额不足，请充值后再购买。' }}</span>
              <button class="base-button primary" type="button" :disabled="busy || !enough" @click="pay">{{ busy ? '正在确认…' : '确认支付 ' + amount(selected) }}</button>
            </div>
          </template>
          <p v-else class="credit-note">图张套餐暂未开放。</p>
        </template>
        <div class="credit-footer">
          <button class="text-button" type="button" :disabled="busy || loadingWallet" @click="account.loadWallet">刷新额度与余额</button>
          <button v-if="!embedded" class="text-button" type="button" :disabled="busy" @click="account.logout">退出工作站账号</button>
        </div>
      </template>
      <div v-else-if="!session?.provider.demo && session?.sub2.login" class="credit-footer">
        <a class="base-button" :href="session.sub2.login" target="_blank" rel="noopener noreferrer">前往中转站</a>
      </div>
      <p v-if="purchaseError || error" class="credit-error" role="alert">{{ purchaseError || error }}</p>
      <p v-else-if="message" class="credit-note" role="status">{{ message }}</p>
    </section>
  </dialog>
</template>

<style scoped>
.studio-account-modal { width: min(530px, calc(100vw - 28px)); }
.credit-summary { display: flex; gap: 32px; margin-top: 16px; }
.credit-summary div { display: grid; gap: 3px; }
.credit-summary span, .credit-summary small, .credit-note, .wallet-heading small, .credit-option small {
  color: var(--muted); font-size: .83rem;
}
.credit-summary strong { font-size: 1.85rem; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.credit-summary small { font-weight: 500; letter-spacing: 0; }
.credit-option { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; margin-top: 13px; padding-top: 13px; border-top: 1px solid var(--line); }
.credit-option small, .wallet-heading small { display: block; margin-top: 3px; }
.credit-option > svg { color: var(--muted); }
.credit-option > button { white-space: nowrap; }
.invite-url { grid-column: 2 / -1; min-width: 0; border: 1px solid var(--line); border-radius: 8px; padding: 7px 9px; background: transparent; color: var(--muted); font-size: .78rem; }
.wallet-heading, .wallet-confirm, .credit-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.wallet-heading { margin-top: 17px; }
.wallet-packs { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; margin: 10px 0; }
.wallet-pack { display: grid; gap: 4px; text-align: left; border: 1px solid var(--line); background: transparent; border-radius: 10px; padding: 10px; cursor: pointer; }
.wallet-pack[aria-pressed=true] { border-color: var(--accent, #7250c5); outline: 1px solid var(--accent, #7250c5); }
.wallet-pack span, .wallet-confirm span { color: var(--muted); font-size: .82rem; }
.wallet-confirm { margin-top: 8px; }
.credit-footer { margin-top: 13px; justify-content: flex-start; gap: 15px; }
.text-button { border: 0; background: transparent; padding: 6px 0; font-size: .8rem; color: var(--muted); text-decoration: underline; cursor: pointer; }
.credit-error { color: #b74242; }
.account-toast { position: fixed; z-index: 20; top: 64px; right: 14px; max-width: calc(100vw - 28px); display: flex; align-items: center; gap: 8px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel, #fff); box-shadow: 0 8px 24px #0001; }
@media (max-width: 390px) {
  .credit-option { grid-template-columns: auto 1fr; }
  .credit-option > button { grid-column: 2; justify-self: start; }
}
</style>
