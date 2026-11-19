# LexOrder 文档导航

更新日期：2026-11-19。`docs/` 的文字入口为以下四份主文档和本导航页；另保留主文档引用的演练证据和交互预览。需求、架构、任务与研究各有一个现行入口，不另建平行报告。

| 需要回答的问题 | 主文档 | 内容 |
| --- | --- | --- |
| 做什么、怎样使用、怎样验收 | [产品需求、技能与界面](PRODUCT_REQUIREMENTS_ACCEPTANCE.md) | RQ01—RQ20、SK01—SK12、界面、专业质量与完整工作包 |
| 怎样实现、运行和交付 | [架构、部署发布与审查](REFACTOR_DESKTOP_TEAM_RAG.md) | Server、可选 RAG/模型/MCP、搁置设计、审查；第 11 节维护当前开发、部署和恢复说明 |
| 先做什么、完成到哪里 | [实施计划与交接](WORKBENCH_PLAN.md) | 最初 M0—M6 路线、办案痛点与 W/RQ/AC 对照、当前批次、证据和关闭条件 |
| 依据是什么、参考哪些项目 | [研究与决策依据](RESEARCH_AND_DECISIONS.md) | 固定项目来源、采用/许可边界；§3.5 深读模块与 SK01—SK12 对照；全球律所官方资料 |

当前仅推进 Server 业务；Personal/Windows 搁置，AI、OCR、RAGFlow 及法库/MCP 按需启用。M2 的原业务预览已收口；M3 已合入案件范围/状态、争点进入研究、人工复核、任务等待/依赖和实际交付，仍有具体入口及业务正确性缺口，完整桌面业务链与律师专业验收未完成。M4 发行、升级、恢复及所有非业务维护全部延期，不作当前业务门禁。阶段见[现行路线](WORKBENCH_PLAN.md#11-第一阶段的终点与范围)，本轮执行范围与状态统一见[合并后的业务实施计划](WORKBENCH_PLAN.md#714-两份审查报告合并后的业务实施计划2026-11-17)；§8.20保留修复前计划，不能作为当前待办。

本轮云端案件演练的场景、10组问题、8组设计建议及22张截图索引见[研究 §3.25](RESEARCH_AND_DECISIONS.md#325-云端案件演练与界面审查2026-11-17)，原归档与验证边界见[计划 §8.27](WORKBENCH_PLAN.md#827-云端案件演练证据归档2026-11-17)。后续独立收案组已完成F03/F04/F05/F06/F09及D01/D04的开发修复，三阶段89个定点场景通过，见[计划 §8.32](WORKBENCH_PLAN.md#832-独立收案审批与案由修复2026-11-17)；旧截图保留为修复前证据，真实浏览器与律师专业验收另行登记。

**多个agent协作入口：先读[当前认领与跨分支协作](WORKBENCH_PLAN.md#7144-当前认领与跨分支协作2026-11-17)。** 该表标明各组在办、已认领待实施及已交付的业务、共享文件、验证边界及未认领问题。每次开工前及每阶段结束核对可见agent、账本、最新main和相关分支，先复用已完成成果；本批提交后优先无人认领的保留业务，延期与候选范围不自动恢复。

案件文书交互预览已获用户认可。可以下载[独立 HTML](evidence/2026-11-18-document-preview/lexorder-case-documents-preview.html)后用浏览器打开，也可以查看[案件材料截图](evidence/2026-11-18-document-preview/lexorder-case-documents-preview.png)和[文书模板截图](evidence/2026-11-18-document-preview/lexorder-case-templates-preview.png)。设计见[需求 §9.4.9](PRODUCT_REQUIREMENTS_ACCEPTANCE.md#949-案件内的文书模板与连续编辑g052026-11-18)，真实演练与模拟验证见[计划 §8.55](WORKBENCH_PLAN.md#855-案件流程演练与文书交互预览2026-11-18)。

**本次 Semi 迁移分派见[协作计划 §7.17](WORKBENCH_PLAN.md#717-semi-迁移协作计划2026-11-18)。** 集成人先定公共基线，四个页面组按独占文件并行迁移。

**法律 Artifacts 与文书技能研究：**两篇文章、V8 案件看板和 `claude-for-legal-ZH` 文书/执行链的云端源码核查见[研究 §3.49](RESEARCH_AND_DECISIONS.md#349-claude-法律-artifacts-与案件看板源码研究2026-11-19)，本轮验证、未覆盖范围及原任务归口见[计划 §8.61](WORKBENCH_PLAN.md#861-法律-artifacts-与文书技能源码研究归档2026-11-19)。当前为研究成果与候选设计，未启动功能实施。

## 维护方式

- 产品行为与技能改需求，技术与运行说明改架构，状态与证据改实施计划，项目来源改研究依据；不再新增同义方案、独立交接摘要或重复清单。保留 RQ/SK/W、子任务、AC 及 H/A 来源编号，不为清理重排标识。
- 入口和简明参考项目清单维护在[根 README](../README.md#参考项目清单)；协作规则见 [AGENTS.md](../AGENTS.md)。
- 已完成和过时的详细过程归入 Git：本轮整理前的[完整实施记录](https://github.com/zaenzhang/LexOrder/blob/b1b213f/docs/WORKBENCH_PLAN.md)，更早的[四文档归并前快照](https://github.com/zaenzhang/LexOrder/tree/1e1a6467c43667a36c6c23da82589a3329e6091b/docs)。不另维护重复的归档目录；当前关闭标准、未完成项和证据入口保留在主文档。
- 源码注释和归档迁移中的旧文档路径用于标识历史出处，可在上述快照查阅；不作为现行设计入口。正式迁移与历史模型夹具的内容、校验值保持不变。
- 旧财务演练 SQL 与已有归档迁移相同，演练脚本改用 [归档迁移](../prisma/migrations-archive-20260921/20260919000002_business_workflow_repair/migration.sql)；新演练输出留在忽略提交的 `.runtime/`，不写回 `docs/`。这些脚本不属于当前安装或升级步骤。
