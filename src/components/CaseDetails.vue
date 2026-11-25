<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Copy, Maximize2, Minimize2, X } from 'lucide-vue-next'
import UButton from '@nuxt/ui/components/Button.vue'
import { expandPrompt, researchLinks, type Case } from '../studio/catalog'
import type { StudioDocument } from '../studio/document'
import { detailSizes, detailSources, imageView } from '../studio/imageView'
import '../styles/case-details.css'

const { item, hasPrevious, hasNext, loadingNext } = defineProps<{ item: Case; hasPrevious: boolean; hasNext: boolean; loadingNext: boolean }>()
const emit = defineEmits<{ close: []; step: [direction: -1 | 1]; choose: [item: Case, prompt: string, title?: string, intent?: StudioDocument['intent']] }>()
const modal = useTemplateRef<HTMLDialogElement>('modal')
const scroller = useTemplateRef<HTMLElement>('scroll-area')
const info = useTemplateRef<HTMLElement>('info')
const media = useTemplateRef<HTMLElement>('media')
const userTitle = shallowRef(item.title)
const fieldsFor = (work: Case) => Object.fromEntries(work.variables.map(field => [field.key, field.value]))
const values = ref(fieldsFor(item))
const prompt = computed(() => expandPrompt(item, values.value))
const source = computed(() => item.reference ? researchLinks[item.reference] : undefined)
const before = shallowRef(false)
const fullSize = shallowRef(false)
const imageFailed = shallowRef(false)
const preview = computed(() => before.value && item.input ? item.input : { url: item.image, width: item.width, height: item.height })
const imageSource = computed(() => fullSize.value ? preview.value.url : imageView(preview.value.url, 'preview'))
const imageSources = computed(() => fullSize.value ? undefined : detailSources(preview.value))
const action = computed(() => item.pages ? '编辑模板' : item.start === 'upload' ? '用提示词改图' : '做同款')
const canEditArtwork = computed(() => !item.pages && item.start !== 'edit' && item.start !== 'upload')
const shapeLabel = computed(() => ({ portrait: '竖版', wide: '横版', square: '方形' }[item.ratio]))
const instructions = computed(() => {
  if (item.start === 'upload') return '进入工作台后上传你的原图。'
  if (item.start === 'edit') return '做同款时会带入改图前的原图和提示词。'
  if (item.presentation === 'slide-reference') return '可把这页作为参考图，继续生图或编辑。'
  if (item.pages) return '可编辑 3 页演示文稿并导出 PowerPoint。'
  return ''
})
const copied = shallowRef(false)
const copyError = shallowRef('')
onMounted(() => modal.value?.showModal())

watch(() => item.id, () => {
  userTitle.value = item.title
  values.value = fieldsFor(item)
  before.value = false
  fullSize.value = false
  copied.value = false
  copyError.value = ''
  scroller.value?.scrollTo(0, 0)
  info.value?.scrollTo(0, 0)
})
watch([() => preview.value.url, fullSize], () => {
  imageFailed.value = false
  media.value?.scrollTo(0, 0)
})

function step(direction: -1 | 1) {
  if (direction === -1 ? hasPrevious : hasNext && !loadingNext) emit('step', direction)
}

