# LinkAndroid · 新建任务弹窗布局修复

## 问题

「新建任务 / 编辑任务」弹窗即使窗口最大化也显示不全，底部内容被裁掉。

根因是三处高度叠加，互相不兼容：

| 层 | 原值 | 说明 |
| --- | --- | --- |
| `.arco-modal-container` | `height: calc(100vh - 96px)` | 模板 `:style` 实际落在容器上（不是弹窗上） |
| `.arco-modal-wrapper` | `padding: 48px 0` | `src/style.less` 里的全局弹窗样式 |
| 内容根节点 | `height: calc(100vh - 166px)` | 模板里写死的第二套算法 |

弹窗真实高度 = `48(标题) + (100vh − 166)`；而容器的可用高度只有
`100vh − 96 − 48(上内边距)`，所以底部固定溢出，body 上 `overflow: auto`
只能靠滚动看到最后一段。

## 修法

改成「容器铺满视口 + 弹窗纵向 flex + 内部各自滚动」，不再用 vh 手算：

- 容器 `height: 100vh`，wrapper 上下留白 12px；
- 弹窗高度 `calc(100vh - 24px)`，`display: flex; flex-direction: column`；
- body `flex: 1; min-height: 0; padding: 0`；
- 内容根节点 `flex: 1; min-height: 0`（去掉写死的 `calc(100vh - 166px)` 和 `-my-6` 负边距）。

### 源码侧（推荐，重新打包即生效）

- `src/pages/Task/TaskEditorDialog.vue`：`a-modal` 增加
  `modal-class="task-editor-modal"`、`body-class="task-editor-modal-body"`，
  去掉 `:style` 与内层的 `height` / 负边距；
- `src/style.less`：新增 `.task-editor-modal` 相关规则（用 `:has()` 定位容器）。

### 已安装版本（不改源码，直接修 asar）

```bash
node scripts/ui-patch/apply.cjs             # 默认 %LOCALAPPDATA%\Programs\LinkAndroid
node scripts/ui-patch/apply.cjs --dry-run
node scripts/ui-patch/apply.cjs --revert    # 只移除本补丁的 <style>
```

脚本把 [task-editor-dialog.css](task-editor-dialog.css) 注入
`dist/index.html` 的 `<style id="la-ui-patch">`。已构建产物里没有
`task-editor-modal` 类，因此这份 CSS 额外用 `[style*='width: 95vw']`
作为选择器锚点（该弹窗是应用里唯一 `width: 95vw` 的 Modal）。

运行前请退出 LinkAndroid。asar 只改动 `dist/index.html` 一个条目，其余条目不变。

## 验证

用 CDP（`--remote-debugging-port=9222`）在真实应用里量过 1920×1040、
1600×900、1366×728、1100×680 四种视口：

- 弹窗底边 = 视口高度 − 12，`clippedCount = 0`；
- wrapper `scrollHeight == clientHeight`（不再出现内部滚动条）；
- 代码编辑器可见高度 755 / 535 px，工具栏 `scrollWidth == clientWidth`（无横向溢出）。
