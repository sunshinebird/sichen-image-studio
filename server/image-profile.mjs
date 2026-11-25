import { StudioError } from './store.mjs'

export const defaultImageModel = 'gpt-image-2.6-sunburst'
export const imageQuality = 'high'
export const imageSizes = {
  square: { auto: '1024x1024' },
  portrait: { auto: '1024x1536' },
  wide: { auto: '1536x1024' },
}

export function imageRequestProfile(ratio, resolution) {
  if (typeof ratio !== 'string' || !Object.hasOwn(imageSizes, ratio)) {
    throw new StudioError(400, '请选择可用的画布比例。', 'bad_ratio')
  }
  if (resolution != null && resolution !== 'auto') {
    throw new StudioError(400, '2K 和 4K 可在「导出作品」中选择。请刷新页面后重新生成。', 'bad_resolution')
  }
  return { resolution: 'auto', requestedSize: imageSizes[ratio].auto }
}
