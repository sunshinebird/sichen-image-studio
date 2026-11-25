import type { Case, CaseId, Ratio } from './catalog'
import { expandPrompt } from './catalog'
import type { ImageAsset, ReferenceImage } from './api'
import type { Framing } from './geometry'

export type TextColor = 'cream' | 'gold' | 'white' | 'ink'
export const textColors: Record<TextColor, string> = { cream: '#fff1d6', gold: '#f4c778', white: '#fff', ink: '#172c48' }
export interface Background extends Framing {
  color?: string
  brightness?: number
  contrast?: number
  saturation?: number
}
interface TextStyle {
  fill?: string
  bold?: boolean
  italic?: boolean
}
export interface CanvasItem {
  id: string
  type: 'text' | 'rectangle' | 'circle' | 'image'
  text?: string
  label?: string
  sourceUrl?: string
  x: number
  y: number
  width: number
  height: number
  angle: number
  color: TextColor
  visible: boolean
  font?: 'serif' | 'sans'
  align?: 'left' | 'center'
  locked?: boolean
  opacity?: number
  fill?: string
  bold?: boolean
  italic?: boolean
  flipX?: boolean
  flipY?: boolean
  asset?: ImageAsset
  fit?: 'cover' | 'contain'
}
export interface Layer {
  title: string
  subtitle: string
  color: TextColor
  x: number
  y: number
  textScale: number
  visible: boolean
  angle?: number
  subtitleX?: number
  subtitleY?: number
  subtitleAngle?: number
  subtitleScale?: number
  subtitleColor?: TextColor
  subtitleVisible?: boolean
  titleVisible?: boolean
  titleWidth?: number
  subtitleWidth?: number
  titleAlign?: 'left' | 'center'
  subtitleAlign?: 'left' | 'center'
  font?: 'serif' | 'sans'
  extras?: CanvasItem[]
  groups?: string[][]
  titleLocked?: boolean
  subtitleLocked?: boolean
  titleOpacity?: number
  subtitleOpacity?: number
  titleStyle?: TextStyle
  subtitleStyle?: TextStyle & { font?: CanvasItem['font'] }
  background?: Background
  repaired?: Record<string, ImageAsset>
}

export interface Slide {
  kind: 'cover' | 'features' | 'data'
  layer: Layer
  notes: string
  metrics: { label: string; value: number }[]
}

export interface StudioDocument {
  id: string
  caseId?: CaseId
  imported?: ImageAsset
  template?: Case
  name: string
  ratio: Ratio
  instructions: string
  editInstructions?: string
  intent?: 'create' | 'edit-current'
  style?: string
  references?: ReferenceImage[]
  pendingSubmission?: { key: string; startedAt: number }
  keepVersion?: boolean
  layer: Layer
  page: number
  slides?: Slide[]
  version?: string
  requestedVersion?: string
}

export function layerForImage(layer: Layer, url?: string) {
  return (layer.extras ?? []).some(item => item.sourceUrl && item.sourceUrl !== url)
    ? { ...layer, extras: layer.extras?.filter(item => !item.sourceUrl || item.sourceUrl === url) }
    : layer
}

export function workingImage(original: ImageAsset | null, layer: Layer) {
  return original ? layer.repaired?.[original.url] ?? original : null
}

function initialLayer(item?: Case): Layer {
  const lightCanvas = item?.category === 'slides' || item?.category === 'diagram' && item.id !== 'volcano'
  return {
    title: item?.title ?? '',
    subtitle: item?.tagline ?? '',
    color: lightCanvas ? 'ink' : 'cream',
    x: 9, y: item?.category === 'slides' ? 30 : 13,
    textScale: 1, visible: true,
    ...(item?.layout ?? {}),
  }
}

export function newDocument(item?: Case, prompt = '', ratio: Ratio = 'portrait', seedTitle?: string): StudioDocument {
  const layer = { ...initialLayer(item), ...(seedTitle !== undefined ? { title: seedTitle } : {}) }
  const supportingSlide = (title: string, subtitle: string): Layer => ({
    title, subtitle, color: 'ink', x: 9, y: 15, textScale: 1, visible: true,
  })
  const instructions = prompt || (item ? expandPrompt(item) : '')
  return {
    id: crypto.randomUUID(),
    caseId: item?.id,
    template: item,
    name: item?.name ?? (prompt.trim().split(/[，。！？\n]/)[0].slice(0, 22) || '新作品'),
    ratio: item?.ratio ?? ratio,
    instructions,
    intent: item?.start === 'edit' ? 'edit-current' : 'create',
    editInstructions: item?.start === 'edit' ? instructions : undefined,
    layer,
    page: 0,
    slides: item?.category === 'slides' && item.presentation !== 'slide-reference' ? [
      { kind: 'cover', layer: { ...layer }, notes: '', metrics: [] },
      { kind: 'features', layer: supportingSlide('提案要点', item.outline ? item.title : '为日常创造更好的体验'),
        notes: item.outline?.lines.join('\n') || '以使用场景为起点\n让关键体验更简单\n从设计细节到最终交付', metrics: [] },
      { kind: 'data', layer: supportingSlide(item.outline ? '方案进度' : '试用反馈', '示例数据 · 可编辑'), notes: '', metrics: item.outline?.metrics ?? [
        { label: '初次试用', value: 24 }, { label: '愿意推荐', value: 42 }, { label: '愿意再次使用', value: 58 },
      ] },
    ] : undefined,
  }
}

const draftKey = 'sichen.studio.draft.v1'
export function isStudioDocument(value: unknown): value is StudioDocument {
  if (!value || typeof value !== 'object') return false
  const doc = value as Partial<StudioDocument>
  return typeof doc.id === 'string' && typeof doc.name === 'string' && typeof doc.instructions === 'string' &&
    Boolean(doc.layer) && ['portrait', 'square', 'wide'].includes(doc.ratio ?? '')
}
export function readDraft(): StudioDocument | null {
  try {
    const doc: unknown = JSON.parse(localStorage.getItem(draftKey) || 'null')
    return isStudioDocument(doc) ? doc : null
  } catch { return null }
}

export function saveDraft(doc: StudioDocument) {
  try { localStorage.setItem(draftKey, JSON.stringify(doc)) } catch { /* private storage may be unavailable */ }
}
