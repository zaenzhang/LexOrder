# LexOrder 文书与交付交互预览 · v2

本目录整理本轮两案合成数据的 LexOrder / Chronicle 文书工作台预览。请从 `index.html` 打开；这是上一轮原有预览的原位更新，不是另一套新 HTML。

## 主要产物

- `index.html`：可交互预览入口。包括统一 Chronicle 侧栏、文书/交付三栏工作台、模板起草全屏页、居中 Dialog、可切换固定文件预览。
- `review.md`：业务事实矩阵、入口映射、界面约束、迁移边界、两轮设计记录和验证口径。
- `verification-v2.txt`：本轮 Chromium 实际交互验证结果。
- `verification.txt`：上一轮验证记录，仅作历史参考。
- `rendered/`：当前预览截图。
- `source/`：隔离预览源码、合成数据、原始 React 组件、样式、构建与验证脚本。

## 本轮 v2 改动

1. 小操作统一居中 Dialog，不再从右侧滑出。
2. 提高列表、表单、状态、Inspector 和侧栏文字的可读性；精简模板页右侧重复说明。
3. 固定文件原件在正文区只读预览，可切换同案文书版本和材料；文件名相同仍以版本和 ID 区分。
4. 切换预览不改变当前复核/交付对象或 URL；从材料分区进入默认显示首个可读文件，关闭后保持关闭。
5. 延续统筹统一侧栏，不新建文书左侧分类或顶部业务 Tabs。

## 验证

在容器中用 Chromium 实际执行点击验证，结果见 `verification-v2.txt`。`source/verify.cjs` 是静态检查，`source/verify-polish-v2.py` 是 Chromium 交互回归脚本。

## 限制

- 所有案件、文书、材料和事件均为本地合成数据。
- 文件预览展示合成正文文本，不是 PDF/DOCX 二进制渲染器。
- 不连接生产 API，不修改 LexOrder 正式业务页，不涉及正式 Git 分支或 PR。
- 原生 Tauri WebView、Windows 系统文件打开和真实 Editor 集成仍待验证。

## 重建

只更新增强脚本后，运行：

```bash
node source/rebuild-in-place.cjs
```

这会将 `source/src/postprocess.js` 写回现有 `index.html` 的最后一个 inline script，保留原 React bundle。`source/build.cjs` 是完整源代码重建入口，需要原项目依赖环境。

## GitHub 跟踪

- 正式实现任务：[Issue #36 — 文书台交互收敛](https://github.com/zaenzhang/LexOrder/issues/36)
- 相关材料工作区：[Issue #35](https://github.com/zaenzhang/LexOrder/issues/35)，文件预览组件/读取契约需要与材料组协调复用。
