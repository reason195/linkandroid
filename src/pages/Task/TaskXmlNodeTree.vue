<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue'

defineOptions({name: 'TaskXmlNodeTree'})

export interface TaskXmlNode {
    id: string
    tag: string
    text: string
    resourceId: string
    contentDesc: string
    className: string
    bounds: string
    clickable?: string
    scrollable?: string
    longClickable?: string
    checkable?: string
    checked?: string
    enabled?: string
    selected?: string
    children: TaskXmlNode[]
}

interface Row {
    node: TaskXmlNode
    depth: number
    hasChildren: boolean
    expanded: boolean
    matched: boolean
}

const props = withDefaults(
    defineProps<{
        nodes: TaskXmlNode[]
        selectedId: string
        hoveredId?: string
        searchText?: string
        clickableOnly?: boolean
    }>(),
    {
        hoveredId: '',
        searchText: '',
        clickableOnly: false,
    },
)

const emit = defineEmits<{
    select: [node: TaskXmlNode]
    hover: [node: TaskXmlNode]
    unhover: []
}>()

/** 默认展开层级：更深的层级先折叠，避免一屏全是节点 */
const DEFAULT_EXPAND_DEPTH = 2

const rootRef = ref<HTMLElement | null>(null)
const expandedState = ref<Record<string, boolean>>({})

const getShortClassName = (className: string): string => {
    if (!className) return ''
    const parts = className.split('.')
    return parts[parts.length - 1] || className
}

const getShortId = (resourceId: string): string => {
    if (!resourceId) return ''
    return resourceId.split('/').pop() || resourceId
}

const isClickable = (node: TaskXmlNode): boolean => node.clickable === 'true'

/** 类名按语义分色，方便快速扫读层级 */
const getClassTone = (className: string): string => {
    const short = getShortClassName(className).toLowerCase()
    if (/^text|^edit|^button|^compound|^switch|^checkbox|^radio/.test(short)) {
        return 'text-blue-600 dark:text-blue-400'
    }
    if (/^image|^icon/.test(short)) {
        return 'text-purple-600 dark:text-purple-400'
    }
    if (/layout|^view|^frame|^linear|^relative|^coordinator|^constraint/.test(short)) {
        return 'text-slate-500 dark:text-slate-400'
    }
    if (/webview|surface|video/.test(short)) {
        return 'text-amber-600 dark:text-amber-400'
    }
    return 'text-gray-600 dark:text-gray-300'
}

// ---------------------------------------------------------------------------
// 索引与过滤
// ---------------------------------------------------------------------------
const parentOf = computed(() => {
    const map = new Map<string, string>()
    const walk = (list: TaskXmlNode[]) => {
        for (const node of list) {
            for (const child of node.children) {
                map.set(child.id, node.id)
            }
            walk(node.children)
        }
    }
    walk(props.nodes)
    return map
})

const clickableSubtree = computed(() => {
    const keep = new Set<string>()
    const walk = (node: TaskXmlNode): boolean => {
        let has = isClickable(node)
        for (const child of node.children) {
            if (walk(child)) has = true
        }
        if (has) keep.add(node.id)
        return has
    }
    for (const node of props.nodes) walk(node)
    return keep
})

const query = computed(() => (props.searchText || '').trim().toLowerCase())

const searchHit = computed(() => {
    const q = query.value
    if (!q) return null
    const hits = new Set<string>()
    const match = (node: TaskXmlNode): boolean =>
        node.className.toLowerCase().includes(q) ||
        node.text.toLowerCase().includes(q) ||
        node.contentDesc.toLowerCase().includes(q) ||
        node.resourceId.toLowerCase().includes(q) ||
        node.id.includes(q)
    const walk = (list: TaskXmlNode[]) => {
        for (const node of list) {
            if (match(node)) hits.add(node.id)
            walk(node.children)
        }
    }
    walk(props.nodes)
    return hits
})

/** 搜索命中需要连同祖先一起展示，保持层级可读 */
const visibleSet = computed(() => {
    const hits = searchHit.value
    if (!hits) return null
    const visible = new Set<string>(hits)
    for (const id of hits) {
        let parent = parentOf.value.get(id)
        while (parent) {
            visible.add(parent)
            parent = parentOf.value.get(parent)
        }
    }
    return visible
})

const isExpanded = (node: TaskXmlNode, depth: number): boolean => {
    if (query.value) return true
    const state = expandedState.value[node.id]
    return state === undefined ? depth < DEFAULT_EXPAND_DEPTH : state
}

const toggleRow = (row: Row) => {
    const current = expandedState.value[row.node.id]
    const effective = current === undefined ? row.depth < DEFAULT_EXPAND_DEPTH : current
    expandedState.value[row.node.id] = !effective
}

const totalCount = computed(() => {
    let count = 0
    const walk = (list: TaskXmlNode[]) => {
        for (const node of list) {
            count++
            walk(node.children)
        }
    }
    walk(props.nodes)
    return count
})

const clickableCount = computed(() => {
    let count = 0
    const walk = (list: TaskXmlNode[]) => {
        for (const node of list) {
            if (isClickable(node)) count++
            walk(node.children)
        }
    }
    walk(props.nodes)
    return count
})

const rows = computed<Row[]>(() => {
    const out: Row[] = []
    const visible = visibleSet.value
    const hits = searchHit.value
    const walk = (list: TaskXmlNode[], depth: number) => {
        for (const node of list) {
            if (visible && !visible.has(node.id)) continue
            if (props.clickableOnly && !clickableSubtree.value.has(node.id)) continue
            const hasChildren = node.children.length > 0
            const expanded = isExpanded(node, depth)
            out.push({
                node,
                depth,
                hasChildren,
                expanded: hasChildren && expanded,
                matched: !!hits && hits.has(node.id),
            })
            if (hasChildren && expanded) walk(node.children, depth + 1)
        }
    }
    walk(props.nodes, 0)
    return out
})

