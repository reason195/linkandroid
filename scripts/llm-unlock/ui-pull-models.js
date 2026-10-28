/**
 * LinkAndroid 已安装版本补丁：在「模型设置」里加入「拉取模型列表」按钮。
 *
 * 说明：2.4.0 的界面里没有拉取入口，模型只能静态预置或手动添加。
 * 该脚本在模型列表标题旁插入一个按钮，点击后读取当前供应商的
 * apiHost/apiKey，调用 GET {apiHost}/models，把返回的对话模型合并进
 * ~/.linkandroid/data/storage/models.json，然后刷新界面。
 *
 * 由 scripts/llm-unlock/apply.cjs 注入 dist/index.html，配合
 * electron/llm-unlock.ts / ModelSetting.vue 的源码版功能。
 *
 * 手工调用：window.__laPullModelsUI.pull('Aa8PZwEc')
 */
;(() => {
    if (window.__laPullModelsUI) return

    const NON_CHAT =
        /embed|rerank|bge-|m3e|tts|whisper|audio|speech|moderation|dall-?e|stable-diffusion|flux|sora|video|image|ocr|guard/i
    const TITLES = ['模型列表', 'Models', 'Model List']

    const toast = (msg, ok) => {
        try {
            const el = document.createElement('div')
            el.textContent = msg
            el.style.cssText =
                'position:fixed;z-index:2147483000;left:50%;top:24px;transform:translateX(-50%);' +
                'padding:8px 16px;border-radius:6px;color:#fff;font-size:13px;max-width:70vw;' +
                'box-shadow:0 4px 12px rgba(0,0,0,.18);background:' +
                (ok === false ? '#f53f3f' : '#00b42a')
            document.body.appendChild(el)
            setTimeout(() => el.remove(), 3200)
        } catch (e) {}
    }

    const normBase = (url) => {
        let base = (url || '').trim().replace(/\/+$/, '')
        if (!base) return ''
        if (/\/chat\/completions(\?.*)?$/i.test(base)) base = base.replace(/\/chat\/completions(\?.*)?$/i, '')
        if (!/\/v\d+[a-z0-9]*(\/|$)/i.test(base)) base = base.replace(/\/+$/, '') + '/v1'
        return base
    }

    const loadDb = () => window.$mapi.storage.read('models')

    const resolveProvider = async () => {
        const db = await loadDb()
        const userProviders = (db && db.userProviders) || []
        const inputs = Array.from(document.querySelectorAll('input'))
            .map((i) => (i.value || '').trim())
            .filter(Boolean)
        const hosts = inputs.map((v) => v.replace(/\/+$/, ''))
        for (const p of userProviders) {
            const host = ((p.data && p.data.apiHost) || '').replace(/\/+$/, '')
            if (host && hosts.indexOf(host) >= 0) return p
        }
        const boldTexts = Array.from(document.querySelectorAll('div.font-bold'))
            .map((n) => (n.textContent || '').trim())
            .filter(Boolean)
        for (const p of userProviders) {
            if (p.title && boldTexts.indexOf(p.title) >= 0) return p
        }
        return null
    }

    const pull = async (providerRef) => {
        const db = await loadDb()
        if (!db) throw new Error('读取模型配置失败')
        db.providerData = db.providerData || {}
        const userProviders = db.userProviders || []
        let provider = null
        if (typeof providerRef === 'string') {
            provider =
                userProviders.find((p) => p.id === providerRef) || userProviders.find((p) => p.title === providerRef)
        } else if (providerRef) {
            provider = providerRef
        }
        if (!provider) throw new Error('未找到供应商，请在左侧先选中该供应商')
        const pid = provider.id
        const entry = db.providerData[pid] || {}
        const src = entry.apiHost || entry.apiUrl || (provider.data && provider.data.apiHost) || ''
        const key = entry.apiKey || (provider.data && provider.data.apiKey) || ''
        const base = normBase(src)
        if (!base) throw new Error('该供应商还没有填写 API 地址')

        const res = await fetch(base + '/models', {
            headers: key ? {Authorization: 'Bearer ' + key} : {},
        })
        const text = await res.text()
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 120))
        let json = null
        try {
            json = JSON.parse(text)
        } catch (e) {
            throw new Error('返回不是 JSON：' + text.slice(0, 120))
        }
        const list = Array.isArray(json) ? json : json.data || json.models || []
        const ids = list.map((m) => (typeof m === 'string' ? m : m.id || m.name || m.model)).filter(Boolean)
        const chatIds = ids.filter((id) => !NON_CHAT.test(id))
        if (!chatIds.length) throw new Error('接口没有返回可用的对话模型')

        entry.models = entry.models || []
        entry.enabled = true
        db.providerData[pid] = entry
        const groups = entry.models.map((m) => m.group).filter((v, i, a) => !!v && a.indexOf(v) === i)
        const group = groups[0] || provider.title || 'Default'
        let added = 0
        let updated = 0
        for (const id of chatIds) {
            const existing = entry.models.find((m) => m.id === id)
            if (existing) {
                existing.enabled = true
                updated++
                continue
            }
            entry.models.push({
                id,
                provider: pid,
                name: id,
                group,
                types: ['text'],
                caps: {vision: false, tools: true},
                enabled: true,
            })
            added++
        }
        await window.$mapi.storage.write('models', db)
        return {added, updated, total: ids.length}
    }

    const findSection = () => {
        const nodes = document.querySelectorAll('div.font-bold')
        for (const n of nodes) {
            const text = (n.textContent || '').trim()
            if (TITLES.indexOf(text) < 0) continue
            const parent = n.parentElement
            if (!parent) continue
            if (!parent.querySelector('button') && !parent.querySelector('.arco-collapse')) continue
            return {header: n, section: parent}
        }
        return null
    }

    const onClick = async (e) => {
        const btn = e.currentTarget
        if (btn.dataset.busy === '1') return
        btn.dataset.busy = '1'
        const label = btn.textContent
        btn.textContent = '拉取中…'
        try {
            const provider = await resolveProvider()
            const r = await pull(provider)
            toast('拉取完成：新增 ' + r.added + ' 个，更新 ' + r.updated + ' 个，界面即将刷新')
            setTimeout(() => location.reload(), 1200)
            return
        } catch (err) {
            toast('拉取失败：' + (err && err.message ? err.message : String(err)), false)
        }
        btn.dataset.busy = ''
        btn.textContent = label
    }

    const install = () => {
        // 构建已自带原生按钮时不再注入
        const native = Array.from(document.querySelectorAll('button')).some(
            (b) => !b.dataset.laPull && (b.textContent || '').trim() === '拉取模型列表',
        )
        if (native) return true
        const found = findSection()
        if (!found) return false
        // 官方（buildIn）面板没有 API Key / API 地址输入，不提供拉取
        const card = found.section.closest('.p-3') || found.section.parentElement
        const isCustom = !!(card && card.querySelector('input'))
        const existing = document.querySelector('[data-la-pull]')
        if (!isCustom) {
            if (existing) existing.remove()
            return false
        }
        if (existing) return true
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.dataset.laPull = '1'
        btn.className = 'arco-btn arco-btn-secondary arco-btn-size-medium'
        btn.textContent = '拉取模型列表'
        btn.style.cssText =
            'display:inline-block;height:26px;padding:0 10px;margin:0 0 8px 0;font-size:12px;line-height:24px;' +
            'border:1px solid var(--color-border-2,#e5e6eb);border-radius:4px;background:transparent;cursor:pointer;' +
            'color:var(--color-text-1,#1d2129)'
        btn.addEventListener('click', onClick)
        found.header.insertAdjacentElement('afterend', btn)
        return true
    }

    let scheduled = false
    const schedule = () => {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => {
            scheduled = false
            try {
                install()
            } catch (e) {}
        })
    }

    window.__laPullModelsUI = {install, pull, resolveProvider}

    const boot = () => {
        install()
        try {
            new MutationObserver(schedule).observe(document.body, {childList: true, subtree: true})
        } catch (e) {}
    }

    if (document.body) boot()
    else document.addEventListener('DOMContentLoaded', boot)
})()
