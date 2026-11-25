import { computed, onBeforeUnmount, shallowRef, watch, type Ref } from 'vue'
import { studioApi, type DetectedText, type ImageAsset, type SelectedSubject, type SubjectCandidate, type SubjectPoint, type TextRepair } from './api'
import type { MaskPoint, Rect } from './geometry'

export type ImageTool = 'text' | 'subject'
type Scan = { token: string; lines: DetectedText[] }
type Subject = { token: string; candidates: SubjectCandidate[] }

export function useImageTools(source: Readonly<Ref<ImageAsset | null>>, commit: {
  text: (repair: TextRepair, value: string) => void
  subject: (asset: ImageAsset, box: Rect, background?: ImageAsset) => void
}) {
  const tool = shallowRef<ImageTool | null>(null)
  const action = shallowRef<'scan' | 'point' | 'save' | null>(null)
  const error = shallowRef('')
  const textResult = shallowRef<Scan>()
  const textIndex = shallowRef(-1)
  const replacement = shallowRef('')
  const subjectResult = shallowRef<Subject>()
  const candidateIndex = shallowRef(0)
  const points = shallowRef<SubjectPoint[]>([])
  const include = shallowRef(true)
  const currentCandidate = computed(() => subjectResult.value?.candidates[candidateIndex.value])
  let request: AbortController | undefined

  function stop() {
    request?.abort()
    request = undefined
    action.value = null
    tool.value = null
    error.value = ''
    textResult.value = undefined
    textIndex.value = -1
    replacement.value = ''
    resetPoints()
  }

  function resetPoints() {
    points.value = []
    include.value = true
    subjectResult.value = undefined
    candidateIndex.value = 0
    error.value = ''
  }

  async function perform<T>(
    kind: NonNullable<typeof action.value>,
    fetchResult: (url: string, signal: AbortSignal) => Promise<T>,
    accept: (result: T) => void,
  ) {
    const url = source.value?.url
    if (!url || action.value) return
    const controller = new AbortController()
    request = controller
    action.value = kind
    error.value = ''
    try {
      const result = await fetchResult(url, controller.signal)
      if (request === controller && source.value?.url === url) accept(result)
    } catch (cause) {
      if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '分析失败，请重试。'
    } finally {
      if (request === controller) {
        request = undefined
        action.value = null
      }
    }
  }

  function scan() {
    textResult.value = undefined
    textIndex.value = -1
    return perform('scan', studioApi.scanText, result => { textResult.value = result })
  }

  function open(next: ImageTool) {
    if (action.value) return
    if (tool.value === next) return
    stop()
    tool.value = next
    if (next === 'text') void scan()
  }

  function selectText(index: number) {
    const line = textResult.value?.lines[index]
    if (!line || action.value) return
    textIndex.value = index
    replacement.value = line.text
    error.value = ''
  }

  function changeText() {
    const token = textResult.value?.token
    if (!token || textIndex.value < 0) return
    const index = textIndex.value
    const value = replacement.value.trim()
    return perform('save', (url, signal) => studioApi.repairText(url, token, index, signal), result => commit.text(result, value))
  }

  function selectPoint(point: MaskPoint) {
    if (action.value || points.value.length === 6 || (!include.value && !points.value.some(item => item.include))) return
    const next = [...points.value, { ...point, include: include.value }]
    points.value = next
    subjectResult.value = undefined
    return perform('point', (url, signal) => studioApi.selectSubject(url, next, signal), result => {
      subjectResult.value = result
      candidateIndex.value = 0
    })
  }

  function selection(): SelectedSubject | undefined {
    const sourceUrl = source.value?.url
    const token = subjectResult.value?.token
    if (sourceUrl && token && currentCandidate.value) return { kind: 'subject', source: sourceUrl, token, index: candidateIndex.value }
  }

  function extract(fill: boolean) {
    const target = selection()
    if (!target) return
    return perform('save', (url, signal) => studioApi.extractSubject(url, target.token, target.index, fill, signal),
      result => commit.subject(result.asset, result.box, result.background))
  }

  watch(() => source.value?.url, stop)
  onBeforeUnmount(stop)

  return {
    tool, action, error, textResult, textIndex, replacement, subjectResult, candidateIndex, points, include, currentCandidate,
    stop, resetPoints, open, scan, selectText, changeText, selectPoint, extract, selection,
  }
}