const visibleCount = computed(() => rows.value.length)

// ---------------------------------------------------------------------------
// 对外能力
// ---------------------------------------------------------------------------
const expandAll = () => {
    const next: Record<string, boolean> = {}
    const walk = (list: TaskXmlNode[]) => {
        for (const node of list) {
            if (node.children.length > 0) next[node.id] = true
            walk(node.children)
        }
    }
    walk(props.nodes)
    expandedState.value = next
}

const collapseAll = () => {
    const next: Record<string, boolean> = {}
    for (const node of props.nodes) {
        next[node.id] = false
    }
    expandedState.value = next
}

const resetDepth = () => {
    expandedState.value = {}
}

const ensureVisible = (nodeId: string) => {
    const next = {...expandedState.value}
    let parent = parentOf.value.get(nodeId)
    while (parent) {
        next[parent] = true
        parent = parentOf.value.get(parent)
    }
    expandedState.value = next
}

const scrollToNode = async (nodeId: string) => {
    ensureVisible(nodeId)
    await nextTick()
    const el = rootRef.value?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
    if (el) el.scrollIntoView({block: 'nearest'})
}

watch(
    () => props.nodes,
    () => {
        expandedState.value = {}
    },
)

defineExpose({
    scrollToNode,
    expandAll,
    collapseAll,
    resetDepth,
    visibleCount,
    totalCount,
    clickableCount,
})
</script>

<template>
    <div ref="rootRef" class="la-tree select-none" @mouseleave="emit('unhover')">
        <div
            v-for="row in rows"
            :key="row.node.id"
            class="la-row flex items-center gap-1 pr-2 rounded-sm cursor-pointer"
            :class="[
                row.node.id === selectedId
                    ? 'la-row-selected'
                    : row.node.id === hoveredId
                      ? 'la-row-hovered'
                      : row.matched
                        ? 'la-row-matched'
                        : '',
            ]"
            :data-node-id="row.node.id"
            :title="row.node.bounds"
            @click="emit('select', row.node)"
            @mouseenter="emit('hover', row.node)"
        >
            <!-- 层级引导线 -->
            <span
                v-if="row.depth > 0"
                class="la-guides self-stretch shrink-0"
                :style="{
                    width: row.depth * 14 + 'px',
                    backgroundImage:
                        'repeating-linear-gradient(90deg, var(--la-guide-color) 0 1px, transparent 1px 14px)',
                }"
            />
            <!-- 展开/折叠 -->
            <button
                v-if="row.hasChildren"
                type="button"
                class="la-toggle shrink-0 flex items-center justify-center w-4 h-4 rounded hover:bg-gray-200/70 dark:hover:bg-gray-700"
                @click.stop="toggleRow(row)"
            >
                <i-lucide-chevron-right
                    class="w-3.5 h-3.5 text-gray-500 transition-transform"
                    :class="row.expanded ? 'rotate-90' : ''"
                />
            </button>
            <span v-else class="shrink-0 w-4" />
            <!-- 可点击标记 -->
            <i-lucide-mouse-pointer
                v-if="isClickable(row.node)"
                class="w-3 h-3 shrink-0 text-orange-500"
                :title="$t('device.preview.capClickable')"
            />
            <span v-else class="shrink-0 w-3" />
            <!-- 类名 -->
            <span class="la-class shrink-0 text-[12.5px] font-medium font-mono" :class="getClassTone(row.node.className)">
                {{ getShortClassName(row.node.className) || row.node.tag }}
            </span>
            <!-- 文本 / 描述 -->
            <span
                v-if="row.node.text || row.node.contentDesc"
                class="la-text truncate text-[12.5px] text-gray-800 dark:text-gray-100"
            >
                {{ row.node.text || row.node.contentDesc }}
            </span>
            <!-- resource-id -->
            <span
                v-if="row.node.resourceId"
                class="la-id shrink-0 max-w-[45%] truncate text-[11px] font-mono text-gray-400 dark:text-gray-500"
            >
                #{{ getShortId(row.node.resourceId) }}
            </span>
            <span
                v-if="row.node.scrollable === 'true'"
                class="la-badge shrink-0 text-[9px] px-1 rounded bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300"
            >
                {{ $t('device.preview.capScrollable') }}
            </span>
            <span
                v-if="row.node.checkable === 'true'"
                class="la-badge shrink-0 text-[9px] px-1 rounded bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
            >
                {{ row.node.checked === 'true' ? $t('device.preview.capChecked') : $t('device.preview.capCheckable') }}
            </span>
        </div>
    </div>
</template>

<style scoped>
.la-tree {
    --la-guide-color: rgba(148, 163, 184, 0.45);
}

:global([data-theme='dark']) .la-tree {
    --la-guide-color: rgba(148, 163, 184, 0.25);
}

.la-row {
    min-height: 26px;
    line-height: 26px;
}

.la-row:hover {
    background-color: rgba(20, 184, 166, 0.08);
}

.la-row-hovered {
    background-color: rgba(20, 184, 166, 0.12);
}

.la-row-matched {
    background-color: rgba(245, 158, 11, 0.12);
}

.la-row-selected {
    background-color: rgba(59, 130, 246, 0.12);
    box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.35);
}
</style>
