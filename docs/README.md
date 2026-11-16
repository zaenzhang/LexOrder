# LexOrder 文档导航

更新日期：2026-11-16。`docs/` 仅保留以下四份主文档和本导航页。需求、架构、任务与研究各有一个现行入口。

| 需要回答的问题 | 主文档 | 内容 |
| --- | --- | --- |
| 做什么、怎样使用、怎样验收 | [产品需求、技能与界面](PRODUCT_REQUIREMENTS_ACCEPTANCE.md) | RQ01—RQ20、SK01—SK12、界面、专业质量与完整工作包 |
| 怎样实现、运行和交付 | [架构、部署发布与审查](REFACTOR_DESKTOP_TEAM_RAG.md) | Server、可选 RAG/模型/MCP、搁置设计、审查；第 11 节维护当前开发、部署和恢复说明 |
| 先做什么、完成到哪里 | [实施计划与交接](WORKBENCH_PLAN.md) | 最初 M0—M6 路线、办案痛点与 W/RQ/AC 对照、当前批次、证据和关闭条件 |
| 依据是什么、参考哪些项目 | [研究与决策依据](RESEARCH_AND_DECISIONS.md) | 固定项目来源、采用/许可边界；§3.5 深读模块与 SK01—SK12 对照；全球律所官方资料 |

当前交付仅为 Server；Personal/Windows 搁置，AI、OCR、RAGFlow 及法库/MCP 按需启用。M2 的原业务预览已收口；M3 保留范围的代码已合入，案件工作区、争点研究及实际业务和专业验收尚未完成；M4 发行、升级与恢复待完成。具体阶段、暂缓范围及证据见[现行路线](WORKBENCH_PLAN.md#11-第一阶段的终点与范围)和[当前待办](WORKBENCH_PLAN.md#820-合并后的案件工作区优化计划2026-11-16)。

## 维护方式

- 产品行为与技能改需求，技术与运行说明改架构，状态与证据改实施计划，项目来源改研究依据；不再新增同义方案、独立交接摘要或重复清单。保留 RQ/SK/W、子任务、AC 及 H/A 来源编号，不为清理重排标识。
- 入口和简明参考项目清单维护在[根 README](../README.md#参考项目清单)；协作规则见 [AGENTS.md](../AGENTS.md)。
- 已完成和过时的详细过程归入 Git：本轮整理前的[完整实施记录](https://github.com/zaenzhang/LexOrder/blob/b1b213f/docs/WORKBENCH_PLAN.md)，更早的[四文档归并前快照](https://github.com/zaenzhang/LexOrder/tree/1e1a6467c43667a36c6c23da82589a3329e6091b/docs)。不另维护重复的归档目录；当前关闭标准、未完成项和证据入口保留在主文档。
- 源码注释和归档迁移中的旧文档路径用于标识历史出处，可在上述快照查阅；不作为现行设计入口。正式迁移与历史模型夹具的内容、校验值保持不变。
- 旧财务演练 SQL 与已有归档迁移相同，演练脚本改用 [归档迁移](../prisma/migrations-archive-20260921/20260919000002_business_workflow_repair/migration.sql)；新演练输出留在忽略提交的 `.runtime/`，不写回 `docs/`。这些脚本不属于当前安装或升级步骤。
