import {ChatParam, ProviderType} from '../types'
import {OpenAiModelProvider} from './driver/openai'
import {mapError} from '../../../lib/error'

const ModelProviderMap = {
    openai: OpenAiModelProvider,
}

export type ModelChatResult = {
    code: number
    msg: string
    data?: {
        content?: string
        [key: string]: any
    }
}

/**
 * Normalize a base url so that it can be safely joined with an api path.
 * - trims spaces and trailing slashes
 * - keeps a full `.../chat/completions` endpoint as is
 */
const normalizeBaseUrl = (url: string) => {
    return url.trim().replace(/\/+$/, '')
}

/**
 * Detect whether the url already contains an api version segment,
 * e.g. `/v1`, `/v4`, `/v1beta/openai`, `/v3/openai`, `/api/paas/v4`.
 */
const hasVersionSegment = (url: string) => {
    return /\/v\d+[a-z0-9]*(\/|$)/i.test(url)
}

export const ModelProvider = {
    /**
     * Build the provider base url (version prefix included), shared by every api path.
     *
     * - `apiHost` (user input) takes precedence over the provider default `apiUrl`
     * - a pasted full endpoint (`.../chat/completions`) is trimmed back to its base
     * - `apiPath` is the version prefix of the provider, `/v1` by default.
     *   It is skipped when the url already contains a version segment, so
     *   `https://api.siliconflow.cn/v1` does not become `/v1/v1/...`.
     */
    baseUrl(type: ProviderType, apiUrl: string, apiHost: string = '', apiPath: string = '/v1') {
        const url = normalizeBaseUrl(apiHost || '') || normalizeBaseUrl(apiUrl || '')
        if (!url) return ''
        switch (type) {
            case 'openai':
                // A pasted full endpoint is trimmed back to its base
                if (/\/chat\/completions(\?.*)?$/i.test(url)) {
                    return url.replace(/\/chat\/completions(\?.*)?$/i, '')
                }
                if (!apiPath || hasVersionSegment(url)) {
                    return url
                }
                return `${url}${apiPath}`
        }
        throw new Error(`Unsupported provider type: ${type}`)
    },
    /**
     * Build the chat completions endpoint.
     */
    apiUrl(type: ProviderType, apiUrl: string, apiHost: string = '', apiPath: string = '/v1') {
        const url = normalizeBaseUrl(apiHost || '') || normalizeBaseUrl(apiUrl || '')
        if (!url) return ''
        // A pasted full endpoint is kept as is
        if (/\/chat\/completions(\?.*)?$/i.test(url)) {
            return url
        }
        const base = this.baseUrl(type, apiUrl, apiHost, apiPath)
        return base ? `${base}/chat/completions` : ''
    },
    /**
     * Build the model list endpoint (`/models`), used by the pull-models action.
     */
    modelsUrl(type: ProviderType, apiUrl: string, apiHost: string = '', apiPath: string = '/v1') {
        const base = this.baseUrl(type, apiUrl, apiHost, apiPath)
        return base ? `${base}/models` : ''
    },
    async chat(
        prompt: string,
        chatParam: ChatParam,
        config: {
            type: ProviderType
            modelId: string
            apiUrl: string
            apiHost: string
            apiKey: string
            apiPath?: string
        },
    ): Promise<ModelChatResult> {
        let url = this.apiUrl(config.type, config.apiUrl, config.apiHost, config.apiPath)
        if (!(config.type in ModelProviderMap)) {
            return {
                code: -1,
                msg: `Unsupported provider type: ${config.type}`,
            }
        }
        const provider = new ModelProviderMap[config.type]({
            ...config,
            url,
        })
        try {
            return provider.chat(prompt, chatParam)
        } catch (e) {
            return {
                code: -1,
                msg: `Request failed: ${mapError(e)}`,
            }
        }
    },
}
