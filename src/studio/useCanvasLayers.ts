import { computed, shallowRef, watch, type Ref } from 'vue'
import type { Ratio } from './catalog'
import { layerForImage, type CanvasItem, type Layer, type Slide } from './document'
import type { ImageAsset } from './api'

export const headingSize = (ratio: Ratio) => ratio === 'wide' ? 7.7 : 8.008
const headingItem = (layer: Layer, ratio: Ratio): CanvasItem => ({
  id: 'title', type: 'text', text: layer.title, x: layer.x, y: layer.y, width: layer.titleWidth ?? 78,
  height: headingSize(ratio) * layer.textScale, angle: layer.angle ?? 0, color: layer.color,
  visible: layer.visible && (layer.titleVisible ?? true), font: layer.font ?? 'serif', align: layer.titleAlign,
  locked: layer.titleLocked, opacity: layer.titleOpacity, ...layer.titleStyle,
})
const subtitleItem = (layer: Layer): CanvasItem => ({
  id: 'subtitle', type: 'text', text: layer.subtitle, x: layer.subtitleX ?? 9, y: layer.subtitleY ?? 87.4,
  width: layer.subtitleWidth ?? 78, height: 3.5 * (layer.subtitleScale ?? 1), angle: layer.subtitleAngle ?? 0,
  color: layer.subtitleColor ?? (layer.color === 'ink' ? 'ink' : 'cream'),
  visible: layer.visible && (layer.subtitleVisible ?? true), font: 'sans', align: layer.subtitleAlign,
  locked: layer.subtitleLocked, opacity: layer.subtitleOpacity, ...layer.subtitleStyle,
})

export function canvasLayers(layer: Layer, ratio: Ratio) {
  return [headingItem(layer, ratio), subtitleItem(layer), ...(layer.extras ?? [])]
}

export function canMoveTogether(item: CanvasItem) {
  return item.visible && !item.locked && (item.type !== 'text' || Boolean(item.text))
}

export type SlideContent = Pick<Slide, 'notes' | 'metrics'>

