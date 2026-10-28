# LinkAndroid · 大模型 VIP 限制移除

内置模型（`buildIn` / `llmpx`）的 API 地址、密钥、能量额度都来自服务端
`app_manager/user_info`，非会员拿到 `quota: 0, apiUrl: null, apiKey: null`，
客户端据此弹「登录 / 充值 / 激活 VIP」。官方中转地址只按会员下发，
客户端无法凭空取得，所以这里的做法是：

1. **拆掉客户端所有 VIP 门槛**：会员标记、额度、登录校验、升级页。
2. **把内置模型供应商变成可配置端点**：填任意 OpenAI 兼容的
   `apiUrl` + `apiKey` 即可让「内置模型」正常工作；不填时保持服务端下发的值。
3. 附带效果：47+ 自定义供应商原本在非会员下会显示「VIP 专属功能」，
   现在直接可用（自带 Key 就能对话）。

## 两种落地方式

### A. 直接改已安装的程序（不解包源码，最快）

```bash
node scripts/llm-unlock/apply.cjs                 # 默认 %LOCALAPPDATA%\Programs\LinkAndroid
node scripts/llm-unlock/apply.cjs --target "D:\Apps\LinkAndroid"
node scripts/llm-unlock/apply.cjs --revert        # 还原 app.asar.orig
```

脚本会：

- 备份 `resources/app.asar` → `resources/app.asar.orig`（已存在则保留）；
- 在主进程入口 `dist-electron/main/index.js` 顶部注入 hook；
- 删除渲染层 `Task` 分块里的三处发送前校验（登录 / apiUrl / 额度）；
- 往 `dist/index.html` 内联 `ui-pull-models.js`，在「模型设置 → 模型列表」
  下方加上「拉取模型列表」按钮（仅自定义供应商显示，官方面板不显示）；
- 生成 `resources/llm-unlock.json` 配置模板（已存在则保留）。

运行前请**退出 LinkAndroid**。asar 只改动上述三个文件，其余 15000+ 条目保持原样。

「拉取模型列表」的行为：读取当前供应商的 `apiHost` + `apiKey`，请求
`GET {apiHost}/models`，过滤掉 embedding / rerank / 语音 / 绘图模型后合并进
`storage/models.json`（已存在的只启用、不覆盖名称与能力），随后自动刷新界面。
也可以手动调用 `window.__laPullModelsUI.pull('<providerId>')`。

### B. 从源码构建

源码侧已经改好，直接按原流程打包即可：

- `electron/llm-unlock.ts` —— 主进程 fetch 拦截器，由
  `electron/main/index.ts` 里 `import '../llm-unlock'` 引入；
- `src/hooks/user.ts` —— `isVip` 恒为 true；
- `src/pages/Task/TaskChatPanel.vue` —— 去掉 `buildIn` 的登录/额度前置校验；
- `src/module/Model/store/model.ts` —— 新增 `pullModels(providerId)`：请求
  `/models`、过滤非对话模型、合并进供应商并 `sync()`；
- `src/module/Model/provider/provider.ts` —— 抽出 `baseUrl()`，新增
  `modelsUrl()`（`apiUrl` 行为保持不变）；
- `src/module/Model/ModelSetting.vue` —— 「模型列表」标题右侧的
  「拉取模型列表」按钮（自定义供应商可见，官方隐藏，结果用 toast 提示）；
- `src/lang/{zh-CN,en-US}.ts` —— 对应文案。源码版的按钮走 store，拉取后
  列表就地刷新，不需要重载界面。

## 配置

改 `resources/llm-unlock.json`（或 `~/.linkandroid/llm-unlock.json`，
后者优先；也可用 `LINKANDROID_LLM_UNLOCK` 指定路径）后重启应用：

```json
{
  "enabled": true,
  "quota": 1000000000,
  "virtualUserId": 1,
  "apiUrl": "https://api.siliconflow.cn/v1",
  "apiKey": "sk-xxxxxxxx",
  "models": [
    {"name": "deepseek-ai/DeepSeek-V3", "label": "DeepSeek V3", "type": "text",
     "group": "Default", "caps": {"tools": true, "vision": false}}
  ]
}
```

| 字段 | 作用 |
| --- | --- |
| `enabled` | `false` 关闭全部改动，恢复原版行为 |
| `quota` | 客户端显示的「能量」，仅影响 UI 与前置校验 |
| `virtualUserId` | 未登录时伪造的用户 id，绕开登录校验 |
| `apiUrl` / `apiKey` | 内置模型供应商的端点；留空则用服务端下发的值 |
| `models` | 覆盖内置模型列表（名字必须和你的端点一致） |

常见端点：

- DeepSeek `https://api.deepseek.com/v1`
- 硅基流动 `https://api.siliconflow.cn/v1`
- OpenRouter `https://openrouter.ai/api/v1`
- 本地 Ollama `http://127.0.0.1:11434/v1`（Key 随便填，如 `ollama`）
- one-api / new-api 自建中转 `https://your-relay/v1`

> 说明：服务端中转与额度校验在服务器侧，客户端改动不会凭空产生官方额度。
> 想让「内置模型」真的能对话，需要按上表填自己的端点；否则请直接添加
> 自己的供应商（现在不再被 VIP 墙拦住）。