function shortcuts(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey ||
    (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, [contenteditable]'))) return
  if (fullSize.value && media.value?.contains(document.activeElement)) return
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  step(event.key === 'ArrowLeft' ? -1 : 1)
}

async function toggleFullSize() {
  fullSize.value = !fullSize.value
  await nextTick()
  if (fullSize.value) media.value?.focus({ preventScroll: true })
}

function selectCase(intent?: StudioDocument['intent']) {
  modal.value?.close()
  emit('choose', item, prompt.value, userTitle.value, intent)
}

async function copy() {
  copyError.value = ''
  try { await navigator.clipboard.writeText(prompt.value); copied.value = true }
  catch {
    const recipe = modal.value?.querySelector('.case-recipe')
    if (recipe) {
      const range = document.createRange()
      range.selectNodeContents(recipe)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }
    copyError.value = '已选中提示词，可用系统复制菜单。'
  }
}
</script>

<template>
  <dialog ref="modal" class="case-dialog" aria-labelledby="case-detail-title" @close="emit('close')"
    @click.self="modal?.close()" @keydown="shortcuts">
    <div class="case-view">
      <header class="case-view-bar">
        <p class="case-view-path"><span>灵感案例</span><span aria-hidden="true">/</span><span>{{ item.name }}</span></p>
        <div class="case-view-controls">
          <div v-if="hasPrevious || hasNext" class="case-navigation" role="group" aria-label="浏览案例">
            <button class="case-icon" type="button" aria-label="上一个案例" title="上一个案例" :aria-disabled="!hasPrevious" @click="step(-1)">
              <ChevronLeft :size="20" aria-hidden="true" />
            </button>
            <button class="case-icon" type="button" aria-label="下一个案例" title="下一个案例" :aria-disabled="!hasNext || loadingNext" @click="step(1)">
              <ChevronRight :size="20" aria-hidden="true" />
            </button>
          </div>
          <button class="case-icon case-close" type="button" aria-label="关闭案例" title="关闭案例" autofocus @click="modal?.close()">
            <X :size="20" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div ref="scroll-area" class="case-view-content">
        <figure class="case-stage">
          <div ref="media" class="case-media" :data-full-size="fullSize" :tabindex="fullSize ? 0 : undefined" aria-label="作品预览">
            <img v-show="!imageFailed" :src="imageSource" :srcset="imageSources" :sizes="fullSize ? undefined : detailSizes" decoding="async"
              :width="preview.width" :height="preview.height" :alt="before ? item.name + '，修改前的原图' : item.name"
              @load="imageFailed = false" @error="imageFailed = true">
            <p v-if="imageFailed" role="status">暂时无法显示这张图。<button type="button" class="sa-button" @click="toggleFullSize">
              {{ fullSize ? '载入预览' : '载入原图' }}
            </button></p>
          </div>
          <figcaption class="case-media-bar">
            <div v-if="item.input" class="case-image-switch" role="group" aria-label="改图效果对比">
              <button type="button" :aria-pressed="!before" @click="before = false">效果</button>
              <button type="button" :aria-pressed="before" @click="before = true">原图</button>
            </div>
            <span class="case-image-size">{{ preview.width }} × {{ preview.height }} 像素</span>
            <button class="case-image-zoom" type="button" :aria-pressed="fullSize" @click="toggleFullSize">
              <Minimize2 v-if="fullSize" :size="16" aria-hidden="true" /><Maximize2 v-else :size="16" aria-hidden="true" />
              {{ fullSize ? '适应窗口' : '查看原图' }}
            </button>
          </figcaption>
        </figure>

        <div ref="info" class="case-info">
          <div class="case-heading">
            <p>{{ item.subtitle }} <span aria-hidden="true">·</span> {{ shapeLabel }}</p>
            <h2 id="case-detail-title">{{ item.name }}</h2>
          </div>
          <p class="case-summary">{{ item.summary }}</p>
          <p v-if="instructions" class="case-usage">{{ instructions }}</p>
          <div v-if="item.variables.length || item.title" class="case-fields">
            <label v-for="field in item.variables" :key="field.key">{{ field.label }}
              <input v-model="values[field.key]" :name="field.key" type="text" maxlength="72" autocomplete="off">
            </label>
            <label v-if="item.title">画布标题
              <input v-model="userTitle" name="canvas-title" type="text" maxlength="28" autocomplete="off">
            </label>
          </div>
          <details :key="item.id + '-prompt'" class="case-disclosure">
            <summary>查看完整提示词 <ChevronDown :size="16" aria-hidden="true" /></summary>
            <p class="case-recipe">{{ prompt }}</p>
            <button type="button" class="sa-button" @click="copy"><Copy :size="15" aria-hidden="true" /> {{ copied ? '已复制' : '复制提示词' }}</button>
            <span role="status" :class="{ 'visually-hidden': !copyError }">{{ copyError || (copied ? '提示词已复制' : '') }}</span>
          </details>
          <details v-if="item.credit || source" :key="item.id + '-source'" class="case-disclosure case-attribution">
            <summary>作品来源 <ChevronDown :size="16" aria-hidden="true" /></summary>
            <template v-if="item.credit">
              <p><a :href="item.credit.url" target="_blank" rel="noopener">{{ item.credit.author }} <ArrowUpRight :size="12" aria-hidden="true" /></a> ·
                <a :href="item.credit.licenseUrl" target="_blank" rel="noopener">{{ item.credit.license }}</a></p>
              <p v-if="item.credit.originUrl || item.credit.originAuthor">构思
                <a v-if="item.credit.originUrl" :href="item.credit.originUrl" target="_blank" rel="noopener">{{ item.credit.originAuthor || '原作者作品' }}</a>
                <span v-else>{{ item.credit.originAuthor }}</span>
              </p>
              <p>{{ item.credit.changes }}</p>
            </template>
            <a v-else-if="source" :href="source.url" target="_blank" rel="noopener">{{ source.name }} <ArrowUpRight :size="12" aria-hidden="true" /></a>
          </details>
        </div>
      </div>

      <footer class="case-actions">
        <button v-if="canEditArtwork" type="button" class="sa-button case-edit-art" @click="selectCase('edit-current')">改这张图</button>
        <UButton type="button" class="sa-button sa-primary" @click="selectCase()">{{ action }} <ArrowUpRight :size="18" aria-hidden="true" /></UButton>
      </footer>
    </div>
  </dialog>
</template>
