/**
 * LinkAndroid LLM unlock —— 客户端会员门槛移除
 *
 * 官方大模型（buildIn / llmpx）的 API 地址、密钥、额度均由服务端
 * `app_manager/user_info` 按会员下发，非会员拿到的是
 * `{quota: 0, apiUrl: null, apiKey: null}`，客户端据此弹登录/充值/升级。
 *
 * 本模块在主进程启动早期安装一个 fetch 拦截器：把该接口返回的
 * vip.isDefault 置为 false、quota 拉高、user.id 补齐，并在配置了
 * apiUrl/apiKey 时把它们注入 llmpx —— 于是内置模型供应商可以直接
 * 指向任意 OpenAI 兼容端点，所有客户端 VIP 判断随之失效。
 *
 * 配置（后加载的覆盖先加载的）：
 *   <resources>/llm-unlock.json
 *   ~/.linkandroid/llm-unlock.json
 *   $LINKANDROID_LLM_UNLOCK 指向的文件
 *
 * 说明：服务端中转地址与密钥本身只按会员下发，客户端无法凭空获得；
 * 需要接入自己的端点（DeepSeek / 硅基流动 / Ollama / one-api 等）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type LlmUnlockConfig = {
    enabled?: boolean
    quota?: number
    virtualUserId?: number
    apiUrl?: string
    apiKey?: string
    models?: any[] | null
}

const CONFIG_FILE = 'llm-unlock.json'

const log = (...args: any[]) => {
    try {
        console.log('[llm-unlock]', ...args)
    } catch (e) {
        // ignore
    }
}

function configPaths(): string[] {
    const paths: string[] = []
    try {
        if (process.resourcesPath) {
            paths.push(path.join(process.resourcesPath, CONFIG_FILE))
        }
    } catch (e) {
        // ignore
    }
    try {
        paths.push(path.join(os.homedir(), '.linkandroid', CONFIG_FILE))
    } catch (e) {
        // ignore
    }
    if (process.env['LINKANDROID_LLM_UNLOCK']) {
        paths.push(process.env['LINKANDROID_LLM_UNLOCK'] as string)
    }
    return paths
}

function loadConfig(): LlmUnlockConfig {
    const cfg: LlmUnlockConfig = {
        enabled: true,
        quota: 1_000_000_000,
        virtualUserId: 1,
        apiUrl: '',
        apiKey: '',
        models: null,
    }
    for (const p of configPaths()) {
        try {
            if (fs.existsSync(p)) {
                Object.assign(cfg, JSON.parse(fs.readFileSync(p, 'utf-8')))
            }
        } catch (e) {
            log('config read error', p, String(e))
        }
    }
    return cfg
}

/** 就地改写 user_info 响应：会员标记、额度、虚拟登录用户、内置模型端点 */
function decorate(json: any, cfg: LlmUnlockConfig) {
    if (!json || typeof json !== 'object') return
    const root = json.data
    if (!root || typeof root !== 'object') return
    const bucket: any = root.data && typeof root.data === 'object' ? root.data : root

    if (bucket.vip && typeof bucket.vip === 'object') {
        bucket.vip.isDefault = false
        if (!bucket.vip.flag || bucket.vip.flag === 'default') bucket.vip.flag = 'vip'
        if (!bucket.vip.title || bucket.vip.title === '普通会员') bucket.vip.title = 'VIP'
    }

    if (bucket.llmpx && typeof bucket.llmpx === 'object') {
        const quota = Number(cfg.quota)
        bucket.llmpx.quota = Number.isFinite(quota) && quota > 0 ? quota : 1_000_000_000
        if (Array.isArray(cfg.models) && cfg.models.length) {
            bucket.llmpx.models = cfg.models
        }
        if (cfg.apiUrl) bucket.llmpx.apiUrl = cfg.apiUrl
        if (cfg.apiKey) bucket.llmpx.apiKey = cfg.apiKey
        if (bucket.llmpx.apiKey === null || bucket.llmpx.apiKey === undefined) {
            bucket.llmpx.apiKey = ''
        }
    }

    const user = root.user && typeof root.user === 'object' ? root.user : null
    if (user && !user.id) {
        user.id = cfg.virtualUserId || 1
        if (!user.name || user.name === '-') user.name = 'LinkAndroid User'
    }
}

export function installLlmUnlock() {
    const cfg = loadConfig()
    if (cfg.enabled === false) {
        log('disabled by config')
        return
    }
    const g: any = globalThis as any
    const origFetch: any = g.fetch
    if (typeof origFetch !== 'function') {
        log('fetch unavailable')
        return
    }
    const AnyResponse: any = g.Response
    g.fetch = async function (input: any, init?: any) {
        const res = await origFetch.call(this, input, init)
        try {
            let url = ''
            if (typeof input === 'string') url = input
            else if (input && typeof input === 'object' && typeof input.url === 'string') url = input.url
            if (url.indexOf('app_manager/user_info') < 0) return res

            const text = await res.text()
            let json: any = null
            try {
                json = JSON.parse(text)
            } catch (e) {
                json = null
            }
            if (!json) {
                return new AnyResponse(text, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: {'content-type': 'application/json'},
                })
            }
            decorate(json, cfg)
            return new AnyResponse(JSON.stringify(json), {
                status: res.status,
                statusText: res.statusText,
                headers: {'content-type': 'application/json'},
            })
        } catch (e) {
            return res
        }
    }
    log('user_info hook installed')
}

installLlmUnlock()
