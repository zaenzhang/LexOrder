# LexOrder · 案卷材料工作区 v9 评审产物

关联：[Issue #35](https://github.com/zaenzhang/LexOrder/issues/35)。本目录**只包含交互预览和审查证据**，不属于正式界面、业务服务或 Tauri 集成。

## 文件

| 文件 | 内容 |
| --- | --- |
| [LexOrder-Materials-Workflow-v9.html](LexOrder-Materials-Workflow-v9.html) | 最新独立、可点击 HTML 预览；双案合成数据 |
| [LexOrder-Materials-Workflow-v8.html](LexOrder-Materials-Workflow-v8.html) | 上一轮设计基线 |
| [lexorder-unified-sidebar-preview.html](lexorder-unified-sidebar-preview.html) | 用户提供的统一侧栏参考，保留原始文件 |
| [LexOrder-Materials-Workflow-v9-Review.md](LexOrder-Materials-Workflow-v9-Review.md) | 事实矩阵、业务决策、UI 规则及验收条件 |
| [LexOrder-Materials-Workflow-v9-Evidence.md](LexOrder-Materials-Workflow-v9-Evidence.md) | 源码路径及已核对/未覆盖事实 |
| [LexOrder-Materials-Workflow-v9-QA.md](LexOrder-Materials-Workflow-v9-QA.md) | 19 项静态检查结果 |
| [QA.py](QA.py) | 可在当前目录运行的检查脚本（基于原包脚本，改为相对路径） |
| [LexOrder-Materials-Workflow-v9-README.md](LexOrder-Materials-Workflow-v9-README.md) | 原评审包 README |
| [LexOrder-Materials-Workflow-v9-Review-Package.zip](LexOrder-Materials-Workflow-v9-Review-Package.zip) | **原始完整打包产物**：包括 build_v9.py、原始 QA.py、app.js、v8/v9 HTML、来源文档及 v7 历史截图 |

## 查看与复验

下载 HTML 到本地，在桌面浏览器打开 `LexOrder-Materials-Workflow-v9.html`。材料页单击文件名后在右侧阅读；添加材料用居中 Dialog；案件目录为允许的侧栏 Sheet 例外。所有交互只处理合成数据。

需要 Python 3、`beautifulsoup4` 和 Node.js（`node --check`）。在本目录执行：

```bash
python QA.py
```

**验证边界：** 19/19 是静态结构与语法检查，并非浏览器端到端测试。当前证据没有覆盖真实 Tauri、Word/WPS 默认编辑器、文件落盘/回传、PostgreSQL 及外盘拔插。原始 v7 图片仅为旧版历史参考，不代表 v9 当前效果。ZIP 中原始 QA.py 包含旧容器的绝对路径；仓库根目录的 `QA.py` 是相对路径可复跑版本。

## 已确认的 UI 边界

- 材料类型、来源、状态、卷宗、版本互相独立；工作稿是派生操作视图，不是材料类别；“法院来件”是独立工作流。
- 材料文件名打开正文；左侧列表与右侧阅读区长期保留。
- 添加材料：选择文件 → 逐件核对 → 逐件提交与回执；失败与未知结果有不同恢复路径。
- 普通材料详情与操作用 Dialog；仅案件目录等持续多状态信息考虑 Sheet。
- 显示信息以必要字段和清晰动作优先，减少重复微文案。

本 PR 用于跨包评审和后续实现交接；不应被当成界面已正式上线。
