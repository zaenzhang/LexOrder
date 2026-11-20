# LexOrder Materials Workflow v9

本包是案件材料工作区的隔离交互预览与评审记录，不是正式 Tauri 页面，也没有修改 LexOrder 仓库。

## 文件

- `LexOrder-Materials-Workflow-v9.html` — 最新可交互 HTML。
- `LexOrder-Materials-Workflow-v8.html` — 上一轮预览基线。
- `lexorder-unified-sidebar-preview.html` — 用户提供的统一侧栏参考。
- `LexOrder-Materials-Workflow-v9-Review.md` — 事实矩阵、分类来源、业务规则、交互判断、样式来源和正式实现验收条件。
- `LexOrder-Materials-Workflow-v9-Evidence.md` — GitHub 基线源码证据与边界。
- `LexOrder-Materials-Workflow-v9-QA.md` / `QA.py` — 19 项静态检查及复跑脚本。
- `evidence/LexOrder-Materials-Workflow-v7.png` — v7 左右分栏旧版截图，只作为历史布局参考，不是 v9 截图。

## 打开

直接在桌面浏览器打开 `LexOrder-Materials-Workflow-v9.html`。使用顶部导航切换案件；在材料列表中点击文件名打开右侧阅读区；点击“添加材料”查看接件 Dialog；点击“案目录”查看保留的目录状态 Sheet。

## 验证

```bash
python QA.py
```

当前检查覆盖 HTML 结构、内嵌 JavaScript 语法、业务字段断言和关键交互结构。浏览器自动化、Tauri 原生文件关联、数据库与物理磁盘测试不在本轮结果范围内。
