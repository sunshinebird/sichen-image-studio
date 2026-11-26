type ImageView = 'thumb' | 'card' | 'card-hd' | 'cover' | 'preview' | 'detail'

export function imageView(url: string, view: ImageView) {
  const path = url.startsWith('/art/') && url.endsWith('.webp')
    ? '/api/cases/art/' + url.slice(5, -5)
    : url
  return /^\/api\/(assets|media|cases\/(art|reference))\/[a-z0-9-]+$/.test(path)
    ? path + '?view=' + view
    : url
}

export const galleryCardSizes = '(max-width: 355px) 91vw, (max-width: 720px) 46vw, (max-width: 1120px) 30vw, (max-width: 1664px) 23vw, (max-width: 2190px) 380px, min(442px, 17.3vw)'
export const galleryCoverSizes = '(max-width: 800px) 94vw, (max-width: 1664px) 47vw, (max-width: 2190px) 780px, min(920px, 36vw)'
export const detailSizes = '(max-width: 760px) calc(100vw - 28px), (max-width: 1608px) 68vw, (max-width: 2137px) 1075px, min(1395px, calc(73vw - 486px))'

export function gallerySources(url: string, width: number, cover = false) {
  if (width <= 384) return undefined
  const large = cover && width <= 768 ? url : imageView(url, 'card-hd')
  const sources = [`${imageView(url, 'card')} 384w`, `${large} ${Math.min(768, width)}w`]
  if (cover && width > 768) sources.push(`${imageView(url, 'cover')} ${Math.min(1280, width)}w`)
  return sources.join(', ')
}

export function detailSources(asset: { url: string; width: number; height: number }) {
  const longest = Math.max(asset.width, asset.height)
  const sources = new Map<number, string>()
  const variants = [['card-hd', 768], ['preview', 1280], ['detail', 1792]] as const
  for (const [view, edge] of variants) {
    const width = view === 'card-hd'
      ? Math.min(asset.width, edge)
      : Math.round(asset.width * Math.min(1, edge / longest))
    if (view === 'card-hd' && longest > 1280 && width >= Math.round(asset.width * 1280 / longest)) continue
    if (!sources.has(width)) sources.set(width, imageView(asset.url, view))
  }
  return [...sources].map(([width, url]) => url + ' ' + width + 'w').join(', ')
}
