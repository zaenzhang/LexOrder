# LexOrder 文档导航

更新日期：2026-11-16。现行方案由原八份方向性文档合并为 **四份主文档**，按问题归类；不再把发布、UI、技能和交接各拆一份。此页只负责导航。既有专项设计、迁移与验证保持原路径及事实，不复制、改写或丢弃历史证据。

## 1. 当前主文档

| 阅读目的 | 主文档 | 内容归属 |
| --- | --- | --- |
| 做什么、怎样使用、怎样判断有用 | [产品需求、专业技能与界面](PRODUCT_REQUIREMENTS_ACCEPTANCE.md) | 用户需求 RQ、SK01—SK12、界面、专业质量与场景验收 |
| 怎样实现和发行、有哪些边界 | [架构、双版本发布与审查](REFACTOR_DESKTOP_TEAM_RAG.md) | TS/个人存储、本机操作者、两版 API/RAG、发布物、试验证据与审查 |
| 先做什么、已做什么、还差什么 | [实施计划与交接](WORKBENCH_PLAN.md) | W01—W17、阶段依赖、已完成/未完成、验证记录与继续工作约束 |
| 为什么这样决定、证据在哪里 | [研究与决策依据](RESEARCH_AND_DECISIONS.md) | 项目来源、固定版本、采用/许可边界、官方招聘样本与技能映射 |

最新要求：Personal 无用户认证，Server 保留团队认证；两版均可连接独立模型 API；性能仅观察、不作门禁；内容优先、减少装饰；每个正式 release 两种可用产物同时提供。旧文档如有相反的发行、登录或性能假设，以以上主文档与 AGENTS 顶部为准；既有财务、数据、业务确认与审计规则不因分类改变。

## 2. 原拆分内容的去向

| 原文档 | 合并位置 |
| --- | --- |
| `LEGAL_SKILLS_CATALOG.md` | 产品需求第 10—15 节，技能编号及详细契约保留 |
| `RELEASE_VARIANTS_AND_RESOURCE_BUDGET.md` | 架构第 2、3、8 节；取消原性能门槛 |
| `PROJECT_HANDOFF.md` | 实施计划第 7—9 节，历史结果与未覆盖范围保留 |
| `UPSTREAM_SOURCES.md` | 研究依据第 1—6 节，实际采用与许可记录保留 |
| `LAW_FIRM_COMPETENCY_RESEARCH.md` | 研究依据第 7 节，H/A 来源编号及日期状态保留 |

旧文件已合并删除，原内容可从 Git 历史查看；仓内引用已迁移。新增考察先写入上述对应章节，避免再生成同义方案、摘要或并列路线。

## 3. 既有资料分类

以下是现有模块/操作/历史记录，不能单凭标题或曾通过的测试推断新增 Personal/RAG 已完成。版本化升级说明只适用其标明的来源版本；旧 UI 图稿用于理解既有结构，后续呈现以当前产品需求第 9 节为准。

### 实际实施与验证记录

