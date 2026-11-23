/**
 * LinkAndroid 已安装版本补丁：新建任务弹窗里的面板分隔条
 *
 * 两条可拖动边界：
 *   1. 代码编辑器 / 右侧面板
 *   2. 手机预览 / 无障碍树
 *
 * 实现方式：在相邻两列的边界上铺一条透明的拖拽层（不改动 Vue 的 DOM 结构），
 * 拖动时直接改左列的内联宽度，右列用 flex 吃掉剩余空间；尺寸记在 localStorage。
 * 对应源码 src/lib/resize.ts + TaskEditorDialog.vue / TaskDevicePreviewPanel.vue。
 */
;(() => {
    if (window.__laResizePanes) return

    const MIN_LEFT = 280
    const MIN_RIGHT = 320
    const MIN_PREVIEW = 220

    const saved = (key, fallback) => {
        try {
            const v = Number(window.localStorage.getItem(key))
            return Number.isFinite(v) && v > 0 ? v : fallback
        } catch (e) {
            return fallback
        }
    }

    const persist = (key, value) => {
        try {
            window.localStorage.setItem(key, String(Math.round(value)))
        } catch (e) {}
    }

    const createHandle = (row, opts) => {
        const {left, right, minLeft, minRight, storageKey} = opts
        if (row.querySelector(':scope > .la-split-v')) return
        if (getComputedStyle(row).position === 'static') row.style.position = 'relative'

        const handle = document.createElement('div')
        handle.className = 'la-split-v'
        handle.dataset.laKey = storageKey
        handle.style.cssText =
            'position:absolute;top:0;bottom:0;width:7px;z-index:6;cursor:col-resize;' +
            'transform:translateX(-3px);background:transparent;transition:background .12s'
        handle.title = '拖动调整宽度，双击复位'

        const place = () => {
            handle.style.left = left.getBoundingClientRect().width + 'px'
        }

        handle.addEventListener('mouseenter', () => {
            handle.style.background = 'rgba(59,130,246,.35)'
        })
        handle.addEventListener('mouseleave', () => {
            if (!handle.dataset.dragging) handle.style.background = 'transparent'
        })

        const applyWidth = (w) => {
            left.style.flex = '0 0 ' + Math.round(w) + 'px'
            right.style.flex = '1 1 0%'
            right.style.minWidth = '0'
            left.dataset.laCustom = '1'
            place()
        }

        /** 窗口变小时把绝对宽度收回到可用范围内，保证右侧面板不被挤没 */
        const fitToRow = () => {
            if (left.dataset.laCustom !== '1') return place()
            const rowWidth = row.getBoundingClientRect().width
            const max = Math.max(minLeft, rowWidth - minRight)
            if (left.getBoundingClientRect().width > max) {
                left.style.flex = '0 0 ' + Math.round(max) + 'px'
            }
            place()
        }

        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault()
            handle.dataset.dragging = '1'
            const startX = e.clientX
            const startWidth = left.getBoundingClientRect().width
            const rowWidth = row.getBoundingClientRect().width
            const clamp = (w) => Math.min(Math.max(w, minLeft), Math.max(minLeft, rowWidth - minRight))
            const move = (ev) => applyWidth(clamp(startWidth + (ev.clientX - startX)))
            const up = () => {
                delete handle.dataset.dragging
                handle.style.background = 'transparent'
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                document.body.style.cursor = ''
                document.body.style.userSelect = ''
                persist(storageKey, left.getBoundingClientRect().width)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
            document.body.style.cursor = 'col-resize'
            document.body.style.userSelect = 'none'
        })

        handle.addEventListener('dblclick', () => {
            left.style.flex = '1 1 0%'
            try {
                window.localStorage.removeItem(storageKey)
            } catch (e) {}
            place()
        })

        row.appendChild(handle)

        // 恢复上次的宽度
        const restored = saved(storageKey, 0)
        if (restored) applyWidth(restored)
        place()

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => fitToRow())
            ro.observe(row)
        }
        window.addEventListener('resize', fitToRow)

        return handle
    }

    const install = (scope) => {
        // 1) 编辑器 / 右侧面板
        const mainRow = scope.querySelector('.arco-modal-body > div > div.flex.flex-1.overflow-hidden')
        if (mainRow && !mainRow.dataset.laSplit) {
            const cols = Array.from(mainRow.children).filter((el) => !el.classList.contains('la-split-v'))
            if (cols.length >= 2) {
                mainRow.dataset.laSplit = '1'
                createHandle(mainRow, {
                    left: cols[0],
                    right: cols[1],
                    minLeft: MIN_LEFT,
                    minRight: MIN_RIGHT,
                    storageKey: 'laSplit.editor',
                })
            }
        }

        // 2) 手机预览 / 无障碍树：找到同时包含两者的横向 flex 行
        const tree = scope.querySelector('.arco-tree')
        if (tree) {
            let node = tree
            let row = null
            while (node && node !== scope) {
                const parent = node.parentElement
                if (!parent) break
                const style = getComputedStyle(parent)
                if (style.display.includes('flex') && style.flexDirection === 'row' && parent.children.length >= 2) {
                    row = parent
                    break
                }
                node = parent
            }
            if (row && !row.dataset.laSplitPreview) {
                const cols = Array.from(row.children).filter((el) => !el.classList.contains('la-split-v'))
                const idx = cols.findIndex((el) => el === node || el.contains(node))
                const previewColumn = idx > 0 ? cols[idx - 1] : null
                const treeColumn = idx >= 0 ? cols[idx] : null
                if (previewColumn && treeColumn) {
                    row.dataset.laSplitPreview = '1'
                    createHandle(row, {
                        left: previewColumn,
                        right: treeColumn,
                        minLeft: MIN_PREVIEW,
                        minRight: 240,
                        storageKey: 'laSplit.preview',
                    })
                }
            }
        }
    }

    const locate = () => {
        const modals = Array.from(document.querySelectorAll('.arco-modal')).filter(
            (m) => m.getBoundingClientRect().height > 100,
        )
        for (const modal of modals) {
            if ((modal.textContent || '').includes('调试运行')) return modal
        }
        return null
    }

    let scheduled = false
    const schedule = () => {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => {
            scheduled = false
            const scope = locate()
            if (!scope) return
            install(scope)
        })
    }

    const boot = () => {
        schedule()
        try {
            new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true})
        } catch (e) {}
    }

    window.__laResizePanes = {install, schedule}

    if (document.body) boot()
    else document.addEventListener('DOMContentLoaded', boot)
})()
