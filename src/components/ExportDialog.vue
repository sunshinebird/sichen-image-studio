<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import { Download } from 'lucide-vue-next'
import type { ImageAsset } from '../studio/api'
import type { Clarity } from '../studio/catalog'
import type { Layer, Slide, StudioDocument } from '../studio/document'
import { exportImage, exportPresentation, outputSize } from '../studio/export'
import { fittingPixels, frameAspect } from '../studio/geometry'

const props = defineProps<{
  signal: number; document: StudioDocument; picture: ImageAsset | null; layer: Layer; slide?: Slide; coverLayer: Layer
  versionLabel?: string
}>()
const modal = useTemplateRef<HTMLDialogElement>('modal')
const format = shallowRef<'png' | 'jpeg' | 'pptx'>(props.document.slides ? 'pptx' : 'png')
const clarity = shallowRef<Clarity>('auto')
const busy = shallowRef(false)
const error = shallowRef('')
const currentImage = computed(() => props.slide && props.slide.kind !== 'cover' ? null : props.picture)
const pageLabels: Record<Slide['kind'], string> = { cover: '封面', features: '介绍页', data: '数据页' }
const imageName = computed(() => {
  const suffix = props.slide ? pageLabels[props.slide.kind] : props.versionLabel
  return suffix ? props.document.name + ' - ' + suffix : props.document.name
})
const saveName = computed(() => format.value === 'pptx' ? props.document.name + '.pptx'
  : imageName.value + (format.value === 'jpeg' ? '.jpg' : '.png'))
const size = computed(() => outputSize(props.document.ratio, clarity.value, currentImage.value, props.layer.background, Boolean(props.slide)))
const upscaled = computed(() => {
  const asset = currentImage.value
  if (!asset) return false
  const aspect = frameAspect(props.document.ratio, asset, props.layer.background, Boolean(props.slide))
  const [width, height] = fittingPixels(asset, aspect, props.layer.background)
  return size.value[0] > width + 1 || size.value[1] > height + 1
})

watch(() => props.signal, () => { error.value = ''; modal.value?.showModal() })

async function download() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    if (format.value === 'pptx' && props.document.slides) {
      const pages = props.document.slides.map(page => page.kind === 'cover' ? { ...page, layer: props.coverLayer } : page)
      await exportPresentation(props.document.name, pages, props.picture)
    } else if (format.value !== 'pptx') {
      await exportImage({
        name: imageName.value, ratio: props.document.ratio, asset: props.picture,
        layer: props.layer, tone: props.document.caseId ?? '', clarity: clarity.value, format: format.value, slide: props.slide,
      })
    }
    modal.value?.close()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导出失败，请重试。'
  } finally { busy.value = false }
}
</script>

<template>
  <dialog ref="modal" class="wb-export" aria-labelledby="export-title" @click.self="!busy && modal?.close()" @cancel="busy && $event.preventDefault()">
    <div class="wb-export-heading">
      <h2 id="export-title">导出作品</h2>
      <button type="button" class="wb-button wb-close" aria-label="关闭导出" :disabled="busy" @click="modal?.close()">×</button>
    </div>
    <div class="wb-export-fields">
      <label>文件格式
        <select v-model="format" name="format" aria-label="文件格式" :disabled="busy">
          <option value="png">PNG</option><option value="jpeg">JPEG</option>
          <option v-if="document.slides" value="pptx">可编辑 PowerPoint</option>
        </select>
      </label>
      <label v-if="format !== 'pptx'">导出尺寸
        <select v-model="clarity" name="clarity" :disabled="busy"><option value="auto">自动（推荐）</option><option value="2k">2K</option><option value="4k">4K</option></select>
      </label>
    </div>
    <div v-if="format !== 'pptx' && currentImage" class="wb-export-meta">
      <span>原图尺寸</span>
      <strong>{{ currentImage.width }} × {{ currentImage.height }} 像素</strong>
    </div>
    <div class="wb-export-meta">
      <span>{{ format === 'pptx' ? '保留文字与图表' : upscaled ? '放大导出' : '输出尺寸' }}</span>
      <strong>{{ format === 'pptx' ? (document.slides?.length ?? 0) + ' 页' : size.join(' × ') + ' 像素' }}</strong>
    </div>
    <p v-if="format === 'pptx'" class="wb-help">导出全部页面，打开 PowerPoint 后仍可修改文字和图表。</p>
    <p v-else-if="document.slides" class="wb-help">将当前页面保存为一张图片。</p>
    <p v-if="format !== 'pptx' && upscaled" class="wb-help">已放大到所选尺寸，原图细节不会增加。</p>
    <p class="wb-export-filename" :title="saveName">{{ saveName }}</p>
    <p v-if="error" class="wb-error" role="alert">{{ error }}</p>
    <button type="button" class="wb-button wb-primary wb-export-done" :disabled="busy" @click="download"><Download :size="15" /> {{ busy ? '正在导出…' : '下载文件' }}</button>
  </dialog>
</template>
