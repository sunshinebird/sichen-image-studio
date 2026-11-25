import { computed, shallowRef, type Ref } from 'vue'
import { studioApi, type ReferenceImage } from './api'
import type { StudioDocument } from './document'

export const referenceLimit = 2
const maxBytes = 10 * 1024 * 1024
export function validReferenceFile(file: File) {
  return file.size > 0 && file.size <= maxBytes && ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
}

export function useReferenceImages(doc: Ref<StudioDocument>, options: {
  ensureSession: () => Promise<void>
  updateSavedWork: (id: string, change: (previous: StudioDocument) => StudioDocument) => void
  saved: () => void
}) {
  const uploading = shallowRef<string>()
  const error = shallowRef<{ id: string; message: string }>()
  const references = computed(() => doc.value.references ?? [])
  const busy = computed(() => Boolean(uploading.value))
  const message = computed(() => error.value?.id === doc.value.id ? error.value.message : '')

  async function add(files: File[]) {
    const id = doc.value.id
    if (!files.length) return
    if (uploading.value) {
      error.value = { id, message: '另一张参考图正在保存，请稍等。' }
      return
    }
    const slots = referenceLimit - references.value.length
    if (!slots || files.length > slots) {
      error.value = { id, message: '每个作品最多添加 2 张参考图。' }
      return
    }
    if (files.some(file => !validReferenceFile(file))) {
      error.value = { id, message: '请选用 10 MB 以内的 PNG、JPEG 或 WebP。' }
      return
    }
    uploading.value = id
    error.value = undefined
    try {
      await options.ensureSession()
      for (const file of files) {
        const { asset } = await studioApi.uploadMedia(file)
        const next: ReferenceImage = { asset, name: file.name.slice(0, 120) }
        const change = (previous: StudioDocument) => {
          const existing = previous.references ?? []
          if (existing.some(item => item.asset.url === asset.url) || existing.length >= referenceLimit) return previous
          return { ...previous, references: [...existing, next] }
        }
        if (doc.value.id === id) {
          doc.value = change(doc.value)
          options.saved()
        } else {
          options.updateSavedWork(id, change)
        }
      }
    } catch (cause) {
      error.value = { id, message: cause instanceof Error ? cause.message : '参考图上传失败，请重新选择。' }
    } finally {
      if (uploading.value === id) uploading.value = undefined
    }
  }

  function remove(url: string) {
    doc.value = { ...doc.value, references: references.value.filter(item => item.asset.url !== url) }
    error.value = undefined
    options.saved()
  }

  return { references, busy, message, add, remove }
}