| 文件 |
| --- |
| [BUGFIX-20260906.md](BUGFIX-20260906.md) |
| [BUSINESS-WORKFLOW-FINAL-ACCEPTANCE-20260919.md](BUSINESS-WORKFLOW-FINAL-ACCEPTANCE-20260919.md) |
| [BUSINESS-WORKFLOW-FINANCE-TRIAL-20260919.md](BUSINESS-WORKFLOW-FINANCE-TRIAL-20260919.md) |
| [BUSINESS-WORKFLOW-LOCAL-CUTOVER-20260919.sql](BUSINESS-WORKFLOW-LOCAL-CUTOVER-20260919.sql) |
| [BUSINESS-WORKFLOW-LOCAL-CUTOVER-IMPACT-20260919.json](BUSINESS-WORKFLOW-LOCAL-CUTOVER-IMPACT-20260919.json) |
| [BUSINESS-WORKFLOW-LOCAL-CUTOVER-RESULT-20260919.json](BUSINESS-WORKFLOW-LOCAL-CUTOVER-RESULT-20260919.json) |
| [BUSINESS-WORKFLOW-LOCAL-CUTOVER-TRIAL-20260919.json](BUSINESS-WORKFLOW-LOCAL-CUTOVER-TRIAL-20260919.json) |
| [DEPENDENCY_AUDIT_20261115.md](DEPENDENCY_AUDIT_20261115.md) |
| [FORK_INTEGRATION_20261116.md](FORK_INTEGRATION_20261116.md) |
| [PUBLISH_READINESS_REPORT.md](PUBLISH_READINESS_REPORT.md) |
| [RELEASE-NOTES-v2.0.0-rc.1.md](RELEASE-NOTES-v2.0.0-rc.1.md) |
| [RELEASE-NOTES-v2.0.0.md](RELEASE-NOTES-v2.0.0.md) |
| [RELEASE-VALIDATION-v2.0.0-rc.1.md](RELEASE-VALIDATION-v2.0.0-rc.1.md) |
| [RELEASE-VALIDATION-v2.0.0.md](RELEASE-VALIDATION-v2.0.0.md) |
| [SYSTEM-AUDIT-20260920-ROUND5.md](SYSTEM-AUDIT-20260920-ROUND5.md) |
| [SYSTEM-AUDIT-20260920-ROUND6-v2.md](SYSTEM-AUDIT-20260920-ROUND6-v2.md) |
| [SYSTEM-AUDIT-20260920-ROUND6.md](SYSTEM-AUDIT-20260920-ROUND6.md) |
| [SYSTEM-AUDIT-20260920.md](SYSTEM-AUDIT-20260920.md) |
| [SYSTEM-AUDIT-20260921-ROUND7-v2.md](SYSTEM-AUDIT-20260921-ROUND7-v2.md) |
| [SYSTEM-AUDIT-20260921-ROUND7.md](SYSTEM-AUDIT-20260921-ROUND7.md) |
| [SYSTEM-AUDIT-20260921-ROUND8.md](SYSTEM-AUDIT-20260921-ROUND8.md) |
| [SYSTEM-AUDIT-REMEDIATION-V3-20260920.md](SYSTEM-AUDIT-REMEDIATION-V3-20260920.md) |
| [WORKBENCH_VALIDATION.md](WORKBENCH_VALIDATION.md) |

### 运行、部署、升级与发布操作

| 文件 |
| --- |
| [CLOUD-SERVER-INSTALLATION-GUIDE.md](CLOUD-SERVER-INSTALLATION-GUIDE.md) |
| [CLOUD_SETUP.md](CLOUD_SETUP.md) |
| [GITHUB_PUBLISHING_GUIDE.md](GITHUB_PUBLISHING_GUIDE.md) |
| [LawLink-云服务器安装指南.docx](LawLink-云服务器安装指南.docx) |
| [OPERATIONS.md](OPERATIONS.md) |
| [PUBLIC_RELEASE_CHECKLIST.md](PUBLIC_RELEASE_CHECKLIST.md) |
| [RELEASE-GUIDE-v1.3.md](RELEASE-GUIDE-v1.3.md) |
| [RELEASE-GUIDE-v2.md](RELEASE-GUIDE-v2.md) |

### 既有业务模型、流程与专项变更

