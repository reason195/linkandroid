// ---------------------------------------------------------------------------
// LinkAndroid LLM unlock (injected shim)
// Removes the paid-membership gate for the built-in model provider.
// Config: <resources>/llm-unlock.json  or  ~/.linkandroid/llm-unlock.json
// ---------------------------------------------------------------------------
import __laFs from "node:fs";
import __laOs from "node:os";
import __laPath from "node:path";
;(() => {
    const __laLog = (...a) => {
        try {
            console.log("[llm-unlock]", ...a);
        } catch (e) {}
    };
    const __laCfg = {
        enabled: true,
        quota: 1000000000,
        virtualUserId: 1,
        apiUrl: "",
        apiKey: "",
        models: null,
    };
    const __laPaths = [];
    try {
        if (process.resourcesPath) __laPaths.push(__laPath.join(process.resourcesPath, "llm-unlock.json"));
    } catch (e) {}
    try {
        __laPaths.push(__laPath.join(__laOs.homedir(), ".linkandroid", "llm-unlock.json"));
    } catch (e) {}
    if (process.env && process.env.LINKANDROID_LLM_UNLOCK) __laPaths.push(process.env.LINKANDROID_LLM_UNLOCK);
    for (const p of __laPaths) {
        try {
            if (__laFs.existsSync(p)) Object.assign(__laCfg, JSON.parse(__laFs.readFileSync(p, "utf-8")) || {});
        } catch (e) {
            __laLog("config read error", p, String(e));
        }
    }
    if (__laCfg.enabled === false) {
        __laLog("disabled by config");
        return;
    }
    const __laDecorate = (json) => {
        if (!json || typeof json !== "object") return;
        const root = json.data;
        if (!root || typeof root !== "object") return;
        const bucket = root.data && typeof root.data === "object" ? root.data : root;
        if (bucket.vip && typeof bucket.vip === "object") {
            const vip = bucket.vip;
            vip.isDefault = false;
            if (!vip.flag || vip.flag === "default") vip.flag = "vip";
            if (!vip.title || vip.title === "普通会员") vip.title = "VIP";
        }
        if (bucket.llmpx && typeof bucket.llmpx === "object") {
            const lp = bucket.llmpx;
            const q = Number(__laCfg.quota);
            lp.quota = Number.isFinite(q) && q > 0 ? q : 1000000000;
            if (Array.isArray(__laCfg.models) && __laCfg.models.length) lp.models = __laCfg.models;
            if (__laCfg.apiUrl) lp.apiUrl = __laCfg.apiUrl;
            if (__laCfg.apiKey) lp.apiKey = __laCfg.apiKey;
            if (lp.apiKey === null || lp.apiKey === undefined) lp.apiKey = "";
        }
        const user = root.user && typeof root.user === "object" ? root.user : null;
        if (user && !user.id) {
            user.id = __laCfg.virtualUserId || 1;
            if (!user.name || user.name === "-") user.name = "LinkAndroid User";
        }
    };
    const __laOrigFetch = globalThis.fetch;
    if (typeof __laOrigFetch === "function") {
        globalThis.fetch = async function (input, init) {
            const res = await __laOrigFetch.apply(this, arguments);
            try {
                let url = "";
                if (typeof input === "string") url = input;
                else if (input && typeof input === "object" && typeof input.url === "string") url = input.url;
                if (url.indexOf("app_manager/user_info") < 0) return res;
                const text = await res.text();
                let json = null;
                try {
                    json = JSON.parse(text);
                } catch (e) {
                    json = null;
                }
                if (!json) {
                    return new Response(text, {
                        status: res.status,
                        statusText: res.statusText,
                        headers: {"content-type": "application/json"},
                    });
                }
                __laDecorate(json);
                return new Response(JSON.stringify(json), {
                    status: res.status,
                    statusText: res.statusText,
                    headers: {"content-type": "application/json"},
                });
            } catch (e) {
                return res;
            }
        };
        __laLog("user_info hook installed");
    } else {
        __laLog("fetch unavailable");
    }
})();
