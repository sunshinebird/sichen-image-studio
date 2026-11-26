<script setup lang="ts">
import { computed, nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import { ArrowUp, CircleAlert, Clock3, GitBranch, ImagePlus, Paintbrush, Scan, Sparkles } from 'lucide-vue-next'
import UButton from '@nuxt/ui/components/Button.vue'
import UChatPrompt from '@nuxt/ui/components/ChatPrompt.vue'
import StudioSelect from './StudioSelect.vue'
import type { ImageAsset, Job, ReferenceImage, Session } from '../studio/api'
import type { Ratio } from '../studio/catalog'
import { imageView } from '../studio/imageView'
import demoActions from '../../content/demo-actions.json'

const props = defineProps<{
  picture: ImageAsset | null; active?: Job; timeline: Job[]; versions: Job[]; versionLabel: string
  busy?: Job; submitting: boolean; checking: boolean; latestError: string; exhausted: boolean; session: Session | null
  maskMode: 'rect' | 'brush' | null; hasSelection: boolean
  references: ReferenceImage[]; uploadingReferences: boolean; referenceError: string
  ratio: Ratio; fixedRatio: boolean
  requiresReference?: boolean
}>()
const prompt = defineModel<string>('prompt', { required: true })
const useCurrent = defineModel<boolean>('useCurrent', { required: true })
const style = defineModel<string>('style', { required: true })
const brushWidth = defineModel<number>('brushWidth', { required: true })
const emit = defineEmits<{
  submit: [prompt: string]; addReferences: [files: File[]]; removeReference: [url: string]; mask: [mode: 'rect' | 'brush' | null]; clearMask: []
  ratio: [value: Ratio]; version: [id: string]; refresh: []; account: []
}>()
const entryList = useTemplateRef<HTMLElement>('entries')
const composer = useTemplateRef<{ textareaRef?: HTMLTextAreaElement }>('composer')
const referenceInput = useTemplateRef<HTMLInputElement>('reference-input')
const validation = shallowRef('')
const directions = [
  { value: 'portrait', label: '竖版' },
  { value: 'square', label: '方形' },
  { value: 'wide', label: '横版' },
] as const
const styles = [
  { value: 'default', label: '随描述', cue: '' },
  { value: 'photo', label: '写实摄影', cue: '整体采用真实摄影质感，保留自然光线、清晰的材质细节与可信的透视。' },
  { value: 'poster', label: '平面设计', cue: '整体采用现代平面设计，注重版式网格、视觉层次和清晰的中文排版。' },
  { value: 'illustration', label: '手绘插画', cue: '整体采用细腻的手绘插画风格，色彩和谐，保留轮廓及绘画纹理。' },
]
const locked = computed(() => Boolean(props.busy || props.submitting || props.checking || props.uploadingReferences || !props.session?.provider.ready))
const isCreating = computed(() => Boolean(props.busy || props.submitting || props.checking))
const currentStatus = computed(() => {
  if (props.submitting) return '正在提交…'
  if (props.checking) return '正在确认刚才的任务…'
  if (props.busy) return (props.busy.stage || '正在生成') + '…'
  return ''
})
const lastJob = computed(() => props.timeline.at(-1))
const sourceName = computed(() => props.picture && useCurrent.value ? props.versionLabel : '')
const recentStages: Record<Job['status'], string> = {
  succeeded: '已生成', running: '正在生成', uncertain: '等待确认', failed: '未生成',
}
const timeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' })
const versionNumbers = computed(() => new Map(props.versions.map((job, index) => [job.id, index + 1])))

function sourceOf(job: Job) {
  if (job.baseReference?.startsWith('case:')) return '基于案例原图'
  if (job.baseReference?.startsWith('media:')) return '基于选中的底图'
  if (job.baseReference?.startsWith('asset:')) {
    const number = versionNumbers.value.get(job.baseReference.slice(6))
    return number ? '基于版本 ' + number : '基于已保存的图片'
  }
  return job.mode === 'edit' ? '基于参考图' : '从描述生成'
}

function focusPrompt() { composer.value?.textareaRef?.focus({ preventScroll: true }) }
defineExpose({ focusPrompt })

function suggest(text: string) {
  prompt.value = text
  composer.value?.textareaRef?.focus()
}

function attach(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length) emit('addReferences', files)
}
function pasteReference(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.files ?? []).filter(file => file.type.startsWith('image/'))
  if (!files.length || props.uploadingReferences) return
  event.preventDefault()
  emit('addReferences', files)
}
function dropReference(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length && !props.uploadingReferences) emit('addReferences', files)
}

function send() {
  if (props.exhausted) { emit('account'); return }
  if (locked.value) return
  if (!prompt.value.trim()) { showMissingPrompt(); return }
  const cue = styles.find(item => item.value === style.value)?.cue
  const instruction = prompt.value.trim() + (cue && !props.session?.provider.demo ? '\n\n' + cue : '')
  if (instruction.length > 1200) {
    validation.value = '描述和风格设置合计超过 1200 字。请缩短描述，或选择「随描述」。'
    composer.value?.textareaRef?.focus()
    return
  }
  validation.value = ''
  emit('submit', instruction)
}