export function useCanvasLayers(layer: Readonly<Ref<Layer>>, ratio: Readonly<Ref<Ratio>>, page: Readonly<Ref<number>>, change: (layer: Layer, content?: SlideContent) => void,
  aspect: Readonly<Ref<number>>, source: Readonly<Ref<string | undefined>>, content: Readonly<Ref<SlideContent | undefined>>) {
  type Snapshot = { layer: Layer; selected: string[]; content?: SlideContent }
  const histories = new Map<number, { past: Snapshot[]; future: Snapshot[]; selected: string[] }>()
  const past = shallowRef<Snapshot[]>([])
  const future = shallowRef<Snapshot[]>([])
  const selected = shallowRef<string[]>(['title'])
  const entries = computed(() => canvasLayers(layerForImage(layer.value, source.value), ratio.value)
    .filter(item => (item.id !== 'title' && item.id !== 'subtitle') || item.text))
  const current = computed(() => selected.value.length === 1 ? entries.value.find(item => item.id === selected.value[0]) : undefined)
  const movable = computed(() => entries.value.filter(item => canMoveTogether(item) && selected.value.includes(item.id)))
  const selectedGroup = computed(() => (layer.value.groups ?? []).find(ids =>
    ids.length === selected.value.length && ids.every(id => selected.value.includes(id)),
  ))
  let last: { key: string; time: number } | undefined

  function snapshot(): Snapshot {
    return { layer: layer.value, selected: selected.value, content: content.value }
  }

  function apply(next: Layer, key?: string, nextContent = content.value) {
    if (JSON.stringify(next) === JSON.stringify(layer.value) && JSON.stringify(nextContent) === JSON.stringify(content.value)) return
    const now = performance.now()
    const group = key !== undefined && last?.key === key && now - last.time < 700
    if (!group) past.value = [...past.value, snapshot()].slice(-60)
    future.value = []
    last = key === undefined ? undefined : { key, time: now }
    change(next, nextContent)
  }

  function updateContent(patch: Partial<SlideContent>, key: string) {
    if (content.value) apply(layer.value, key, { ...content.value, ...patch })
  }

  function select(ids: string | string[]) {
    const next = typeof ids === 'string' ? [ids] : [...new Set(ids)]
    if (next.length === selected.value.length && next.every(id => selected.value.includes(id))) return
    selected.value = next
    last = undefined
  }

  function pickLayer(id: string, extend: boolean) {
    if (!extend) { select(id); return }
    const item = entries.value.find(item => item.id === id)
    if (!item || !canMoveTogether(item)) return
    select(selected.value.includes(id)
      ? selected.value.filter(previous => previous !== id)
      : [...movable.value.map(item => item.id), id])
  }

  function selectGroup(id: string) {
    const group = layer.value.groups?.find(ids => ids.includes(id))
    if (!group) return
    const members = entries.value.filter(item => group.includes(item.id) && canMoveTogether(item))
    if (members.length > 1) select(members.map(item => item.id))
  }

  function toggleGroup() {
    if (selectedGroup.value) {
      apply({ ...layer.value, groups: layer.value.groups?.filter(ids => ids !== selectedGroup.value) })
      return
    }
    if (movable.value.length < 2) return
    const ids = movable.value.map(item => item.id)
    const groups = (layer.value.groups ?? []).map(other => other.filter(id => !ids.includes(id))).filter(other => other.length > 1)
    apply({ ...layer.value, groups: [...groups, ids] })
  }

  function patchItem(data: Layer, item: CanvasItem): Layer {
    if (item.id === 'title') {
      return {
        ...data, title: item.text ?? '', color: item.color, x: item.x, y: item.y, angle: item.angle,
        textScale: item.height / headingSize(ratio.value), titleVisible: item.visible,
        titleWidth: item.width, titleAlign: item.align, font: item.font, titleLocked: item.locked, titleOpacity: item.opacity,
        titleStyle: { fill: item.fill, bold: item.bold, italic: item.italic },
      }
    }
    if (item.id === 'subtitle') {
      return {
        ...data, subtitle: item.text ?? '', subtitleColor: item.color, subtitleX: item.x, subtitleY: item.y,
        subtitleAngle: item.angle, subtitleScale: item.height / 3.5, subtitleVisible: item.visible,
        subtitleWidth: item.width, subtitleAlign: item.align, subtitleLocked: item.locked, subtitleOpacity: item.opacity,
        subtitleStyle: { fill: item.fill, bold: item.bold, italic: item.italic, font: item.font },
      }
    }
    return { ...data, extras: (data.extras ?? []).map(previous => previous.id === item.id ? item : previous) }
  }

  function update(item: CanvasItem, key?: string) {
    apply(patchItem(layer.value, item), key)
  }

  function updateMany(items: CanvasItem[], key?: string) {
    if (items.length) apply(items.reduce(patchItem, layer.value), key)
  }

  function patch(values: Partial<CanvasItem>, coalesce?: string) {
    const item = current.value
    if (item) update({ ...item, ...values }, coalesce ? item.id + ':' + coalesce : undefined)
  }

  function add(type: Exclude<CanvasItem['type'], 'image'>) {
    const extras = layer.value.extras ?? []
    if (extras.length >= 24) return
    const item: CanvasItem = {
      id: crypto.randomUUID(), type, x: 28, y: 44, angle: 0, visible: true,
      width: type === 'text' ? 45 : 21, height: type === 'text' ? 5.5 : type === 'circle' ? 21 * aspect.value : 13,
      color: 'ink', ...(type === 'text' ? { text: '添加文字', font: 'sans' as const } : {}),
    }
    apply({ ...layer.value, extras: [...extras, item] })
    select(item.id)
  }

  function addImage(asset: ImageAsset) {
    const extras = layer.value.extras ?? []
    if (extras.length >= 24) return
    const boardRatio = aspect.value
    const imageAspect = asset.width / asset.height
    const width = Math.min(48, 56 * imageAspect / boardRatio)
    const item: CanvasItem = {
      id: crypto.randomUUID(), type: 'image', asset, x: 26, y: 28, angle: 0,
      visible: true, color: 'cream', width, height: width * boardRatio / imageAspect, fit: 'cover',
    }
    apply({ ...layer.value, extras: [...extras, item] })
    select(item.id)
  }

  function replaceImage(id: string, asset: ImageAsset) {
    const item = entries.value.find(entry => entry.id === id)
    if (item?.type === 'image' && !item.locked) update({ ...item, asset })
  }

  function duplicate() {
    const item = current.value
    const extras = layer.value.extras ?? []
    if (!item || extras.length >= 24 || item.type === 'text' && !item.text) return
    const copy = { ...item, id: crypto.randomUUID(), x: Math.min(88, item.x + 3), y: Math.min(90, item.y + 5) }
    apply({ ...layer.value, extras: [...extras, copy] })
    select(copy.id)
  }

  function remove() {
    const ids = entries.value.filter(item => selected.value.includes(item.id) && !item.locked).map(item => item.id)
    if (!ids.length) return
    const next: Layer = {
      ...layer.value,
      extras: (layer.value.extras ?? []).filter(item => !ids.includes(item.id)),
    }
    if (ids.includes('title')) next.titleVisible = false
    if (ids.includes('subtitle')) next.subtitleVisible = false
    if (layer.value.groups) {
      next.groups = layer.value.groups.map(group => group.filter(id => !ids.includes(id))).filter(group => group.length > 1)
    }
    apply(next)
    if (selected.value.length > 1 || !ids.some(id => id === 'title' || id === 'subtitle')) select([])
  }

  function stack(direction: number) {
    const extras = [...(layer.value.extras ?? [])]
    const index = extras.findIndex(item => item.id === current.value?.id)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= extras.length) return
    const [item] = extras.splice(index, 1)
    extras.splice(nextIndex, 0, item)
    apply({ ...layer.value, extras })
  }

  function undo() {
    const previous = past.value.at(-1)
    if (!previous) return
    future.value = [snapshot(), ...future.value]
    past.value = past.value.slice(0, -1)
    last = undefined
    change(previous.layer, previous.content)
    select(previous.selected)
  }

  function redo() {
    const next = future.value[0]
    if (!next) return
    past.value = [...past.value, snapshot()]
    future.value = future.value.slice(1)
    last = undefined
    change(next.layer, next.content)
    select(next.selected)
  }

  function align(center: boolean) {
    const item = current.value
    if (!item) return
    patch({ x: center ? Math.max(1, (100 - item.width) / 2) : 9, align: center ? 'center' : 'left' })
  }

  function nudge(dx: number, dy: number) {
    const items = movable.value
    if (!items.length) return
    // Stop the whole selection at a boundary so that offsets between items stay fixed.
    if (items.some(item => item.x + dx < -35 || item.x + dx > 98 || item.y + dy < -28 || item.y + dy > 98)) return
    updateMany(items.map(item => ({ ...item, x: item.x + dx, y: item.y + dy })), 'nudge:' + selected.value.join(','))
  }

  watch(page, (nextPage, oldPage) => {
    histories.set(oldPage, { past: past.value, future: future.value, selected: selected.value })
    const next = histories.get(nextPage)
    past.value = next?.past ?? []
    future.value = next?.future ?? []
    last = undefined
    select(next?.selected ?? 'title')
  }, { flush: 'sync' })
  watch(source, () => {
    histories.clear()
    past.value = []
    future.value = []
    last = undefined
    select('title')
  }, { flush: 'sync' })
  watch(entries, next => select(selected.value.filter(id => next.some(item => item.id === id))), { immediate: true })

  return { entries, selected, current, movable, selectedGroup, past, future, select, pickLayer, selectGroup, toggleGroup,
    apply, updateContent, update, updateMany, patch, add, addImage, replaceImage, duplicate, remove, stack, undo, redo, align, nudge }
}