| 文件 |
| --- |
| [ADMIN-CONSOLE-PLAN.md](ADMIN-CONSOLE-PLAN.md) |
| [APPROVAL-PERMISSIONS-MIGRATION.md](APPROVAL-PERMISSIONS-MIGRATION.md) |
| [ARCHIVE-BORROW-PLAN-20260921.md](ARCHIVE-BORROW-PLAN-20260921.md) |
| [ARCHIVE-REVIEW-PLAN.md](ARCHIVE-REVIEW-PLAN.md) |
| [BUSINESS-WORKFLOW-FINANCE-DESIGN-20260919.md](BUSINESS-WORKFLOW-FINANCE-DESIGN-20260919.md) |
| [BUSINESS-WORKFLOW-FINANCE-MIGRATION-20260919.sql](BUSINESS-WORKFLOW-FINANCE-MIGRATION-20260919.sql) |
| [BUSINESS-WORKFLOW-REPAIR-PLAN-20260919.md](BUSINESS-WORKFLOW-REPAIR-PLAN-20260919.md) |
| [DATA-MODEL.md](DATA-MODEL.md) |
| [DESKTOP-CONNECTOR-PLAN.md](DESKTOP-CONNECTOR-PLAN.md) |
| [IDENTITY-DOCUMENT-PLAN.md](IDENTITY-DOCUMENT-PLAN.md) |
| [LawLink-账号与审批权限改造方案.docx](LawLink-账号与审批权限改造方案.docx) |
| [MIGRATION-CHAIN-REBASELINE-PROPOSAL-20260921.md](MIGRATION-CHAIN-REBASELINE-PROPOSAL-20260921.md) |
| [P0-IMPLEMENTATION-PLAN.md](P0-IMPLEMENTATION-PLAN.md) |
| [P1-IMPLEMENTATION-PLAN.md](P1-IMPLEMENTATION-PLAN.md) |
| [PERSONAL-PROFILE-PLAN.md](PERSONAL-PROFILE-PLAN.md) |
| [PRD.md](PRD.md) |
| [REMINDER-DELIVERY-LEDGER-PLAN-20260921.md](REMINDER-DELIVERY-LEDGER-PLAN-20260921.md) |
| [ROADMAP.md](ROADMAP.md) |
| [ROLE-MANAGEMENT-MIGRATION.md](ROLE-MANAGEMENT-MIGRATION.md) |
| [ROLE-MANAGEMENT-PLAN.md](ROLE-MANAGEMENT-PLAN.md) |
| [SMS-B1-DESIGN-20260920.md](SMS-B1-DESIGN-20260920.md) |
| [TARGET-MODEL-PLAN.md](TARGET-MODEL-PLAN.md) |
| [TEAM-SYSTEM.md](TEAM-SYSTEM.md) |
| [UNIFIED-APPROVAL-WORKSPACE.md](UNIFIED-APPROVAL-WORKSPACE.md) |

### 既有界面、品牌与设计参考

| 文件 |
| --- |
| [BRAND.md](BRAND.md) |
| [LawLink-Brand-Guide.docx](LawLink-Brand-Guide.docx) |
| [LawLink-改进分析报告-20260913.docx](LawLink-改进分析报告-20260913.docx) |
| [LawLink-改进分析报告-v2-20260913.docx](LawLink-改进分析报告-v2-20260913.docx) |
| [LawLink-改进分析报告-v3-20260913.docx](LawLink-改进分析报告-v3-20260913.docx) |
| [LawLink-改进分析报告-v4-20260913.docx](LawLink-改进分析报告-v4-20260913.docx) |
| [LawLink-改进分析报告-v5-20260913.docx](LawLink-改进分析报告-v5-20260913.docx) |
| [UI-APPROVAL-DETAIL-PLAN.md](UI-APPROVAL-DETAIL-PLAN.md) |
| [UI-AUDIT-v4.md](UI-AUDIT-v4.md) |
| [UI-DESIGN.md](UI-DESIGN.md) |
| [UI-DIALOG-CONSISTENCY-PLAN.md](UI-DIALOG-CONSISTENCY-PLAN.md) |
| [UI-MATTER-DOSSIER-PLAN.md](UI-MATTER-DOSSIER-PLAN.md) |
| [UI-REFACTOR-PLAN-v4.md](UI-REFACTOR-PLAN-v4.md) |
| [UI-REVIEW-20260914.md](UI-REVIEW-20260914.md) |
| [UI-V4-REBUILD-PLAN.md](UI-V4-REBUILD-PLAN.md) |

### 页面参考与工具

- [mockup](mockup/)：历史 HTML/样式与页面方案，按其目录版本阅读；不是当前可用应用。
- [个人存储兼容脚本](../tools/personal-storage-spike/verify.mjs)：本轮隔离实验；说明、版本和结果统一在架构第 2 节，不另建研究报告。
- [AGENTS.md](../AGENTS.md)：当前协作约束与历史业务规则；以顶部最新适用范围为准。

## 4. 维护规则

每个决策只在一份主文档维护正文，其余用链接。需求变更更新 RQ/技能/验收；实现选择更新架构；进展更新实施计划；来源与版本更新研究依据。保留 RQ、SK、W、H/A 编号，新增需求追加编号，不为合并任意重排既有标识。专项历史记录只修失效导航或补清楚的后续说明，不篡改当时结果。
