# 产物清单

## 当前 v2 交付

| 文件 | 用途 |
|---|---|
| `index.html` | 原有两案交互预览，已原位更新 |
| `review.md` | 事实矩阵、路由映射、迁移边界、设计评审和 v2 交互决策 |
| `review.html` | `review.md` 的浏览器阅读版 |
| `README.md` | 打开方式、产物说明、验证和限制 |
| `请先阅读.txt` | 简明使用说明 |
| `verification-v2.txt` | Chromium 实际交互回归结果 |
| `verification-static-v2.txt` | Node 静态结构与脚本语法检查结果 |
| `rendered/workbench-polish-v2.png` | 文书台主界面 |
| `rendered/file-preview-switchable.png` | 可切换固定文件预览，显示 V1/V2 与当前复核对象 |
| `rendered/centered-dialog.png` | 短操作居中 Dialog |
| `rendered/template-step1-polish-v2.png` | 模板选择步骤 |
| `rendered/template-step2-readable.png` | 文书填写步骤 |
| `rendered/template-step3-polish-v2.png` | 生成前核对步骤 |

## 源码与复验

- `source/src/App.jsx`、`source/src/actions.js`、`source/src/data.js`：原始合成 React 应用、动作和数据。
- `source/src/postprocess.js`：统一侧栏、文书台、模板工作页、Dialog 与文件预览增强。
- `source/src/design.css`、`source/src/theme.css`：隔离预览的基础主题样式。
- `source/initial-seed.json`：两案合成初始数据。
- `source/rebuild-in-place.cjs`：将后处理脚本写回原有 `index.html`，不生成第二份 HTML。
- `source/verify.cjs`：静态结构与脚本语法检查。
- `source/verify-polish-v2.py`：Chromium 实际交互回归。
- `source/build.cjs`：依赖完整的原始构建入口。
- `source/polish-v2.py`、`source/patch_unified.py`：本轮及上一轮源码修订脚本。

## 历史参考

- `rendered/workbench.png`、`rendered/workbench-viewport.png`、`rendered/template-step*.png`：前一轮界面截图。
- `rendered/template-workbench.png`、`rendered/template-step*-viewport.png`：前一轮模板流程截图。
- `preview-unified-sidebar.png`、`shell-refresh.css`：统一侧栏方案的历史参考产物。
- `verification.txt`：前一轮验证日志。
- `source/src/postprocess.pre-unified.js`、`source/verify-previous.cjs`：上一轮预处理脚本和验证脚本。

## GitHub 跟踪

- 正式实现：[Issue #36](https://github.com/zaenzhang/LexOrder/issues/36)
- 相关材料工作区：[Issue #35](https://github.com/zaenzhang/LexOrder/issues/35)

本轮未修改正式业务代码、schema、公共 API、Tauri 壳或 Git 分支。全部数据为合成数据。文件预览目前是合成文本视图，不是实际 PDF/DOCX 二进制渲染。
