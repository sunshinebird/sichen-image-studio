import seed from '../../content/cases.json'
import type { ImageAsset } from './api'
import type { Layer } from './document'

export type Ratio = 'portrait' | 'square' | 'wide'
export type Clarity = 'auto' | '2k' | '4k'
export type CaseId = string
export type Category = 'product' | 'poster' | 'slides' | 'diagram' | 'story' | 'retouch' | 'brand'
export interface CaseVariable { key: string; label: string; value: string }
export interface CaseCredit {
  author: string
  collection: string
  url: string
  license: string
  licenseUrl: string
  changes: string
  originAuthor?: string
  originUrl?: string
  model?: string
}

export interface Case {
  id: CaseId
  name: string
  subtitle: string
  title: string
  tagline: string
  category: Category
  industry: string
  ratio: Ratio
  prompt: string
  variables: CaseVariable[]
  summary: string
  tags: string[]
  reference?: string
  publishedAt: string
  width: number
  height: number
  image: string
  thumbnail?: string
  model?: string
  collection?: string
  layout?: Partial<Layer>
  outline?: { lines: string[]; metrics: { label: string; value: number }[] }
  featured?: boolean
  pages?: number
  credit?: CaseCredit
  input?: ImageAsset
  start?: 'generate' | 'edit' | 'upload'
  presentation?: 'image' | 'slide-reference'
}

export const categories: { id: 'all' | Category; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'product', label: '商品图' }, { id: 'poster', label: '海报' },
  { id: 'slides', label: '演示文稿' }, { id: 'diagram', label: '信息图' }, { id: 'story', label: '分镜' },
  { id: 'retouch', label: '参考改图' }, { id: 'brand', label: '品牌创意' },
]
export const ratioLabels: Record<Ratio, string> = { portrait: '4:5', square: '1:1', wide: '16:9' }
export const ratioOptions: { value: Ratio; label: string; detail: string }[] = [
  { value: 'portrait', label: ratioLabels.portrait, detail: '竖版' },
  { value: 'square', label: ratioLabels.square, detail: '方形' },
  { value: 'wide', label: ratioLabels.wide, detail: '横版' },
]
export const aspectValues: Record<Ratio, number> = { portrait: 4 / 5, square: 1, wide: 16 / 9 }
export const researchLinks: Record<string, { name: string; url: string }> = {
  'openai-prompting': { name: 'OpenAI 图像提示指南', url: 'https://developers.openai.com/api/docs/guides/image-prompting' },
  'openai-edit': { name: 'OpenAI 参考图与局部编辑示例', url: 'https://developers.openai.com/api/docs/guides/image-prompting' },
  'open-prompts': { name: 'Open Prompts 分镜案例', url: 'https://www.open-prompts.com/zh/image-prompts/popcorn-storyboard-3f77204b' },
  youmind: { name: 'YouMind OpenLab 案例库', url: 'https://github.com/YouMind-OpenLab/awesome-gpt-image-2' },
}

export function getCase(id: CaseId | undefined): Case | undefined {
  const item = (seed as Omit<Case, 'image'>[]).find(row => row.id === id)
  if (item) return { ...item, image: '/art/' + item.id + '.webp' }
}

export function expandPrompt(item: Case, fields: Record<string, string> = {}) {
  const prompt = item.prompt.replace(/\{\{([^{}]+)\}\}/g, (_match, key: string) =>
    fields[key]?.trim() || item.variables.find(field => field.key === key)?.value || '')
  return /简体中文|不绘制文字|不生成文字|不在底图生成文字|不添加文字/.test(prompt) ? prompt
    : prompt + ' 如需在画面中放文字，请全部使用简体中文；不添加英文、拼音、外文商标或水印。'
}

export interface CasePage {
  items: Case[]
  featured: Case
  industries: string[]
  counts: { total: number; matches: number }
  revision: string
  nextCursor: string | null
}
