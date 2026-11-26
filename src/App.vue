<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { ArrowLeft, ArrowRight, Download, FolderOpen, Github, ImagePlus, Moon, Pencil, Sparkles, Sun, X } from 'lucide-vue-next'
import UButton from '@nuxt/ui/components/Button.vue'
import Gallery from './components/Gallery.vue'
import AccountDialog from './components/AccountDialog.vue'
import { useStudio } from './studio/useStudio'
import { canvasLayers } from './studio/useCanvasLayers'
import type { Case, Ratio } from './studio/catalog'
import { imageView } from './studio/imageView'
import type { StudioDocument } from './studio/document'

const Workbench = defineAsyncComponent(() => import('./components/Workbench.vue'))
const studio = useStudio()
const {
  route, doc, session, error, quotaReached, original, image, active, completed,
  busyJob, submitting, checking, referenceImages, timeline, works, storageWarning,
} = studio
const exportSignal = shallowRef(0)
const account = useTemplateRef<InstanceType<typeof AccountDialog>>('account')
const worksDialog = useTemplateRef<HTMLDialogElement>('works-dialog')
const importing = shallowRef(false)
const nameField = useTemplateRef<HTMLInputElement>('work-name')
const editingName = shallowRef(false)
const nameDraft = shallowRef('')
const namingWork = shallowRef('')
async function beginName() {
  nameDraft.value = doc.value.name
  namingWork.value = doc.value.id
  editingName.value = true
  await nextTick()
  nameField.value?.select()
}
function finishName() {
  if (!editingName.value) return
  editingName.value = false
  const value = nameDraft.value.trim()
  if (value && namingWork.value === doc.value.id) {
    doc.value = { ...doc.value, name: value }
    studio.flushDraft()
  }
}
watch(() => doc.value.id, () => { editingName.value = false })
const importError = shallowRef('')
const workTime = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const appearanceKey = 'sichen.studio.theme'
function storedAppearance() {
  try { return localStorage.getItem(appearanceKey) === 'dark' ? 'dark' : 'light' }
  catch { return 'light' }
}
const appearance = shallowRef(storedAppearance())
const appearanceLabel = computed(() => appearance.value === 'dark' ? '切换到浅色' : '切换到深色')
watch(appearance, value => {
  document.documentElement.classList.toggle('dark', value === 'dark')
  document.documentElement.classList.toggle('light', value === 'light')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#0b0e19' : '#f8f8fa')
}, { immediate: true })
function toggleAppearance() {
  appearance.value = appearance.value === 'dark' ? 'light' : 'dark'
  try { localStorage.setItem(appearanceKey, appearance.value) } catch { /* storage may be unavailable */ }
}
const editor = computed(() => route.value === 'editor')
const freeQuota = computed(() => session.value?.quota.available ? session.value.quota.remaining : 0)
const shownQuota = computed(() => session.value?.sub2.linked ? freeQuota.value + (session.value.quota.memberRemaining ?? 0) : freeQuota.value)
const displayQuota = computed(() => {
  if (session.value?.provider.demo) return '本地演示'
  if (!session.value) return '游客试用'
  return (session.value.sub2.linked ? '可用 ' : '今日免费 ') + shownQuota.value + ' 张'
})
const compactQuota = computed(() => !session.value || session.value.provider.demo ? '额度' : shownQuota.value + ' 张')
const canExport = computed(() => Boolean(image.value || doc.value.slides?.length ||
  canvasLayers(doc.value.layer, doc.value.ratio).some(item => item.visible && (item.type !== 'text' || item.text)),
))

function openCase(item: Case, prompt?: string, title?: string, intent?: StudioDocument['intent']) {
  studio.create(item, prompt, undefined, title, intent)
}
function begin(prompt: string, ratio: Ratio, references: File[]) {
  studio.create(undefined, prompt, ratio)
  void referenceImages.add(references)
}
function fresh() { studio.create() }
function askAccount() { account.value?.open() }
function openWorks() {
  studio.flushDraft()
  if (!worksDialog.value?.open) worksDialog.value?.showModal()
}
function resume(id: string) {
  worksDialog.value?.close()
  studio.resume(id)
}
async function importPicture(file: File) {
  if (importing.value) return
  importError.value = ''
  importing.value = true
  try {
    await studio.importPicture(file)
  } catch (cause) {
    importError.value = cause instanceof Error ? cause.message : '图片打开失败，请重试。'
  } finally { importing.value = false }
}

</script>

