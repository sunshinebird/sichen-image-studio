export type ArrangeAction = 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom' | 'space-x' | 'space-y'
type Box = { left: number; top: number; width: number; height: number }

export function arrangeLayers(boxes: Box[], action: ArrangeAction) {
  if (boxes.length < 2) return []
  const horizontal = ['left', 'center-x', 'right', 'space-x'].includes(action)
  const ranges = boxes.map(box => ({
    start: horizontal ? box.left : box.top,
    size: horizontal ? box.width : box.height,
  }))
  const start = Math.min(...ranges.map(item => item.start))
  const end = Math.max(...ranges.map(item => item.start + item.size))
  let offsets: number[]

  if (action === 'space-x' || action === 'space-y') {
    if (ranges.length < 3) return []
    const ordered = ranges.map((item, index) => ({ ...item, index })).sort((a, b) => a.start - b.start)
    const gap = (end - start - ordered.reduce((sum, item) => sum + item.size, 0)) / (ordered.length - 1)
    offsets = Array<number>(ranges.length)
    let position = start
    for (const item of ordered) {
      offsets[item.index] = position - item.start
      position += item.size + gap
    }
  } else {
    offsets = ranges.map(item => {
      if (action === 'left' || action === 'top') return start - item.start
      if (action === 'right' || action === 'bottom') return end - item.start - item.size
      return (start + end - item.size) / 2 - item.start
    })
  }

  return offsets.map(delta => horizontal ? { x: delta, y: 0 } : { x: 0, y: delta })
}
