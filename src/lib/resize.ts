/**
 * 拖拽调整相邻面板尺寸的小工具。
 *
 * 用法：在分隔条上 pointerdown 时调用，传入当前宽度与范围，
 * 拖动过程中 apply(width) 会被持续调用，松手时 onEnd(width)。
 */
export function dragColumn(
    e: PointerEvent | MouseEvent,
    option: {
        start: number
        min: number
        max: () => number
        apply: (width: number) => void
        onEnd?: (width: number) => void
    },
): void {
    const startX = e.clientX
    let last = option.start
    const clamp = (w: number) => {
        const max = Math.max(option.min, option.max())
        return Math.min(Math.max(w, option.min), max)
    }
    const move = (ev: PointerEvent) => {
        last = clamp(option.start + (ev.clientX - startX))
        option.apply(last)
    }
    const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        option.onEnd?.(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
}

/**
 * 垂直方向（高度）版本。
 */
export function dragRow(
    e: PointerEvent | MouseEvent,
    option: {
        start: number
        min: number
        max: () => number
        apply: (height: number) => void
        onEnd?: (height: number) => void
        /** 向上拖动时高度增加（用于底部面板） */
        inverted?: boolean
    },
): void {
    const startY = e.clientY
    let last = option.start
    const clamp = (h: number) => {
        const max = Math.max(option.min, option.max())
        return Math.min(Math.max(h, option.min), max)
    }
    const move = (ev: PointerEvent) => {
        const delta = ev.clientY - startY
        last = clamp(option.start + (option.inverted ? -delta : delta))
        option.apply(last)
    }
    const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        option.onEnd?.(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
}