<template>
  <div class="studio-app" :class="{ 'studio-app-editor': editor }">
    <a class="skip-link" :href="editor ? '#sichen-workbench' : '#sichen-atelier'">跳到主要内容</a>
    <header class="topbar">
      <a href="/" class="brand plain" aria-label="思辰生图工作站首页" @click.left.exact.prevent="studio.navigate('gallery')">
        <span class="brand-symbol" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span><strong>思辰</strong><small>生图工作站</small></span>
      </a>
      <nav v-if="!editor" class="topnav" aria-label="工作站">
        <a href="/" aria-current="page" @click.left.exact.prevent="studio.navigate('gallery')">灵感库</a>
        <a href="/studio" @click.left.exact.prevent="studio.navigate('editor')">工作台</a>
      </nav>
      <div v-else class="top-project">
        <a href="/" class="back-link" @click.left.exact.prevent="studio.navigate('gallery')"><ArrowLeft :size="15" aria-hidden="true" /> <span>案例</span></a>
        <form v-if="editingName" class="work-title-form" @submit.prevent="finishName">
          <input ref="work-name" v-model="nameDraft" name="work-title" maxlength="64" aria-label="作品名称" autocomplete="off"
            @blur="finishName" @keydown.esc.prevent="editingName = false">
        </form>
        <h1 v-else class="work-title">
          <button type="button" title="重命名作品" aria-label="重命名作品" @click="beginName">
            <span>{{ doc.name }}</span><Pencil :size="13" aria-hidden="true" />
          </button>
        </h1>
      </div>
      <div class="top-actions">
        <button class="top-quota" type="button" aria-haspopup="dialog" aria-label="查看创作额度" @click="askAccount">
          <Sparkles :size="14" aria-hidden="true" />
          <span class="top-quota-full">{{ displayQuota }}</span><span class="top-quota-short">{{ compactQuota }}</span>
        </button>
        <button class="base-button work-list-button" type="button" aria-label="我的作品" aria-haspopup="dialog" title="我的作品" @click="openWorks">
          <FolderOpen :size="16" aria-hidden="true" /><span>我的作品</span>
        </button>
        <button v-if="editor" class="base-button new-button" type="button" aria-label="新建" title="新建" @click="fresh"><ImagePlus :size="15" aria-hidden="true" /> <span>新建</span></button>
        <UButton v-if="editor" class="base-button primary" type="button" :disabled="!canExport" @click="exportSignal++"><Download :size="15" aria-hidden="true" /> 导出作品</UButton>
        <button v-else-if="session?.sub2.enabled" class="base-button account-login" type="button" @click="askAccount">{{ session.sub2.linked ? '账户' : '登录' }}</button>
        <UButton class="base-button theme-button" type="button" variant="outline" :aria-label="appearanceLabel" :title="appearanceLabel"
          @click="toggleAppearance">
          <Sun v-if="appearance === 'dark'" :size="17" aria-hidden="true" />
          <Moon v-else :size="17" aria-hidden="true" />
        </UButton>
      </div>
    </header>

    <KeepAlive>
      <Gallery v-if="!editor" :importing="importing" :import-error="importError"
        :daily-limit="session && !session.provider.demo && session.provider.ready ? session.quota.limit : undefined"
        @choose="openCase" @create="begin" @import="importPicture" />
    </KeepAlive>
    <footer v-if="!editor && session?.github" class="studio-open-source">
      <a :href="session.github" target="_blank" rel="noopener noreferrer"><Github :size="15" aria-hidden="true" />GitHub 开源项目</a>
      <a :href="session.github + '/issues'" target="_blank" rel="noopener noreferrer">反馈建议</a>
    </footer>
    <Workbench v-if="editor" :key="doc.id"
      v-model:document="doc"
      :session="session" :picture="image" :original="original" :active="active"
      :versions="completed" :busy="busyJob"
      :timeline="timeline"
      :submitting="submitting" :checking="checking" :error="error" :quota-reached="quotaReached"
      :references="referenceImages.references.value" :uploading-references="referenceImages.busy.value"
      :reference-error="referenceImages.message.value" :export-signal="exportSignal"
      @add-references="referenceImages.add" @remove-reference="referenceImages.remove"
      @version="studio.selectVersion"
      @submit="studio.submit" @refresh="studio.refresh" @account="askAccount"
    />

    <Teleport to="body">
      <AccountDialog ref="account" :session="session" :page="route" :refresh="studio.refreshSession" :save="studio.flushDraft" @update="studio.applyAccount" />
      <dialog ref="works-dialog" class="studio-modal studio-works-modal" aria-labelledby="works-heading" @click.self="worksDialog?.close()">
        <section class="studio-modal-content">
          <div class="modal-head"><h2 id="works-heading">我的作品</h2><button class="base-button icon-button" type="button" aria-label="关闭作品列表" autofocus @click="worksDialog?.close()"><X :size="18" aria-hidden="true" /></button></div>
          <p>作品保存在这台设备的当前浏览器。</p>
          <p v-if="storageWarning" role="status">{{ storageWarning }}</p>
          <ul v-if="works.length" class="studio-works">
            <li v-for="entry in works" :key="entry.document.id">
              <button type="button" class="studio-work" @click="resume(entry.document.id)">
                <span class="studio-work-preview"><img v-if="entry.preview" :src="imageView(entry.preview.url, 'thumb')"
                  width="52" height="52" alt="" loading="lazy" decoding="async"><FolderOpen v-else :size="20" aria-hidden="true" /></span>
                <span class="studio-work-copy"><strong>{{ entry.document.name }}</strong>
                  <small>{{ entry.document.slides ? '演示文稿 · ' : '' }}{{ workTime.format(entry.modified) }}</small>
                </span>
                <ArrowRight :size="17" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <p v-else class="studio-works-empty">开始创作后，作品会自动保存到这里。</p>
        </section>
      </dialog>
    </Teleport>
  </div>
</template>

<style scoped>
.studio-open-source { display: flex; justify-content: center; flex-wrap: wrap; gap: 18px; padding: 18px 12px 28px; font-size: .85rem; color: var(--muted); }
.studio-open-source a { display: inline-flex; align-items: center; gap: 6px; }
</style>
