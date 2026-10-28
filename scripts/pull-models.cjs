#!/usr/bin/env node
/**
 * 从任意 OpenAI 兼容端点拉取模型列表，合并进 LinkAndroid 的供应商配置
 * (~/.linkandroid/data/storage/models.json)。LinkAndroid 本身没有
 * “获取模型列表”按钮，模型只能来自静态预置或手动添加，这个脚本补上这一步。
 *
 *   node scripts/pull-models.cjs --provider magpie --list
 *   node scripts/pull-models.cjs --provider magpie
 *   node scripts/pull-models.cjs --provider Aa8PZwEc --base http://192.168.1.12:3425/v1 --key sk-xxx
 *
 * 可选：
 *   --list            只打印端点返回的模型，不写文件
 *   --dry-run         打印将要写入的内容，不写文件
 *   --all             保留 embedding / rerank / tts 等非对话模型
 *   --vision id,id    标记为支持视觉的模型 id（逗号分隔，支持 * 通配）
 *   --no-tools        不给新模型开启 tools（默认开启）
 *   --group 名称      新模型的分组名（默认 Default）
 *   --data-root 路径  自定义数据目录（默认 $LINKANDROID_DATA_ROOT 或 ~/.linkandroid/data）
 *
 * 写入前会自动备份为 models.json.<时间戳>.bak；运行前请退出 LinkAndroid，
 * 否则应用内的配置同步可能覆盖本次写入。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f, d = null) => {
    const i = argv.indexOf(f)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}

const dataRoot =
    val('--data-root') ||
    process.env.LINKANDROID_DATA_ROOT ||
    path.join(os.homedir(), '.linkandroid', 'data')
const modelsPath = path.join(dataRoot, 'storage', 'models.json')

function fail(msg) {
    console.error('[pull-models] ' + msg)
    process.exit(1)
}

function globToRegExp(pattern) {
    let re = ''
    for (const ch of pattern) {
        if (ch === '*') re += '.*'
        else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    return new RegExp('^' + re + '$', 'i')
}

const NON_CHAT = /embed|rerank|bge-|m3e|tts|whisper|audio|speech|moderation|dall-?e|stable-diffusion|flux|sora|video|image|ocr|guard/i

async function main() {
    if (!fs.existsSync(modelsPath)) fail('找不到 ' + modelsPath + '（先启动一次 LinkAndroid 生成配置）')
    const db = JSON.parse(fs.readFileSync(modelsPath, 'utf-8'))
    const wanted = val('--provider')
    if (!wanted) {
        const list = (db.userProviders || []).map((p) => `${p.id}\t${p.title}`)
        console.error('[pull-models] 用 --provider 指定供应商，已有自定义供应商：')
        for (const l of list) console.error('  ' + l)
        process.exit(2)
    }

    const userProviders = db.userProviders || []
    let provider = userProviders.find((p) => p.id === wanted) || userProviders.find((p) => p.title === wanted)
    if (!provider) provider = userProviders.find((p) => p.title && p.title.toLowerCase().includes(wanted.toLowerCase()))
    let providerId = provider ? provider.id : wanted
    db.providerData = db.providerData || {}
    let entry = db.providerData[providerId]

    let base = (val('--base') || (provider && provider.data && provider.data.apiHost) || (entry && entry.apiUrl) || '').trim()
    const key = val('--key') || (provider && provider.data && provider.data.apiKey) || (entry && entry.apiKey) || ''
    if (!base) fail('供应商 ' + providerId + ' 没有 apiHost，用 --base 指定')
    base = base.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
    if (!/\/v\d+/i.test(base) && !/\/api\/v\d+/i.test(base)) base = base + '/v1'

    const url = base + '/models'
    console.log('[pull-models] GET ' + url)
    const res = await fetch(url, {
        headers: key ? {Authorization: 'Bearer ' + key} : {},
    })
    const text = await res.text()
    if (!res.ok) fail(`HTTP ${res.status} ${res.statusText}\n${text.slice(0, 500)}`)
    let json = null
    try {
        json = JSON.parse(text)
    } catch (e) {
        fail('返回不是 JSON：' + text.slice(0, 200))
    }
    const raw = Array.isArray(json) ? json : json.data || json.models || []
    const ids = raw
        .map((m) => (typeof m === 'string' ? m : m.id || m.name || m.model))
        .filter(Boolean)
    if (!ids.length) fail('端点没有返回任何模型：' + text.slice(0, 200))

    const keep = has('--all') ? ids : ids.filter((id) => !NON_CHAT.test(id))
    console.log(`[pull-models] 端点共 ${ids.length} 个模型，对话可用 ${keep.length} 个：`)
    for (const id of keep) console.log('  - ' + id)
    const dropped = ids.filter((id) => !keep.includes(id))
    if (dropped.length) console.log('[pull-models] 已过滤（--all 可保留）：' + dropped.join(', '))

    if (has('--list')) return

    if (!entry) {
        if (!provider) fail('供应商不存在且不是自定义供应商，先在应用里添加：' + providerId)
        entry = {apiKey: key, apiHost: base, models: [], enabled: true}
        db.providerData[providerId] = entry
        console.log('[pull-models] 新建 providerData.' + providerId)
    }
    entry.models = entry.models || []
    const group = val('--group', 'Default')
    const tools = !has('--no-tools')
    const visionPatterns = (val('--vision', '') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(globToRegExp)
    const isVision = (id) => visionPatterns.some((re) => re.test(id))

    let added = 0
    let updated = 0
    for (const id of keep) {
        const existing = entry.models.find((m) => m.id === id)
        if (existing) {
            existing.name = existing.name || id
            existing.enabled = true
            if (isVision(id)) {
                existing.caps = {...(existing.caps || {}), vision: true}
            }
            updated++
            continue
        }
        entry.models.push({
            id,
            provider: providerId,
            name: id,
            group,
            types: ['text'],
            caps: isVision(id) ? {vision: true, tools} : {vision: false, tools},
            enabled: true,
        })
        added++
    }
    entry.enabled = true
    if (provider && provider.data) {
        provider.data.enabled = true
        if (!provider.data.apiHost) provider.data.apiHost = base
    }

    const backup = modelsPath + '.' + new Date().toISOString().replace(/[:.]/g, '-') + '.bak'
    fs.copyFileSync(modelsPath, backup)
    const tmp = modelsPath + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(db, null, 4))
    fs.renameSync(tmp, modelsPath)
    console.log(`[pull-models] 已写入：新增 ${added}，更新 ${updated}，备份 ${path.basename(backup)}`)
    console.log('[pull-models] 重启 LinkAndroid 后在模型设置里即可看到；记得勾选启用。')
}

main().catch((e) => fail(String(e && e.stack ? e.stack : e)))