function showMissingPrompt() {
  validation.value = '请先描述你要生成或修改的图片。'
  composer.value?.textareaRef?.focus()
}

watch(useCurrent, () => { validation.value = '' })
watch(prompt, () => { if (prompt.value.trim() && validation.value.startsWith('请先描述')) validation.value = '' })

watch(() => [props.timeline.length, props.timeline.at(-1)?.status], async () => {
  const list = entryList.value
  const follows = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 140
  await nextTick()
  if (list && follows) list.scrollTo({ top: list.scrollHeight })
}, { flush: 'pre' })
</script>

<template>
  <section class="wb-panel wb-chat" :data-has-messages="timeline.length > 0" aria-label="创作对话">
    <div v-if="picture || requiresReference" class="wb-creation-settings">
      <div v-if="picture" class="wb-chat-intent" role="group" aria-label="创作方式">
        <button type="button" class="wb-button" :aria-pressed="useCurrent" :disabled="isCreating"
          @click="useCurrent = true">改当前图</button>
        <button type="button" class="wb-button" :aria-pressed="!useCurrent" :disabled="isCreating"
          @click="useCurrent = false">重新生图</button>
      </div>
      <div v-if="picture && useCurrent" class="wb-setting-row wb-source-setting">
        <span>修改底图</span>
        <span class="wb-source-value">
          <img :src="imageView(picture.url, 'thumb')" width="22" height="22" alt="" decoding="async">
          <span>{{ versionLabel }}{{ active?.demo ? ' · 本地示例' : '' }}</span>
        </span>
      </div>
      <p v-else-if="requiresReference" class="wb-help">请先用「打开图片」导入原图，或在输入框下方添加参考图。</p>
      <div v-if="sourceName" class="wb-setting-row wb-scope-setting">
        <span>修改范围</span>
        <div class="wb-scope" role="group" aria-label="修改范围">
          <button type="button" class="wb-button" :aria-pressed="maskMode === null" @click="emit('mask', null)">整张</button>
          <button type="button" class="wb-button" :aria-pressed="maskMode === 'rect'" @click="emit('mask', 'rect')"><Scan :size="15" aria-hidden="true" /> 框选</button>
          <button type="button" class="wb-button" :aria-pressed="maskMode === 'brush'" @click="emit('mask', 'brush')"><Paintbrush :size="15" aria-hidden="true" /> 画笔</button>
        </div>
      </div>
      <label v-if="maskMode === 'brush'" class="wb-slider-field">
        <span>画笔大小 <span class="wb-slider-value" aria-hidden="true">{{ Math.round(brushWidth * 100) }}%</span></span>
        <input type="range" min="0.02" max="0.24" step="0.005" aria-label="画笔大小"
          :aria-valuetext="Math.round(brushWidth * 100) + '%'" v-model.number="brushWidth">
      </label>
    </div>
    <div class="wb-chat-body">
      <div v-if="timeline.length" ref="entries" class="wb-conversation" aria-label="创作记录">
        <article v-for="job in timeline" :key="job.id" class="wb-turn" :data-status="job.status">
          <div class="wb-turn-meta"><span><GitBranch :size="13" /> {{ sourceOf(job) }}{{ job.demo ? ' · 本地示例' : '' }}</span><time :datetime="new Date(job.createdAt).toISOString()">{{ timeFormat.format(job.createdAt) }}</time></div>
          <p class="wb-message">{{ job.prompt }}</p>
          <div v-if="job.asset" class="wb-turn-result">
            <button type="button" class="wb-result-thumb" :aria-label="'查看版本 ' + versionNumbers.get(job.id)"
              :aria-pressed="active?.id === job.id" @click="emit('version', job.id)">
              <img :src="imageView(job.asset.url, 'thumb')" width="34" height="34" alt="" loading="lazy" decoding="async">
              <span>版本 {{ versionNumbers.get(job.id) }}</span>
            </button>
            <span>原图 {{ job.asset.width }} × {{ job.asset.height }}</span>
          </div>
          <p v-else class="wb-answer" :role="job.status === 'running' ? 'status' : undefined">
            <CircleAlert v-if="job.status === 'failed'" :size="15" /><Clock3 v-else :size="15" />
            <span>{{ job.error || job.stage || recentStages[job.status] }}</span>
            <button v-if="job.status === 'uncertain'" type="button" class="wb-text-button" @click="emit('refresh')">查状态</button>
            <button v-if="job.status === 'failed' && job.id === lastJob?.id" type="button" class="wb-text-button" @click="suggest(job.prompt)">取回描述</button>
          </p>
        </article>
      </div>
    </div>

    <div class="wb-composer-wrap">
      <div v-if="currentStatus" class="wb-current-job" role="status">
        <span class="wb-spinner" aria-hidden="true"></span><span>{{ currentStatus }}</span>
        <button v-if="checking && !submitting" type="button" class="wb-text-button" @click="emit('refresh')">查询状态</button>
        <small v-else>可以返回案例，稍后在「我的作品」继续。</small>
      </div>
      <p v-else-if="lastJob?.status === 'failed' && !latestError" class="wb-recent-failure" role="status">这张图未生成，试用次数已退回。</p>
      <div v-if="sourceName" class="wb-suggestions" aria-label="改图建议">
        <button v-for="action in demoActions.edit" :key="action.id" type="button" class="wb-chip" @click="suggest(action.prompt)">{{ action.label }}</button>
      </div>
      <p v-if="session?.provider.demo" class="wb-demo-note">
        {{ sourceName ? '本地演示仅执行上方的示例操作。' : '本地演示可输入「' + demoActions.generate + '」。' }}
      </p>
      <div v-if="references.length || uploadingReferences" class="wb-attachments" aria-label="当前参考图">
        <div v-for="reference in references" :key="reference.asset.url" class="wb-attachment wb-saved-reference">
          <img :src="imageView(reference.asset.url, 'thumb')" width="29" height="29" alt="" decoding="async">
          <span :title="reference.name">{{ reference.name }}</span>
          <button type="button" class="wb-text-button" :aria-label="'移除 ' + reference.name" @click="emit('removeReference', reference.asset.url)">移除</button>
        </div>
        <span v-if="uploadingReferences" role="status" class="wb-help">正在保存参考图…</span>
      </div>
      <p v-if="referenceError" class="wb-error" role="alert">{{ referenceError }}</p>
      <div class="wb-composer-heading">
        <h2>{{ sourceName ? '描述要改的地方' : '描述想生成的图片' }}</h2>
        <p v-if="!timeline.length">{{ sourceName ? '也可以框选或涂抹，只改局部。' : '写清主体、风格和构图，或带上参考图。' }}</p>
      </div>
      <input ref="reference-input" type="file" name="reference-image" accept="image/png,image/jpeg,image/webp"
        :multiple="references.length === 0" hidden @change="attach">
      <UChatPrompt id="studio-instructions" ref="composer" v-model="prompt" aria-label="创作描述"
        name="prompt" class="wb-composer" variant="soft" :autofocus="false" :autoresize="false"
        :rows="4" :maxlength="1200" autocomplete="off" :submit-on-enter="false"
        :status="isCreating ? 'submitted' : 'ready'"
        :placeholder="sourceName ? '例如，把背景换成浅米色…' : '例如，一张清晰的柠檬苏打商品图…'"
        @paste="pasteReference" @dragover.prevent @drop.prevent="dropReference" @submit="send">
        <template #footer>
          <div class="wb-compose-actions" role="group" aria-label="生成设置">
            <div class="wb-compose-field">
              <span aria-hidden="true">方向</span>
              <span v-if="fixedRatio" class="wb-fixed-direction">横版</span>
              <StudioSelect v-else :model-value="ratio" :items="directions" label="生成方向" @update:model-value="emit('ratio', $event)" />
            </div>
            <div v-if="!session?.provider.demo" class="wb-compose-field">
              <span aria-hidden="true">风格</span>
              <StudioSelect v-model="style" :items="styles" label="画面风格" />
            </div>
            <button class="wb-button wb-attach-button" type="button" :disabled="uploadingReferences || references.length >= 2"
              @click="referenceInput?.click()"><ImagePlus :size="15" aria-hidden="true" /> {{ references.length ? '参考图 ' + references.length + '/2' : '添加参考图' }}</button>
          </div>
          <p v-if="validation || latestError" class="wb-error wb-composer-error" role="alert">{{ validation || latestError }}</p>
          <UButton v-if="exhausted" class="wb-button wb-primary wb-generate" type="button" @click="emit('account')">获取更多额度</UButton>
          <UButton v-else class="wb-button wb-primary wb-generate" type="submit" :disabled="locked">
            <ArrowUp v-if="sourceName" :size="17" aria-hidden="true" /><Sparkles v-else :size="17" aria-hidden="true" />
            {{ checking && !submitting ? '确认中…' : isCreating ? '生成中…' : sourceName ? '应用修改并生成' : '生成图片' }}
          </UButton>
        </template>
      </UChatPrompt>
      <div class="wb-compose-notes">
        <span>{{ maskMode === 'brush' ? '涂抹要改的区域' : maskMode === 'rect' ? '在画布上拖动框选区域' : session?.provider.demo ? '演示不占正式试用次数' : '出图成功后计 1 张' }}</span>
        <button v-if="maskMode && hasSelection" type="button" class="wb-button wb-text-button" @click="emit('clearMask')">清除选区</button>
        <span v-else-if="session?.generation?.model && !session.provider.demo" class="wb-model-caption" translate="no">{{ session.generation.model }}</span>
      </div>
      <p v-if="session?.provider.ready === false" class="wb-help">图像服务尚未配置。</p>
    </div>
  </section>
</template>
