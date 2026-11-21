# LexOrder · 庭审对抗分析实验归档（V8.5）

关联研究 Issue：[#33](https://github.com/zaenzhang/LexOrder/issues/33)。此目录只含实验输入、独立复现产物、UI 隔离预览、运行记录与证据；**不修改正式案件业务代码**。

## 从哪里开始

1. **交互预览**：下载本目录后，在浏览器打开 [LexOrder-诉讼分析工作台-实验预览-v8.5.html](LexOrder-诉讼分析工作台-实验预览-v8.5.html)。与该文件同目录下的证据、Excel、PDF、SVG 和报告可由预览中的“实验依据”视图打开。
2. **分析**：[实验分析-第二轮.md](实验分析-第二轮.md)、[实验记录.md](实验记录.md)、[来源与产物清单.json](来源与产物清单.json)、[实验测试结果-v8.5.json](实验测试结果-v8.5.json)。
3. **原始示例**：[上游 matrix-input.json 固定副本](source-evidence/upstream-matrix-input.json)，GitHub 上游 blob SHA `1b90bf714a184ba35954fdbe7d13627c488fe03d`。
4. **Excel**：[结构复核版](庭审对抗分析-示例-结构复核版.xlsx)、[第一轮复现版](庭审对抗分析-示例-初次复现版.xlsx)、[按注释理解版](庭审对抗分析-示例-按注释理解版.xlsx)。不要覆盖历史版本。
5. **可视化证据**：[争点攻防截图](V8.5-争点攻防.png)、[庭审对抗图截图](V8.5-庭审对抗图.png)、[实验依据截图](V8.5-实验依据.png)、[首次手工 SVG 示意](庭审对抗图-结构预览.svg)、[PDF 打印效果](pdf-preview/庭审对抗分析-示例.pdf)。
6. **全部历史实验档案**：见 [archive/README.md](archive/README.md)，使用 13 个二进制分块无损还原原始 `LexOrder-NLV-庭审对抗实验档案-v8.5.zip`。

## 方法和业务边界

参考 [MiaoQichuan/new-litigation-visualization](https://github.com/MiaoQichuan/new-litigation-visualization/tree/main/plugins/mqc-nlv/skills/mqc-trial-confrontation-master)，固定上游 commit `16c480c3947e78ba49623423ea0486277f5fe99d`，版本 1.1.0，许可 AGPL-3.0-only。

围绕诉请/反诉、请求权基础或法律关系、构成要件、争议待证要件、四段攻防、证据评价和律师确认组织分析。原文记载、AI 推导、律师确认与待核实必须分开；没有固定原文引用时不能伪造文书名、版本或页码。

示例有待核事项：形成之诉 P1 仍以要件行表达；反诉 P3 无明确 `claim_ref`；四段攻防缺少逐段 `src`；“未获取质证意见”与“无书面记载”冲突；证据未提供固定 Document ID/版本/页码。具体见分析报告及 Issue。

## 核验状态

- Chromium/Playwright 隔离 HTML 点击检查已完成：多视图、17 列 / 4 条要件、深链、案内菜单禁用、切案隔离、实验产物相对路径、无 JS 异常。
- Excel 独立结构复现：17 列、26 行，冻结 B8，筛选 A7:Q20。
- **未运行上游原版** `pipeline.py` / `build_matrix.py` / `render_main.py`；未做 Windows Tauri 实机、服务端写入或跨浏览器重启持久化验证。
- 当前 GitHub 访问是经连接器取得上游文件；实验时 shell clone 因 DNS 无法解析而失败。第一轮 SVG 的文字重叠作为失败证据保留，不应称为上游官方渲染。

此 PR 仅提交实验材料，正式业务重构须待跨组业务/数据/UI 评审完成后另开实施 PR。
