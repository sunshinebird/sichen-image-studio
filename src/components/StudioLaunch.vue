<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import { ArrowDownRight, ArrowRight, ArrowUpRight, ImagePlus, Images, RectangleHorizontal, Sparkles, X } from 'lucide-vue-next'
import StudioSelect from './StudioSelect.vue'
import { ratioOptions, type Case, type Ratio } from '../studio/catalog'
import { galleryCoverSizes, gallerySources } from '../studio/imageView'
import { validReferenceFile } from '../studio/useReferenceImages'

const { featured, importing, importError, dailyLimit } = defineProps<{
  featured?: Case
  importing: boolean
  importError: string
  dailyLimit?: number
}>()
const emit = defineEmits<{
  featured: [item: Case]
  import: [file: File]
  create: [prompt: string, ratio: Ratio, references: File[]]
}>()

const examples = [
  { label: '商品主图', ratio: 'square', prompt: '拍一张青瓷茶具的商品主图。米白背景，柔和侧光，突出釉面质感，画面留白，无文字。' },
  { label: '活动海报', ratio: 'portrait', prompt: '设计一张周末市集海报。暖橙、奶白和深绿配色，手绘摊位和植物，使用清晰的中文标题「周末见」。' },
  { label: '演示封面', ratio: 'wide', prompt: '设计一张 16:9 演示封面，主题是旧城更新。右侧用城市街区摄影，左侧留白供排标题，画面无文字。' },
] satisfies { label: string; ratio: Ratio; prompt: string }[]
const idea = shallowRef('')
const ratio = shallowRef<Ratio>('portrait')
const references = shallowRef<File[]>([])
const mediaMessage = shallowRef('')
const promptError = shallowRef('')
const selectedExample = computed(() => examples.find(sample => sample.prompt === idea.value))
const prompt = useTemplateRef<HTMLTextAreaElement>('prompt')
const referenceInput = useTemplateRef<HTMLInputElement>('reference')
const importInput = useTemplateRef<HTMLInputElement>('image')

function useExample(sample: typeof examples[number]) {
  idea.value = sample.prompt
  ratio.value = sample.ratio
  promptError.value = ''
  prompt.value?.focus({ preventScroll: true })
}

function begin() {
  if (!idea.value.trim()) {
    promptError.value = '写一句想生成的图片，或选一个示例。'
    prompt.value?.focus()
    return
  }
  emit('create', idea.value.trim(), ratio.value, references.value)
}

function openImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!validReferenceFile(file)) {
    mediaMessage.value = '请选择 10 MB 以内的 PNG、JPEG 或 WebP。'
    return
  }
  mediaMessage.value = ''
  emit('import', file)
}

function addReferences(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  if (files.some(file => !validReferenceFile(file))) {
    mediaMessage.value = '参考图须为 10 MB 以内的 PNG、JPEG 或 WebP。'
    return
  }
  references.value = files.slice(0, 2)
  mediaMessage.value = files.length > 2 ? '已添加前 2 张参考图。' : ''
}
</script>

<template>
  <section class="sa-hero" aria-labelledby="studio-heading">
    <div class="sa-hero-copy">
      <p v-if="dailyLimit" class="sa-trial"><span aria-hidden="true"></span>免登录 · 每天免费 {{ dailyLimit }} 张</p>
      <h1 id="studio-heading">从一句话，<br><em>到一张好图</em></h1>
      <p class="sa-hero-note">用文字生成海报、商品图和演示封面。也可以上传自己的图，用对话改画面，再到画布里排版、导出。</p>

      <form class="sa-composer" @submit.prevent="begin">
        <label class="sa-prompt-label" for="gallery-prompt"><Sparkles :size="17" aria-hidden="true" /> 描述你想做的图</label>
        <textarea id="gallery-prompt" ref="prompt" v-model="idea" name="prompt" rows="2" maxlength="1200" autocomplete="off"
          placeholder="例如，一张暖色调的秋日咖啡海报…"
          :aria-invalid="Boolean(promptError)"
          :aria-describedby="promptError ? 'gallery-prompt-error' : undefined"
          @input="promptError = ''" @keydown.ctrl.enter.prevent="begin" @keydown.meta.enter.prevent="begin"></textarea>
        <p v-if="promptError" id="gallery-prompt-error" class="sa-form-message sa-alert" role="alert">{{ promptError }}</p>
        <div v-if="references.length" class="sa-upload-note">
          <span role="status">已添加 {{ references.length }} 张参考图</span>
          <button type="button" class="sa-clear" aria-label="清除参考图" @click="references = []; mediaMessage = ''">
            <X :size="14" aria-hidden="true" /> 清除
          </button>
        </div>
        <div class="sa-compose-bar">
          <div class="sa-quick">
            <button class="sa-tool" type="button" @click="referenceInput?.click()">
              <ImagePlus :size="16" aria-hidden="true" /> {{ references.length ? '更换参考图' : '添加参考图' }}
            </button>
            <input ref="reference" type="file" multiple accept="image/png,image/jpeg,image/webp" hidden @change="addReferences">
            <StudioSelect v-model="ratio" label="预选画布比例" :items="ratioOptions">
              <template #icon><RectangleHorizontal :size="16" aria-hidden="true" /></template>
            </StudioSelect>
          </div>
          <button type="submit" class="sa-button sa-primary">进入工作台 <ArrowRight :size="17" aria-hidden="true" /></button>
        </div>
      </form>

      <div class="sa-examples" role="group" aria-label="填入示例描述">
        <span>试试</span>
        <button v-for="sample in examples" :key="sample.label" type="button" :aria-label="'填入' + sample.label + '示例'"
          :aria-pressed="sample === selectedExample" @click="useExample(sample)">{{ sample.label }}</button>
      </div>
      <div class="sa-start-actions">
        <button type="button" class="sa-start-action" :disabled="importing" @click="importInput?.click()">
          <span class="sa-start-icon"><ImagePlus :size="19" aria-hidden="true" /></span>
          <span><strong>{{ importing ? '正在打开…' : '上传图片编辑' }}</strong><small>改画面、加文字</small></span>
          <ArrowUpRight :size="16" aria-hidden="true" />
        </button>
        <input ref="image" type="file" accept="image/png,image/jpeg,image/webp" hidden @change="openImage">
        <a class="sa-start-action" href="#sa-gallery-title">
          <span class="sa-start-icon"><Images :size="19" aria-hidden="true" /></span>
          <span><strong>从案例做同款</strong><small>带入提示词与画布</small></span>
          <ArrowDownRight :size="16" aria-hidden="true" />
        </a>
      </div>
      <p v-if="importError || mediaMessage" class="sa-form-message" role="status">{{ importError || mediaMessage }}</p>
    </div>

    <button v-if="featured" type="button" class="sa-feature sa-media" :aria-label="featured.name + '，查看精选案例'"
      @click="emit('featured', featured)">
      <span class="sa-feature-art">
        <img :src="featured.image" :srcset="gallerySources(featured.image, featured.width, true)" :sizes="galleryCoverSizes"
          alt="" :width="featured.width" :height="featured.height" fetchpriority="high">
        <span class="sa-feature-tag">精选案例</span>
      </span>
      <span class="sa-feature-footer">
        <span><small>{{ featured.subtitle }}</small><strong>{{ featured.name }}</strong></span>
        <span class="sa-feature-cta">查看案例 <ArrowUpRight :size="16" aria-hidden="true" /></span>
      </span>
    </button>
    <div v-else class="sa-feature sa-feature-loading" aria-hidden="true"></div>
  </section>
</template>
