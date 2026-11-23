/**
 * LinkAndroid 已安装版本补丁：无障碍树（XML 结构树）可读性增强
 *
 * - 每行拆成「类名 chip + 文本 + #resource-id」，等宽、尾部省略；
 * - 顶部工具栏：展开全部 / 折叠 / 只看可点击 / 计数；
 * - Arco 的树是扁平渲染（用缩进块表示层级，子节点是后续兄弟节点），
 *   所以折叠由本脚本按 depth 区间隐藏后续兄弟节点实现，
 *   不依赖 Arco 的内部展开状态（它的 switcher 不响应合成点击）。
 *
 * 只改 DOM 展示，不读也不改应用状态；Vue 重渲染后会自动再次应用。
 * 对应源码 src/pages/Task/TaskXmlNodeTree.vue。
 */
;(() => {
    if (window.__laA11yTree) return

    const ID_RE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/i
    const TONE = [
        [/^text|^edit|^button|^compound|^switch|^checkbox|^radio/i, '#2563eb'],
        [/^image|^icon/i, '#7c3aed'],
        [/layout|^view|^frame|^linear|^relative|^coordinator|^constraint/i, '#64748b'],
        [/webview|surface|video/i, '#d97706'],
    ]

    const toneOf = (className) => {
        for (const [re, color] of TONE) {
            if (re.test(className)) return color
        }
        return ''
    }

    const depthOf = (nodeEl) => {
        const indent = nodeEl.querySelector(':scope > .arco-tree-node-indent')
        return indent ? indent.children.length : 0
    }

    const splitMeta = (raw) => {
        const text = (raw || '').trim()
        if (!text) return {text: '', id: ''}
        const parts = text.split(' · ').filter((s) => s !== '')
        let id = ''
        if (parts.length) {
            const last = parts[parts.length - 1]
            if (ID_RE.test(last) && /[_]/.test(last) && !/[\u4e00-\u9fa5]/.test(last)) {
                id = parts.pop()
            }
        }
        return {text: parts.join(' · '), id}
    }

    const enhanceTitle = (titleEl) => {
        if (titleEl.dataset.laDone === '1') return
        const block = titleEl.querySelector('.block')
        if (!block) return
        const clsSpan = block.querySelector(':scope > .font-medium')
        if (!clsSpan) return
        const metaSpan = block.querySelector(':scope > .ml-1')

        const className = (clsSpan.textContent || '').trim()
        const color = toneOf(className)
        if (color) clsSpan.style.color = color

        if (metaSpan) {
            const {text, id} = splitMeta(metaSpan.textContent)
            const frag = document.createDocumentFragment()
            if (text) {
                const t = document.createElement('span')
                t.className = 'la-txt'
                t.textContent = text
                t.title = text
                frag.appendChild(t)
            }
            if (id) {
                const i = document.createElement('span')
                i.className = 'la-id'
                i.textContent = '#' + id
                i.title = id
                frag.appendChild(i)
            }
            if (frag.childNodes.length) metaSpan.replaceWith(frag)
        }
        titleEl.dataset.laDone = '1'
    }

    /** 读取当前树的节点序列与层级 */
    const readNodes = (scope) => {
        const list = Array.from(scope.querySelectorAll('.arco-tree-node'))
        return list.map((el, index) => {
            const depth = depthOf(el)
            const next = list[index + 1]
            return {el, index, depth, hasKids: !!next && depthOf(next) > depth}
        })
    }

    const markStructure = (tree) => {
        for (const node of tree) {
            const title = node.el.querySelector(':scope > .arco-tree-node-title')
            if (title) enhanceTitle(title)
            if (node.hasKids) {
                node.el.dataset.laParent = '1'
                const switcher = node.el.querySelector(':scope > .arco-tree-node-switcher')
                if (switcher && !switcher.querySelector(':scope > .la-caret')) {
                    const caret = document.createElement('span')
                    caret.className = 'la-caret'
                    switcher.appendChild(caret)
                }
            } else {
                delete node.el.dataset.laParent
            }
        }
    }

    /** 按 la-collapsed 标记隐藏后续更深层的兄弟节点 */
    const applyVisibility = (tree) => {
        for (const node of tree) node.el.classList.remove('la-hidden')
        for (let i = 0; i < tree.length; i++) {
            const node = tree[i]
            if (!node.el.classList.contains('la-collapsed')) continue
            for (let j = i + 1; j < tree.length; j++) {
                if (tree[j].depth <= node.depth) break
                tree[j].el.classList.add('la-hidden')
            }
        }
    }

    const rebuild = (scope) => {
        const tree = readNodes(scope)
        markStructure(tree)
        applyVisibility(tree)
        return tree
    }

    const expandAll = (scope) => {
        for (const el of scope.querySelectorAll('.arco-tree-node.la-collapsed')) {
            el.classList.remove('la-collapsed')
        }
        applyVisibility(readNodes(scope))
    }

    const collapseBelowDepth = (scope, keepDepth) => {
        for (const node of readNodes(scope)) {
            if (!node.hasKids) continue
            node.el.classList.toggle('la-collapsed', node.depth >= keepDepth)
        }
        applyVisibility(readNodes(scope))
    }

    const applyClickableFilter = (scope, on) => {
        scope.classList.toggle('la-clickable-only', on)
        if (!on) return
        expandAll(scope)
        const tree = readNodes(scope)
        for (const node of tree) {
            const title = node.el.querySelector(':scope > .arco-tree-node-title')
            let keep = !!(title && title.querySelector('svg'))
            if (!keep) {
                for (let j = node.index + 1; j < tree.length; j++) {
                    if (tree[j].depth <= node.depth) break
                    const t = tree[j].el.querySelector(':scope > .arco-tree-node-title')
                    if (t && t.querySelector('svg')) {
                        keep = true
                        break
                    }
                }
            }
            node.el.classList.toggle('la-keep', keep)
        }
    }

    const countText = (scope) => {
        const nodes = scope.querySelectorAll('.arco-tree-node')
        let total = nodes.length
        let visible = 0
        let clickable = 0
        for (const nodeEl of nodes) {
            if (nodeEl.offsetParent !== null) visible++
            const title = nodeEl.querySelector(':scope > .arco-tree-node-title')
            if (title && title.querySelector('svg')) clickable++
        }
        return `${visible}/${total} · ${clickable} 可点`
    }

    const buildToolbar = (scope) => {
        const bar = document.createElement('div')
        bar.className = 'la-tree-toolbar'
        bar.dataset.laToolbar = '1'

        const button = (label, onClick) => {
            const b = document.createElement('button')
            b.type = 'button'
            b.textContent = label
            b.addEventListener('click', onClick)
            bar.appendChild(b)
            return b
        }

        button('展开全部', () => {
            expandAll(scope)
            refresh()
        })
        button('折叠', () => {
            collapseBelowDepth(scope, 2)
            refresh()
        })
        const btnClickable = button('只看可点击', () => {
            const on = btnClickable.dataset.active !== '1'
            if (on && !scope.querySelector('.arco-tree-node-title svg')) {
                // 本屏没有 clickable 节点，避免给出一棵空树
                btnClickable.dataset.active = '0'
                const el = bar.querySelector('.la-count')
                if (el) {
                    const previous = el.textContent
                    el.textContent = '没有可点击节点'
                    setTimeout(() => refresh(), 1600)
                    void previous
                }
                return
            }
            btnClickable.dataset.active = on ? '1' : '0'
            applyClickableFilter(scope, on)
            refresh()
        })
        btnClickable.dataset.active = '0'

        const count = document.createElement('span')
        count.className = 'la-count'
        bar.appendChild(count)
        return {bar, count}
    }

    let state = null

    const locate = () => {
        const modals = Array.from(document.querySelectorAll('.arco-modal')).filter(
            (m) => m.getBoundingClientRect().height > 100,
        )
        for (const modal of modals) {
            const tree = modal.querySelector('.arco-tree')
            if (tree) return tree
        }
        return null
    }

    const bindTreeEvents = (scope) => {
        if (scope.dataset.laBound === '1') return
        scope.dataset.laBound = '1'
        scope.addEventListener(
            'click',
            (e) => {
                const switcher = e.target.closest('.arco-tree-node-switcher')
                if (!switcher) return
                const nodeEl = switcher.closest('.arco-tree-node')
                if (!nodeEl || !nodeEl.dataset.laParent) return
                e.preventDefault()
                e.stopPropagation()
                nodeEl.classList.toggle('la-collapsed')
                applyVisibility(readNodes(scope))
                refresh()
            },
            true,
        )
    }

    const install = (scope) => {
        if (!scope || !document.body.contains(scope)) return false
        let scroller = scope
        while (scroller && scroller !== document.body) {
            const cls = (scroller.className || '').toString()
            if (/overflow-(auto|y-auto|hidden)/.test(cls)) break
            scroller = scroller.parentElement
        }
        const host = scroller ? scroller.parentElement : scope.parentElement
        let bar = host ? host.querySelector(':scope > .la-tree-toolbar') : null
        if (host && !bar) {
            const built = buildToolbar(scope)
            host.insertBefore(built.bar, scroller || scope)
            bar = built.bar
        }
        bindTreeEvents(scope)
        state = {scope, count: bar ? bar.querySelector('.la-count') : null}
        rebuild(scope)
        return true
    }

    const refresh = () => {
        if (!state || !document.body.contains(state.scope)) {
            const scope = locate()
            if (!scope) return
            install(scope)
        }
        if (!state) return
        if (state.count) state.count.textContent = countText(state.scope)
    }

    let lastTotal = 0
    const autoCollapse = (scope) => {
        const total = scope.querySelectorAll('.arco-tree-node').length
        if (total === lastTotal) return
        lastTotal = total
        if (total < 40) return
        collapseBelowDepth(scope, 2)
        refresh()
    }

    let scheduled = false
    const schedule = () => {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => {
            scheduled = false
            const scope = state && document.body.contains(state.scope) ? state.scope : locate()
            if (!scope) return
            if (!state || state.scope !== scope) {
                install(scope)
            } else {
                rebuild(scope)
            }
            autoCollapse(scope)
            refresh()
        })
    }

    const boot = () => {
        const scope = locate()
        if (scope) install(scope)
        try {
            new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true})
        } catch (e) {}
    }

    window.__laA11yTree = {refresh, expandAll, collapseBelowDepth, applyClickableFilter}

    if (document.body) boot()
    else document.addEventListener('DOMContentLoaded', boot)
})()
