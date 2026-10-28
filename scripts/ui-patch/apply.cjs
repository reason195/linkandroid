#!/usr/bin/env node
/**
 * LinkAndroid 已安装程序 UI 补丁：把 task-editor-dialog.css 注入
 * dist/index.html（<style id="la-ui-patch">），用于修正「新建任务」弹窗
 * 在最大化后仍显示不全的问题。
 *
 *   node scripts/ui-patch/apply.cjs                 # 默认 %LOCALAPPDATA%\Programs\LinkAndroid
 *   node scripts/ui-patch/apply.cjs --target "D:\Apps\LinkAndroid"
 *   node scripts/ui-patch/apply.cjs --dry-run
 *   node scripts/ui-patch/apply.cjs --revert        # 仅移除本补丁的 <style>，不影响其他补丁
 *
 * 运行前请退出 LinkAndroid。asar 只改动 dist/index.html 一个条目。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')

const HERE = __dirname
const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const argOf = (f) => {
    const i = argv.indexOf(f)
    return i >= 0 ? argv[i + 1] : null
}

const dryRun = has('--dry-run')
const revert = has('--revert')
const target = path.resolve(
    argOf('--target') ||
        process.env.LINKANDROID_HOME ||
        path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Programs', 'LinkAndroid'),
)
const resources = path.join(target, 'resources')
const asarPath = path.join(resources, 'app.asar')
const backupPath = path.join(resources, 'app.asar.orig')
const STYLE_ID = 'la-ui-patch'

const fail = (msg) => {
    console.error('[ui-patch] ' + msg)
    process.exit(1)
}

if (!fs.existsSync(asarPath)) fail('找不到 app.asar: ' + asarPath)

// ---------------- asar ----------------
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
    return {algorithm: 'SHA256', hash: crypto.createHash('sha256').update(buf).digest('hex'), blockSize, blocks}
}

const {fd, header, baseOffset} = readAsar(asarPath)
const entries = walk(header, '', [])
const htmlEntry = entries.find((e) => e.path === 'dist/index.html')
if (!htmlEntry) fail('asar 内找不到 dist/index.html')

const readEntry = (entry) => {
    const buf = Buffer.alloc(entry.node.size)
    let read = 0
    while (read < entry.node.size) {
        const n = fs.readSync(fd, buf, read, entry.node.size - read, baseOffset + Number(entry.node.offset) + read)
        if (n <= 0) break
        read += n
    }
    return buf
}

let html = readEntry(htmlEntry).toString('utf8')
const styleRe = new RegExp(`\\s*<style id="${STYLE_ID}">[\\s\\S]*?</style>`, 'g')
html = html.replace(styleRe, '')

let changed = false
if (revert) {
    console.log('[ui-patch] 移除 <style id="' + STYLE_ID + '">')
} else {
    const cssPath = path.join(HERE, 'task-editor-dialog.css')
    if (!fs.existsSync(cssPath)) fail('找不到 ' + cssPath)
    const css = fs.readFileSync(cssPath, 'utf8')
    if (css.includes('</style')) fail('CSS 不能包含 </style>')
    const tag = `<style id="${STYLE_ID}">\n${css}\n</style>`
    if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, tag + '\n</head>')
    else html = tag + '\n' + html
    console.log('[ui-patch] 注入 <style id="' + STYLE_ID + '"> (' + css.length + ' bytes)')
}
changed = true

if (dryRun) {
    fs.closeSync(fd)
    console.log('[dry-run] 未写入 app.asar')
    process.exit(0)
}
if (changed && !fs.existsSync(backupPath)) {
    fs.copyFileSync(asarPath, backupPath)
    console.log('[ui-patch] 已备份原 asar: ' + backupPath)
}

// ---------------- repack ----------------
const outPath = asarPath + '.new'
const outFd = fs.openSync(outPath, 'w')
let offset = 0
const chunks = []
for (const entry of entries) {
    if (entry.link) continue
    let buf
    if (entry.path === 'dist/index.html') {
        buf = Buffer.from(html, 'utf8')
        entry.node.size = buf.length
        entry.node.integrity = integrityFor(buf)
    } else {
        buf = readEntry(entry)
    }
    entry.node.offset = String(offset)
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
console.log('[ui-patch] 已写入 ' + asarPath + ' (' + pos + ' bytes)')
console.log('[ui-patch] 完成，重启 LinkAndroid 生效。')
