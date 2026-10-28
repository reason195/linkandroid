#!/usr/bin/env node
/**
 * LinkAndroid 大模型 VIP 限制移除 —— 已安装程序补丁工具
 *
 *   node scripts/llm-unlock/apply.cjs                     # 默认安装目录
 *   node scripts/llm-unlock/apply.cjs --target "D:\Apps\LinkAndroid"
 *   node scripts/llm-unlock/apply.cjs --revert            # 还原 app.asar.orig
 *   node scripts/llm-unlock/apply.cjs --dry-run           # 只看会改什么
 *
 * 改动：
 *   1. resources/app.asar 内 dist-electron/main/index.js 顶部注入 hook（必需）
 *   2. resources/app.asar 内 dist/assets/Task-*.js 删除发送前三处 VIP 校验（可选）
 *   3. 生成 resources/llm-unlock.json 配置模板（不覆盖已有文件）
 *   4. 首次修改前备份 resources/app.asar.orig
 *
 * 运行前请退出 LinkAndroid，否则 asar 被占用会写入失败。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const HERE = __dirname
const argv = process.argv.slice(2)

function argOf(name) {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : null
}

const dryRun = argv.includes('--dry-run')
const revert = argv.includes('--revert')
const target = path.resolve(
    argOf('--target') ||
        process.env.LINKANDROID_HOME ||
        path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Programs', 'LinkAndroid'),
)
const resources = path.join(target, 'resources')
const asarPath = path.join(resources, 'app.asar')
const backupPath = path.join(resources, 'app.asar.orig')
const configPath = path.join(resources, 'llm-unlock.json')

function fail(msg) {
    console.error('[llm-unlock] ' + msg)
    process.exit(1)
}

if (!fs.existsSync(resources)) fail('找不到安装目录: ' + resources)
if (!fs.existsSync(asarPath)) fail('找不到 app.asar: ' + asarPath)

if (revert) {
    if (!fs.existsSync(backupPath)) fail('没有备份文件: ' + backupPath)
    if (dryRun) {
        console.log('[dry-run] 将用 ' + backupPath + ' 覆盖 app.asar')
        process.exit(0)
    }
    fs.copyFileSync(backupPath, asarPath)
    console.log('[llm-unlock] 已还原: ' + asarPath)
    process.exit(0)
}

// ---------------------------------------------------------------------------
// asar 读写（无第三方依赖）
// ---------------------------------------------------------------------------
function readAsar(file) {
    const fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const headerSize = head.readUInt32LE(4)
    const jsonLen = head.readUInt32LE(12)
    if (headerSize <= 0 || jsonLen <= 0) fail('不是合法的 asar: ' + file)
    const jsonBuf = Buffer.alloc(jsonLen)
    fs.readSync(fd, jsonBuf, 0, jsonLen, 16)
    return {fd, header: JSON.parse(jsonBuf.toString('utf8')), baseOffset: 8 + headerSize}
}

function walk(node, prefix, out) {
    for (const [name, entry] of Object.entries(node.files || {})) {
        const p = prefix ? prefix + '/' + name : name
        if (entry.files) walk(entry, p, out)
        else out.push({path: p, node: entry, link: entry.link})
    }
    return out
}

function globToRegExp(pattern) {
    let re = ''
    for (const ch of pattern) {
        if (ch === '*') re += '[^/]*'
        else if (ch === '?') re += '[^/]'
        else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
    return new RegExp('^' + re + '$')
}

function integrityFor(buf) {
    const blockSize = 4194304
    const blocks = []
    for (let off = 0; off < buf.length; off += blockSize) {
        blocks.push(
            crypto
                .createHash('sha256')
                .update(buf.subarray(off, Math.min(off + blockSize, buf.length)))
                .digest('hex'),
        )
    }
    if (!blocks.length) blocks.push(crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'))
    return {
        algorithm: 'SHA256',
        hash: crypto.createHash('sha256').update(buf).digest('hex'),
        blockSize,
        blocks,
    }
}

// ---------------------------------------------------------------------------
// 补丁
// ---------------------------------------------------------------------------
const prepend = fs.readFileSync(path.join(HERE, 'main-prepend.mjs'), 'utf8')
const rules = JSON.parse(fs.readFileSync(path.join(HERE, 'renderer-patches.json'), 'utf8'))

const {fd, header, baseOffset} = readAsar(asarPath)
const entries = walk(header, '', [])
const byPath = new Map(entries.map((e) => [e.path, e]))

function readEntry(entry) {
    const buf = Buffer.alloc(entry.node.size)
    let read = 0
    while (read < entry.node.size) {
        const n = fs.readSync(fd, buf, read, entry.node.size - read, baseOffset + Number(entry.node.offset) + read)
        if (n <= 0) break
        read += n
    }
    return buf
}

const contents = new Map()
const applied = []
const skipped = []

// 1) 主进程 hook
const mainEntry = byPath.get('dist-electron/main/index.js')
if (!mainEntry) fail('asar 内找不到 dist-electron/main/index.js')
const mainBuf = readEntry(mainEntry)
if (mainBuf.toString('utf8', 0, 512).includes('LinkAndroid LLM unlock (injected shim)')) {
    console.log('[llm-unlock] 主进程 hook 已存在，跳过（避免重复注入）')
} else {
    contents.set(mainEntry.path, Buffer.concat([Buffer.from(prepend, 'utf8'), Buffer.from('\n'), mainBuf]))
    applied.push('dist-electron/main/index.js: 主进程 fetch hook')
}

// 2) 渲染层按钮校验
for (const [pattern, list] of Object.entries(rules)) {
    const re = globToRegExp(pattern)
    for (const entry of entries.filter((e) => !e.link && re.test(e.path))) {
        let text = contents.has(entry.path)
            ? contents.get(entry.path).toString('utf8')
            : readEntry(entry).toString('utf8')
        let touched = false
        for (const rule of list) {
            if (!text.includes(rule.search)) {
                skipped.push(entry.path + ': ' + rule.name)
                continue
            }
            text = text.split(rule.search).join(rule.replace)
            touched = true
            applied.push(entry.path + ': ' + rule.name)
        }
        if (touched) contents.set(entry.path, Buffer.from(text, 'utf8'))
    }
}

if (skipped.length) {
    console.warn('[llm-unlock] 以下渲染层补丁未命中（版本变化属正常，主进程 hook 仍然生效）：')
    for (const s of skipped) console.warn('  - ' + s)
}

// 3) 设置页「拉取模型列表」按钮：内联注入 dist/index.html
const uiPath = path.join(HERE, 'ui-pull-models.js')
if (fs.existsSync(uiPath)) {
    const uiEntry = byPath.get('dist/index.html')
    if (!uiEntry) {
        console.warn('[llm-unlock] asar 内找不到 dist/index.html，跳过按钮注入')
    } else {
        let html = (contents.has('dist/index.html') ? contents.get('dist/index.html') : readEntry(uiEntry)).toString(
            'utf8',
        )
        if (html.includes('__laPullModelsUI')) {
            console.log('[llm-unlock] 设置页按钮已存在，跳过（避免重复注入）')
        } else {
            const uiScript = fs.readFileSync(uiPath, 'utf8')
            if (uiScript.includes('</script')) fail('ui-pull-models.js 不能包含 </script>')
            const tag = '<script>\n' + uiScript + '\n</script>'
            html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, tag + '\n</body>') : html + '\n' + tag
            contents.set('dist/index.html', Buffer.from(html, 'utf8'))
            applied.push('dist/index.html: 设置页「拉取模型列表」按钮')
        }
    }
}

console.log('[llm-unlock] 待写入改动：')
for (const a of applied) console.log('  * ' + a)

if (dryRun) {
    fs.closeSync(fd)
    console.log('[dry-run] 未写入 app.asar')
    process.exit(0)
}

// ---------------------------------------------------------------------------
// 重新打包
// ---------------------------------------------------------------------------
if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(asarPath, backupPath)
    console.log('[llm-unlock] 已备份原 asar: ' + backupPath)
} else {
    console.log('[llm-unlock] 备份已存在，保留既有备份: ' + backupPath)
}

const outPath = asarPath + '.new'
const outFd = fs.openSync(outPath, 'w')
let offset = 0
const chunks = []
for (const entry of entries) {
    if (entry.link) continue
    const buf = contents.has(entry.path) ? contents.get(entry.path) : readEntry(entry)
    entry.node.offset = String(offset)
    entry.node.size = buf.length
    if (contents.has(entry.path)) entry.node.integrity = integrityFor(buf)
    chunks.push(buf)
    offset += buf.length
}

const json = Buffer.from(JSON.stringify(header), 'utf8')
const pad = (4 - (json.length % 4)) % 4
const padded = json.length + pad
const head = Buffer.alloc(16)
head.writeUInt32LE(4, 0)
head.writeUInt32LE(padded + 8, 4)
head.writeUInt32LE(padded + 4, 8)
head.writeUInt32LE(json.length, 12)
fs.writeSync(outFd, head, 0, 16, 0)
fs.writeSync(outFd, json, 0, json.length, 16)
if (pad) fs.writeSync(outFd, Buffer.alloc(pad), 0, pad, 16 + json.length)
let pos = 16 + padded
for (const buf of chunks) {
    fs.writeSync(outFd, buf, 0, buf.length, pos)
    pos += buf.length
}
fs.closeSync(outFd)
fs.closeSync(fd)

try {
    fs.renameSync(outPath, asarPath)
} catch (e) {
    fs.rmSync(outPath, {force: true})
    fail('写入 app.asar 失败（应用是否仍在运行？）：' + e.message)
}
console.log('[llm-unlock] 已写入 ' + asarPath + ' (' + pos + ' bytes)')

// 3) 配置模板
if (!fs.existsSync(configPath)) {
    fs.copyFileSync(path.join(HERE, 'llm-unlock.json'), configPath)
    console.log('[llm-unlock] 已生成配置: ' + configPath)
} else {
    console.log('[llm-unlock] 配置已存在，未覆盖: ' + configPath)
}
console.log('[llm-unlock] 完成，重启 LinkAndroid 生效。')
