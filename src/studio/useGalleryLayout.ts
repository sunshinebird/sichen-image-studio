import { shallowRef, watch, type CSSProperties, type Ref } from 'vue'
import type { Case } from './catalog'

const step = 4
export function useGalleryLayout(element: Readonly<Ref<HTMLElement | null>>) {
  const width = shallowRef(0)
  const captionSpace = shallowRef(96)
  watch(element, (node, _previous, cleanup) => {
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      const columns = Number(style.getPropertyValue('--portfolio-columns')) || 1
      const gap = parseFloat(style.columnGap) || 0
      const next = (node.clientWidth - (columns - 1) * gap) / columns
      if (next > 0) width.value = next
      captionSpace.value = parseFloat(style.getPropertyValue('--case-caption-space')) || 96
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    cleanup(() => observer.disconnect())
  }, { flush: 'post' })

  function layout(item: Case): CSSProperties {
    const aspect = Math.min(2.12, Math.max(0.72, item.width / item.height))
    const tile = Math.ceil(width.value / aspect / step) * step
    return {
      '--case-aspect': String(aspect),
      '--case-image-height': tile ? tile + 'px' : undefined,
      gridRowEnd: tile ? 'span ' + Math.ceil((tile + captionSpace.value) / step) : undefined,
    }
  }

  return { width, layout }
}
