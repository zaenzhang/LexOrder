# LexOrder 研究与决策依据

核查日期：2026-11-16。本文合并原项目来源/许可和全球律所招聘研究；保留来源、固定版本、适用范围、时点与采用边界。产品行为见[需求与技能](PRODUCT_REQUIREMENTS_ACCEPTANCE.md)，技术取舍与试验见[架构与发布](REFACTOR_DESKTOP_TEAM_RAG.md)，不另开按话题拆分的研究文档。

## 当前研究结论与使用方式

| 证据类别 | 已完成的工作 | 形成的决定 | 不能据此宣称 |
| --- | --- | --- | --- |
| 用户需求 | 汇总本轮全部纠正并三 agent 复核 | 唯一 Server；Personal 搁置无门禁/无自动恢复；内置先行、所有第三方独立可选；官方 MCP 目录；UI 原样 | 将旧双产物或外部凭据重新作为前置，或宣称可选项已接通 |
| 既有项目 | 固定 LawLink/二开提交；保留 §3.5 对 13 个候选指定模块的深读记录与 SK01—SK12 映射，核对实际移植 | 复用 TS、事项与财务/审批链，逐步补材料和交付 | 所有参考项目的能力都已移入 |
| 桌面/存储 | 官方资料、固定版本隔离试验、共享根 App 与本机操作者接线、私有 PG 通道反例 | 精简 Next/Node + PGlite 的历史设计保留；Personal/Windows 搁置 | 后续变更后的应用可运行、全量 PG 兼容或 Windows 发行已验证 |
| RAG 后端 | LanceDB 0.41.0 SDK 原型、抽取/OCR 边界测试、RAGFlow 1.0.0 HTTP 适配与固定部署准备脚本 | 两个适配已有代码；Lance/OCR 新增 26 项通过；RAGFlow 为 `PREPARED_NOT_DEPLOYED`，真实服务/模型联调待配置 | 适配已接通完整业务、真实语义/OCR 质量已验证，或 RAGFlow 已部署 |
| 专业能力 | 16 个主要官方来源，13 个国家/地区及补充材料 | SK01—SK12 的输入、步骤、成果、人工复核与评测 | 全球排名、每国穷尽调查、名所背书或 AI 执业资格 |

研究采用“观察到的行为 → 输入输出与规则 → LexOrder 设计 → 场景验证”。来源事实、产品推论和已运行结果分别标明。动态页面不自动等于固定版本能力；新增依赖固定版本和完整性，实际采用源码时登记文件与许可。招聘页面状态按核查当日记录，后续实现时复核需要更新的来源。

本轮 Server M2 实现与验证见[实施计划 §8.4](WORKBENCH_PLAN.md#84-server-m2-本轮执行2026-11-16)。[§8.3](WORKBENCH_PLAN.md#83-m1-当前验证与交接2026-11-16) 保留 M1 历史证据：Personal 共享根应用曾构建通过，后续新工作区初始化报 `M1_INITIALIZATION_COMMAND_FAILED` 后依用户指令停止验证；没有 Windows 产物。Server-only 服务脚本实跑两项 `NOT_CONFIGURED`、退出码 2，未调用 Personal；无真实模型凭据或 RAGFlow 实例时不记联调通过。

## 1. 实际业务基线

| 项目 | 内容 |
| --- | --- |
| 名称 | LawLink |
| 上游仓库 | <https://github.com/lawflow-boop/LawLink> |
| 标签 | `v2.0.1` |
| 固定提交 | `4736aa100515bb15f47443cdb6b0ae65745e5fff` |
| 本分支用途 | 作为律师工作台的实际源代码基线 |
| 许可 | MIT，保留根目录 LICENSE 及上游版权信息 |
| 验证边界 | 本次已核对数据结构与关键服务源码；部署、测试和新增功能结果另行记录 |

固定版本的 [MIT LICENSE](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/LICENSE) 中的版权为 `Copyright (c) 2026 叶森 (Sen Ye)`。本分支不能移除或以自身署名替换上游通知。

`v2.0.1` 的标签对象指向上述提交；该版本修复容器内 OpenSSL 和运行配置文件问题。发布标签名、Git 提交与实际部署提交应分别核对，不能以标签名称代替工作目录验证。

### 2026-11-16：实际吸收的二开贡献

来源为 [appleoppa/LawLink 固定提交](https://github.com/appleoppa/LawLink/tree/535a3531aa79edea1c1c6524fd6748d630170718) `535a3531aa79edea1c1c6524fd6748d630170718`，相对上述 LawLink 基线为 23 个提交、49 个文件的最终差异。该固定版本根目录 [LICENSE](https://github.com/appleoppa/LawLink/blob/535a3531aa79edea1c1c6524fd6748d630170718/LICENSE) 保留原 MIT 通知。本仓库保留该通知，并在此记录 appleoppa 的二开来源。

实际采用模块包括 `src/lib/cncases`、元典法规检索、`template-builder.ts` 的执行模板、`parse-summons-local.ts`、独立 cron／备份入口、调度恢复与周报去重。LexOrder 补充了服务端及案件权限、严格检索审计、安全出站请求、部署配置、DOCX 嵌套字段替换、临时字段隔离、日期校验、并发去重和运行依赖。使用既有 PDF／DOCX 依赖，`tsx` 调整为生产依赖，未接入新的语料包。

作者 PGG 专用导入／同步脚本、旧库迁移补偿、未接线的保全组件、作者机器路径及无效测试未作为运行代码移植。逐项范围、适配理由和当前验证见[二开吸收记录](https://github.com/zaenzhang/LexOrder/blob/690232270b46e1f1b105df11bdff167fe7afb80d/docs/FORK_INTEGRATION_20261116.md)。元典法规检索协议核对 [rh_fg_search 官方文档](https://open.chineselaw.com/api-docs/rh_fg_search.html)；响应片段只作为摘要展示。cncases 是外部服务协议适配，未将其服务器源码或裁判文书数据加入本仓库。

## 2. 已检查的 LawLink 源码事实

| 固定版本来源 | 核实内容 | 对整合计划的约束 |
| --- | --- | --- |
| [prisma/schema.prisma](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/prisma/schema.prisma) | Client、Intake、Matter、Deadline、Document、EvidenceItem、Engagement、任务队列等模型 | 先复用主对象，按模块增加关系与记录 |
| [文档服务](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/documents/actions.ts) | Document 版本行、familyId、最新版本与新版本写入 | 引用绑定具体版本，不另建平行版本体系 |
| [期限规则函数](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/lib/deadline-rules.ts) | 期间计算等基础函数 | 复用现有计算边界；法律规则由实际法域与依据核定 |
| [期限重算保护](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/deadlines/recalc-guard.ts) | 已确认或调整期限不允许规则静默覆盖 | 进一步补来源事件和差异复核，不重建保护 |
| [任务队列](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/cron/queue.ts) | 去重、租约、失败重试和失败终态 | 复用队列，长任务待补领取所有权、续租、代次保护及材料/任务可靠提交 |
| [批量文档审查](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/ai/batch-review-matter.ts) | 逐件检查审查资格、批量范围与跳过信息 | 新 AI 流程保留材料级权限和覆盖信息 |
| [package.json](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/package.json) | 现有技术栈及 DOCX、PDF 相关依赖 | 先增强已有模板和文档能力 |
| [AGENTS.md](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/AGENTS.md) | 上游业务语义、维护规则及历史实施记录 | 历史通过结果不作为本次测试证明；字段存在不等于 UI 可用 |

特别保留的事实：`Task` 与 `Note` 当前要求 `matterId`；`Engagement.endedAt` 表示委托实际终止，`Intake/Matter.serviceEnd` 表示服务期限；`EvidenceItem` 已区分事实、主张、分析、争点与待核实；既有正文搜索、服务端期限复核和提醒台账不应被描述为缺失。

## 3. 参考项目及采用边界

| 项目 | 官方来源 | 核实的优势或现状 | 计划采用方式 |
| --- | --- | --- | --- |
| appleoppa/LawLink | [固定 README](https://github.com/appleoppa/LawLink/blob/535a3531aa79edea1c1c6524fd6748d630170718/README.md)、[固定源码](https://github.com/appleoppa/LawLink/tree/535a3531aa79edea1c1c6524fd6748d630170718) | 法规/本地案例检索、传票解析、执行模板及独立调度增强；多角色复核门禁仅函数/测试 | 通用功能已由 `2997b54` 吸收；专用脚本和未接线门禁不迁入，详见第 1 节及独立验证记录 |
| 案齐 ANQI | [仓库](https://github.com/zj-ai-lab/anqi)、[设计文档](https://github.com/zj-ai-lab/anqi/blob/main/docs/DESIGN.md)、[LICENSE](https://github.com/zj-ai-lab/anqi/blob/main/LICENSE) | 今日计划、程序事件、期限解释、人工保护、建议处理 | 提炼规则和验收场景，在 LexOrder 独立实现 |
| Kosmos | [仓库](https://github.com/Kosmos-Law/kosmos)、[案件构建](https://kosmos.law/docs/dev/subsystems/case-building/)、[LICENSE](https://github.com/Kosmos-Law/kosmos/blob/dev/LICENSE) | 事实、文档、高亮、证人及其关联 | 以既有 EvidenceItem 增强原文和事实关系；不整体迁入 Django 应用 |
| Frappe CRM | [初始工作流程](https://docs.frappe.io/crm/setup-guide/your-first-steps-with-frappe-crm)、[任务](https://docs.frappe.io/crm/task)、[仓库](https://github.com/frappe/crm) | 客户活动与跟进，转化时保留笔记、邮件和任务 | 原生客户逻辑；不并行维护同一批客户身份 |
| Twenty | [仓库](https://github.com/twentyhq/twenty)、[LICENSE](https://github.com/twentyhq/twenty/blob/main/LICENSE) | 关联记录与工作流 | 独立实现客户关联视图、筛选和流程 |
| Clio | [案件管理](https://www.clio.com/features/case-management/)、[客户获取](https://www.clio.com/features/law-firm-client-acquisition/) | 咨询、客户、案件与费用的业务流程 | 作为产品行为参考，统一到现有 Client/Intake/Matter |
| Paperless-ngx | [仓库](https://github.com/paperless-ngx/paperless-ngx)、[文档](https://docs.paperless-ngx.com/) | 扫描、索引、归档和文档处理 | 独立实现原件、派生结果、处理状态与恢复流程 |
| AnythingLLM | [Desktop](https://docs.anythingllm.com/installation-desktop/overview)、[Docker](https://docs.anythingllm.com/installation-docker/overview)、[内置 LanceDB](https://docs.anythingllm.com/setup/vector-database-configuration/local/lancedb) | 单人安装版、团队部署版、内置检索和嵌入选项 | 参考双交付与组件托管，不能推定自动离线同步 |
| Cherry Studio | [知识库](https://www.cherryai.com/docs/en/knowledge-base/knowledge-base/)、[本地模型](https://www.cherryai.com/docs/en/pre-basic/settings/local-models/)、[仓库](https://github.com/CherryHQ/cherry-studio) | 分块检查、召回测试、重建索引、可下载本地嵌入/OCR | 参考桌面 RAG 体验；个人版不直接视为团队服务器 |
| RAGFlow | [v1.0.0 正式发布](https://github.com/infiniflow/ragflow/releases/tag/v1.0.0)、[1.0 HTTP API](https://ragflow.io/docs/v1.0.0/http_api_reference)、[部署](https://ragflow.io/docs/v1.0.0/)、[共享权限](https://ragflow.io/docs/v1.0.0/guides/team/resource_sharing/resource_sharing_and_permissions) | 已有解析/索引/检索平台；正式版及权限语义有明确边界 | Server 可选增强，首个联调目标 1.0.0 并锁定镜像摘要；默认内置解析与 PG 搜索。HTTP 适配及部署准备已有，真实服务未部署；业务与引用由 LexOrder 管理 |
| Counsel OS | [仓库](https://github.com/eigenlegal/counsel-os)、[LICENSE](https://github.com/eigenlegal/counsel-os/blob/main/LICENSE) | 案件上下文、记录版本引用、文书审阅；部分能力尚未完成 | 独立实现覆盖记录、来源锚点和成果版本流程 |
| new-litigation-visualization | [仓库](https://github.com/MiaoQichuan/new-litigation-visualization) | 多来源事实、冲突并列、事实时间线和可视化 | 增强 EvidenceItem 和材料引用，不建立平行事实库 |
| AppFlowy | [仓库](https://github.com/AppFlowy-IO/AppFlowy)、[CodeMap](https://docs.appflowy.io/docs/documentation/software-contributions/architecture/frontend/frontend/codemap) | 界面、Rust 核心与持久层的工程边界 | 参考模块划分；不据其语言选择启动 LexOrder 全面迁移 |
| j-lawyer | [官方功能](https://www.j-lawyer.org/?page_id=22) | 案件表单、模板变量、文档与办案工作流 | 首期参考业务行为；具体源码按仓库和模块另核许可 |
| Docassemble | [仓库](https://github.com/jhpyle/docassemble)、[文书装配](https://docassemble.org/docs/documents.html)、[API](https://docassemble.org/docs/api.html) | 分支访谈、变量驱动 DOCX/PDF 装配、会话 API | 先增强既有字段和模板，复杂访谈后续服务化 |

### 3.1 模块实施前的参考与用户合理性记录

每个模块开发前记录用户任务、实际阅读的 UI/业务来源、采用理由、不适用之处及验收路径。以下是首批 W01.2/W04.1 的研究；查看了官方截图、界面指南和固定源码，没有运行第三方应用，不作为交互测试通过的证据。

| 模块与来源 | 实际观察 | LexOrder 采用与边界 |
| --- | --- | --- |
| 材料阅读/处理：Paperless-ngx，快照 `4610171a94e5932e85a80e480032e397cdb6f309` | [官方编辑截图](https://github.com/paperless-ngx/paperless-ngx/blob/4610171a94e5932e85a80e480032e397cdb6f309/docs/assets/screenshots/editing.png) 中元数据与原文并排，版本/页码/保存靠近对象；[上传服务](https://github.com/paperless-ngx/paperless-ngx/blob/4610171a94e5932e85a80e480032e397cdb6f309/src-ui/src/app/services/upload-documents.service.ts) 在上传响应后保存任务 ID 并进入等待，上传完成不等于处理完成；[状态区](https://github.com/paperless-ngx/paperless-ngx/blob/4610171a94e5932e85a80e480032e397cdb6f309/src-ui/src/app/components/common/upload-status-tray/upload-status-tray.component.html) 逐件显示结果与打开入口 | 吸收同屏核查、逐件状态和就地失败出口；沿用 LexOrder 事项材料行及一行一版本，不搬入全局管理导航、大量元数据字段或重复的保存按钮 |
| 来源与事实：Kosmos，快照 `c6454fd5488c0d231e2b4756846f690c679586ca` | [事实指南](https://www.kosmos.law/docs/guide/facts/) 将原文高亮、事实和来源关联；[OCR 状态组件](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/templates/case/documents/ocr-badge.html) 显示实际页数、暂停及失败重试；[事实行](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/templates/case/facts/fact-row.html) 将来源置于事实旁；[模型](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/models.py) 保存材料、页段与选区关系 | 吸收原文位置与事实就近关联。LexOrder 高频动作直接点引用回原文，复制/移除放次级菜单；自动检索或 AI 结果不得把未处理内容当作已读取依据；人工阅卷引用仍核对原文位置、版本与当前权限，采纳不自动等于事实成立 |
| 既有事项材料：LexOrder `44a5399` | [材料行](https://github.com/zaenzhang/LexOrder/blob/44a539969db68fa94836c0a63ee51cb333f8d3b0/src/app/(app)/matters/[id]/_components/procedure-workflow-panel.tsx) 已有阅读、下载、添加要点；[证据组件](https://github.com/zaenzhang/LexOrder/blob/44a539969db68fa94836c0a63ee51cb333f8d3b0/src/app/(app)/matters/[id]/_components/evidence-panel.tsx) 可就地展开并预选材料 | 保留现有入口和上下文，后续把文字来源增强为真实定位引用；本批先补共用数据与检索边界，不另建证据中心或 AI 来源页面 |

用户合理性审查结论：材料状态跟随材料，来源跟随论断，失败旁提供继续操作；普通路径用标题、标签、位置与动作表达，不显示内部锚点名、代次、向量参数等实现说明。必要的未读范围、来源变化和错误原因保留。UI 集成时用“上传→部分失败→重试→查看来源→编辑候选→采纳”验证普通/异常/窄屏/键盘路径；本批契约测试只验证这些交互所需的数据约束。

参考中不适用的处理也单独审查：Kosmos 的[材料任务](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/documents/tasks.py) 包含 OCR 替换原文件、按总字符量判断已有文本及限量索引/摘要。LexOrder 保留原件，并分开记录解析覆盖、召回片段与模型实际输入，不能由处理成功推断全卷已读。本批独立实现共用契约，不复制以上项目代码。

### 3.2 M1 模块研究与实施决定（2026-11-16）

| 模块 / 用户任务 | 已读取的参考 UI 与业务 | LexOrder 的决定与验收 |
| --- | --- | --- |
| 个人工作区 / 打开并继续工作 | AnythingLLM 固定 `4d09fa5f730698d39f1d783e47316744b260a700` 的 `frontend/src/pages/OnboardingFlow/Steps/{Home,LLMPreference,UserSetup}/index.jsx`、`frontend/src/components/PrivateRoute/index.jsx`、`server/utils/boot/markOnboarded.js`；[Desktop 官方说明](https://docs.anythingllm.com/installation-desktop/overview) | 采用工作区持久化、按所选服务展开配置；不采用营销欢迎流程、个人密码或运行时切换团队模式。M1 改为根应用的 Next standalone，复用原 LawLink 页面、真实 Prisma 模型和迁移；稳定本机操作者取代 Personal 登录，Server 认证不变。独立技术页已退出产品入口。创建、关闭、重开与不完整工作区的实际验收未完成；本行保留 M1 历史决定，Personal 现已搁置，无当前验收责任或恢复排期。 |
| 个人材料 / 查到可核对原文 | 延用 §3.1 实际查看的 Paperless 编辑/上传状态与 Kosmos 原文/事实、逐文件 OCR 状态；LanceDB 固定 [v0.41.0 源码](https://github.com/lancedb/lancedb/tree/3936a8b3bcce8f8e073f3ec6a47e4ca4d3381b92/nodejs/lancedb) 的 `indices.ts`、`query.ts`、`table.ts`、`merge.ts`、`connection.ts` | 用真实 SDK 持久化、ICU 中文词法、带前置过滤的向量检索及 RRF 合并；保留原始文字、PDF 页、不可变抽取文本偏移与表格单元格位置；DOCX 尚未映射回原文件段落。原生依赖隔离于 M1 工具包，Node 要求 >=22。确定性向量只检验索引工程，不冒充真实语义质量。 |
| Server 材料 / 上传、等待、重试和撤回 | RAGFlow 固定 [v1.0.0 / db1cd5929a7885a3074547791f5ecc4d2f891739](https://github.com/infiniflow/ragflow/tree/db1cd5929a7885a3074547791f5ecc4d2f891739) 的 HTTP 文档、Go document handler/service 与资料列表/解析状态实现 | 实际状态使用 `ingestion_status`，不照搬旧文档的 `run`；取消先进入 STOPPING，删除须核对数量和列表。上传每次一份原件，唯一操作名与原件 SHA-256 用于丢回执核对，无法证明成功时待核对而非盲重传。检索显式关闭知识汇总与图谱扩展。 |

用户合理性审查：材料行显示其状态与恢复动作；引用紧邻结果并保留原文上下文；未处理页与不支持单元可见。保留原工作台与样式，不新增独立材料入口或常驻说明卡片。用户纠正后，将共享页面、actor 与必要的本人确认接线前置到 M1；RAG 管线进入现有事项材料区及完整长流程仍由 M2 接续。HTTP/SDK 和组件测试不作为实际页面点击证明。

### 3.3 全局交互主参考与本批边界（2026-11-16）

用户要求从候选中选择较少装饰和解释、适合专业日常工作的项目，并在选择前说明理由。已说明后选定 **Frappe CRM** 为后续全局交互主参考；用户随后明确“业务先行、UI 调整后置、保持 LawLink 界面样式”。因此本批只落实业务与模式适配，以下是后续设计依据，不是已实施改版或用户已验收新界面的声明。

| 候选与固定来源 | 实际阅读及判断 | 采用边界 |
| --- | --- | --- |
| Frappe CRM `3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952`：[导航](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/frontend/src/components/Layouts/AppSidebar.vue)、[列表](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/frontend/src/pages/Leads.vue)、[详情](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/frontend/src/pages/Lead.vue)、[视图控制](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/frontend/src/components/ViewControls.vue)、[活动](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/frontend/src/components/Activities/Activities.vue)、[转换业务](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/crm/fcrm/doctype/crm_lead/crm_lead.py) | 对象导航、列表工具栏、详情分区与活动记录容易对应现有客户/事项；状态与动作贴近对象。适合作为跨模块交互依据，是本项目的适配判断，不是候选产品的客观排名 | 后续主参考。保留 LawLink 业务身份、页面与 Next/shadcn/Radix 技术栈，独立实现行为；不复制 Vue/Frappe 源码（该快照 LICENSE 为 AGPL-3.0），不搬销售阶段、入门清单、样例数据或直接改状态的业务规则 |
| Twenty `26fa97ebc8a5773e842ba0d2f01e0b24bed6e7d0`：[列表](https://github.com/twentyhq/twenty/blob/26fa97ebc8a5773e842ba0d2f01e0b24bed6e7d0/packages/twenty-front/src/modules/object-record/record-index/components/RecordIndexContainer.tsx)、[详情容器](https://github.com/twentyhq/twenty/blob/26fa97ebc8a5773e842ba0d2f01e0b24bed6e7d0/packages/twenty-front/src/pages/object-record/RecordShowPageShell.tsx) | 同样克制，偏元数据驱动对象、可定制布局与多种详情载体；不能因有 AI 模块就认定界面不专业 | 保留关联记录/筛选的参考价值，不为本期引入通用布局编辑器或第二套全局风格 |
| Paperless-ngx / Kosmos：沿用 §3.1 固定提交，补读文档列表、案件导航与事实行 | Paperless 的文档列表、逐件处理和原文核对适合材料；Kosmos 的事实/日期/来源关系适合案件分析 | 仅作为材料与事实专项依据，视觉语言仍从同一套共享组件演进；不把整个工作台固定成三栏 |

后续用户合理性标准：页面先呈现业务对象和下一动作；AI 通过“整理事实”“核对引用”“生成草稿”等明确操作进入对应业务区。常驻标题、主操作和事实不重复；字段标签、错误原因、影响范围、未处理内容及补救动作保留。财务、审批、盖章和归档仍通过既有显式确认与事务服务，不采用 CRM 的即时状态编辑。此次仅阅读源码及官方指南，未运行第三方应用；未使用截图作为交付。

### 3.4 Server 登录后表单复核与修复（2026-11-16）

本批继续使用 LawLink 作为现有业务/UI 参考。检查原布局中的实际操作，不启动视觉改版；源码参考与部署版浏览器证据分别记录。身份卡修复读的是已继承到本地的组件及安装依赖，没有重新审查 LawLink 整个收案模块或比较 RHF 版本历史；客户维护另补读下列固定上游文件。

| 用户任务 / 参考范围 | 实际观察与采用决定 | 用户合理性与验证边界 |
| --- | --- | --- |
| 从已有客户补全身份并收案：LexOrder `f973b87` 中继承的 `party-card.tsx`、`intake-wizard.tsx` 与本地固定依赖 `react-hook-form 7.76.0` | 保留主体卡、按需展开和原证件 schema。浏览器输入首字符后失焦；本地真实 RHF/字段数组复现出嵌套 `setValue` 导致行标识重建。改走字段事件，编辑获焦后保持展开，不换数组索引 key 或降低证件校验 | 用户能连续补齐身份并继续下一步，错误消失时不收起正在输入的区域。DOM 回归与实际浏览器复测分开记账，不将依赖单测当作点击验收 |
| 浏览客户与编辑主档：补核 LawLink 固定 `4736aa100515bb15f47443cdb6b0ae65745e5fff` 的 [客户服务](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/clients/actions.ts) 与 [客户列表](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/app/(app)/clients/_components/clients-view.tsx)，对照本地当前详情和联系人保存路径 | 上游服务已有主档维护资格，列表却直接打开仅含主联系人的摘要。沿用原抽屉/表格，只将入口与现有业务授权、CUSTOM 写入范围一致；列表编辑先取完整主档与联系人，失败不回退到摘要。系统身份不授予客户业务编辑资格 | 避免展示必定失败的动作，也避免修改客户姓名时丢失其他联系人；保留普通律师已有的建档与沟通/跟进动作。以两个联系人、加载失败、读写范围不同及真实默认账号分别验证 |

本批没有改迁移、审批资格或默认材料加密策略。普通材料、合同/发票及归档附件的加密参数并不相同；私有访问与磁盘加密分别核验，先前密文下载 smoke 不作为普通材料 UI 默认加密的证明。实际范围及剩余前置条件见[实施计划 §8.3](WORKBENCH_PLAN.md#83-m1-当前验证与交接2026-11-16)。

### 3.5 按国际执业能力审查参考实现（2026-11-16）

本次按用户补充，将第 7 节 H01—H16/A01—A02 的职业能力与 SK01—SK12 作为主线，反查参考项目的实际工具、状态转换和失败出口。优先级由“专业产物价值、LexOrder 的真实缺口、现有依赖”决定。国际执业方法用于提高工作质量；首发仍服务中国大陆个人律师与小团队，跨法域实质分析及大型团队治理分别后置验证。

**证据口径：**三组只读研究覆盖下表固定代码的模型、服务、调用出口及部分 UI/测试；主代理复核关键实现并对照 LexOrder `f973b8729bf9214740e507b8ca8a34072e8c5902`。没有运行第三方应用；有服务实现不等于该项目整条产品链已验收。Clio 是商业产品官方说明，只作能力标杆，不当作可移植源码或质量实测；职业资料映射是本项目设计判断。合并文档时已接续主分支 `0ffe98e` 的表单修复与验证记录；当前 M1 实施状态仍见计划 §8.3，本次只更新研究、需求、架构和后续任务。

#### 3.5.1 固定源码与阅读边界

| 项目 / 固定提交 | 本次实际阅读的关键入口 | 可支持的判断与边界 |
| --- | --- | --- |
| ANQI `25efcf7f2a3329f9ecdc092b3ced0e17a685c83a` | [候选事实](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/candidate-facts.js)、[抽取入库](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/legalrag-bridge.js)、[采纳/拒绝/恢复](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/routes/legalrag.js)、[期限核心](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/deadline-core.js)、[重算](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/engine.js) | 同案逻辑候选与逐材料来源分开、人工处理状态跨重跑保留；期限条件与重算可解释。法律规则内容不因代码存在而视为已核实 |
| Kosmos `c6454fd5488c0d231e2b4756846f690c679586ca` | [模型](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/models.py)、[来源归属](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/facts/access.py)、[动作](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/facts/views.py)、[事实行](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/templates/case/facts/fact-row.html)及跨事项来源测试 | 高亮与事实多来源关系、原文邻近操作、同案校验可参考；不照搬 AI block 直接创建正式 Fact 或强制完整日期的行为 |
| Counsel OS `c4f40f1ffd40146531bcaa7f43e6877a733f92ca` | [上下文](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/context-preparation.ts)、[引用定位](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/citation-location.ts)、[读/引工具](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/chat-tools.ts)、[影响链](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/reference-impact.ts)及[服务调用](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/store.ts)/[HTTP 接线](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/http.ts)、[Word 轮次](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/docx/rounds.ts)、[隔离比较](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/document-rounds.ts) | 实际供给范围、歧义引用拒绝、显式版本依赖和两/三版本谈判比较（逐原件/hash 与权限复核，段落/修订/批注有界覆盖，未证明完整 Word 比较或人工意见闭环）。影响链已有后端调用，不能继续据旧 README 认定只有设想；未验证第三方完整 UI |
| 诉讼可视化 `16c480c3947e78ba49623423ea0486277f5fe99d` | [诉请/材料检查](https://github.com/MiaoQichuan/new-litigation-visualization/blob/16c480c3947e78ba49623423ea0486277f5fe99d/plugins/mqc-nlv/skills/mqc-trial-confrontation-master/scripts/check_claims.py)、[事实规格](https://github.com/MiaoQichuan/new-litigation-visualization/blob/16c480c3947e78ba49623423ea0486277f5fe99d/plugins/mqc-nlv/skills/mqc-chronicle-master/schemas/casefile.schema.json)及事实/遗漏校验 | 材料未取得与内容未记载分开、金额构成机械核对、事实时间精度。请求权/举证责任封闭表不能作为通用法律真值；金额运算在 LexOrder 用 Decimal |
| Paperless-ngx `4610171a94e5932e85a80e480032e397cdb6f309` | [摄入全链](https://github.com/paperless-ngx/paperless-ngx/blob/4610171a94e5932e85a80e480032e397cdb6f309/src/documents/consumer.py)、tasks.py、[导出清单](https://github.com/paperless-ngx/paperless-ngx/blob/4610171a94e5932e85a80e480032e397cdb6f309/src/documents/management/commands/document_exporter.py)、[完整性核对](https://github.com/paperless-ngx/paperless-ngx/blob/4610171a94e5932e85a80e480032e397cdb6f309/src/documents/sanity_checker.py) | 分阶段摄入、原件/派生与 manifest、缺失/哈希/孤立文件核对；其可配置的重复件删除不能照搬为法律来件去重 |
| AnythingLLM `4d09fa5f730698d39f1d783e47316744b260a700` | [逐件材料写入/补偿](https://github.com/Mintplex-Labs/anything-llm/blob/4d09fa5f730698d39f1d783e47316744b260a700/server/models/documents.js)、[上下文组装](https://github.com/Mintplex-Labs/anything-llm/blob/4d09fa5f730698d39f1d783e47316744b260a700/server/utils/chats/stream.js)、[缓存](https://github.com/Mintplex-Labs/anything-llm/blob/4d09fa5f730698d39f1d783e47316744b260a700/server/utils/files/index.js)及 Lance 适配 | 单件失败可分流；指定材料、检索与历史回填分别参与输入，固定材料仍受预算/压缩影响。局部文件名缓存键不证明全局模型失效正确，不直接采用 |
| Cherry Studio `6b408118141472ff472a1824f300b5a8cbdf968d` | [摄入与恢复](https://github.com/CherryHQ/cherry-studio/blob/6b408118141472ff472a1824f300b5a8cbdf968d/src/main/features/knowledge/ingestion/KnowledgeIngestionService.ts)、[查询](https://github.com/CherryHQ/cherry-studio/blob/6b408118141472ff472a1824f300b5a8cbdf968d/src/main/features/knowledge/query/KnowledgeQueryService.ts)、[分数语义](https://github.com/CherryHQ/cherry-studio/blob/6b408118141472ff472a1824f300b5a8cbdf968d/src/main/features/knowledge/query/search.ts)、[召回测试](https://github.com/CherryHQ/cherry-studio/blob/6b408118141472ff472a1824f300b5a8cbdf968d/src/renderer/pages/knowledge/panels/recallTest/RecallTestProvider.tsx)及结果卡、[重建](https://github.com/CherryHQ/cherry-studio/blob/6b408118141472ff472a1824f300b5a8cbdf968d/src/main/features/knowledge/tasks/reindexSubtreeJobHandler.ts) | 召回测试、历史查询及片段/排名诊断，排名分与相关分分开、任务恢复分类；不复制完整查询/结果日志，重建不得重新抓最新字节覆盖 LexOrder 原件 |
| RAGFlow `db1cd5929a7885a3074547791f5ecc4d2f891739` / 1.0.0 | [摄入/停止](https://github.com/infiniflow/ragflow/blob/db1cd5929a7885a3074547791f5ecc4d2f891739/internal/service/document/document_ingest.go)、[管线版本](https://github.com/infiniflow/ragflow/blob/db1cd5929a7885a3074547791f5ecc4d2f891739/internal/service/document/document_dataset_update.go)、[同版备份恢复](https://github.com/infiniflow/ragflow/blob/db1cd5929a7885a3074547791f5ecc4d2f891739/docs/administrator/upgrade_and_migration/backup_and_restore_v1.md)及 1.0 HTTP 文档 | 解析/检索平台和 STOPPING/STOPPED、内置解析/自定义 pipeline version、同版恢复边界；不承担 LexOrder 的法律效力判断、业务权限或批准 |
| Frappe CRM `3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952` | [活动聚合](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/crm/api/activities.py)、[转换与锁](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/crm/fcrm/doctype/crm_lead/crm_lead.py)、[业务事件](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/crm/automation/events.py)及 Activities.vue | 按原对象资格继承活动、明确重复转换语义、事件只携必要标识；未审整个 Frappe outbox，不宣称端到端可靠投递已证实 |
| Twenty `26fa97ebc8a5773e842ba0d2f01e0b24bed6e7d0` | [运行/重试](https://github.com/twentyhq/twenty/blob/26fa97ebc8a5773e842ba0d2f01e0b24bed6e7d0/packages/twenty-server/src/modules/workflow/workflow-runner/workflow-run/workflow-run.workspace-service.ts)、[等待/恢复](https://github.com/twentyhq/twenty/blob/26fa97ebc8a5773e842ba0d2f01e0b24bed6e7d0/packages/twenty-server/src/modules/workflow/workflow-runner/workspace-services/workflow-waiting-step.workspace-service.ts)、[等待创建/取消](https://github.com/twentyhq/twenty/blob/26fa97ebc8a5773e842ba0d2f01e0b24bed6e7d0/packages/twenty-server/src/modules/workflow/workflow-wait/services/workflow-step-wait.workspace-service.ts) | 运行版本快照、等待单次领取、取消和恢复失败出口；只取少量固定状态，不能引入绕过案件资格的系统执行身份 |
| docassemble `36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d` | [依赖引擎相关函数](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/parse.py)、[依赖变更示例](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/depends-on.yml)、[条件复核](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/review-conditional.yml)、[DOCX 访谈](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/docx-template.yml) | 根据缺失变量追问、上游改变使依赖待重答、保留旧值供复核；不迁入任意 Python/YAML 运行器 |
| j-lawyer `f523d141327e5c74269dd9c71b54ae1c05a415a3` | [无后续安排查询](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-server/j-lawyer-server-ejb/src/main/java/com/jdimension/jlawyer/services/ArchiveFileService.java)及客户端调用、[专项表单实体](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-server-entities/src/main/java/com/jdimension/jlawyer/persistence/ArchiveFileFormsBean.java)、[表单说明](https://jlawyerorg.github.io/j-lawyer-documentation/benutzerhandbuch/aktenverwaltung/falldaten.html) | 无未结日历项的活跃事项巡检、事项内专项字段包；表单版本迁移和完整模板服务未深审，不推断可以直接复用 |
| AppFlowy `8fcee27d9bd93aad4ee0191d5d8d915d6a9a4e93` | [模块组装](https://github.com/AppFlowy-IO/AppFlowy/blob/8fcee27d9bd93aad4ee0191d5d8d915d6a9a4e93/frontend/rust-lib/flowy-core/src/lib.rs)、[请求/结果边界](https://github.com/AppFlowy-IO/AppFlowy/blob/8fcee27d9bd93aad4ee0191d5d8d915d6a9a4e93/frontend/appflowy_flutter/packages/appflowy_backend/lib/dispatch/dispatch.dart)及 CodeMap | 仅补工程边界证据；本次未深入其 CRDT/同步/权限，不新增 Rust、FFI 或同步迁移任务 |

LawLink 与 appleoppa 仍按 §1—2 的固定业务基线复用，不重复移植。LanceDB/PGlite 的组件合同和局部兼容证据继续沿用架构第 2、10 节，本次没有再做组件运行验证。

**大型平台产品对照（官方页面，2026-11-16）：**[Clio Operate](https://www.clio.com/enterprise/operate/)说明按事项类型组织阶段、分派与审批；[Vincent](https://www.clio.com/enterprise/vincent/)说明带可打开依据的研究、反向论证、跨法域比较、跨文档问题表与起草衔接；[企业安全](https://www.clio.com/enterprise/security/)列出 SSO、审计及 ethical walls。它们说明值得研究的产品问题，未验证内部实现、效果或采购适用性。LexOrder 将“问题表逐格来源”和“事项作业包”作为后续设计判断；不会因此宣称拥有全球法库、案件隔离墙或大型律所部署能力。

#### 3.5.2 十二项专业能力的实现对照

本表将职业证据与软件工具连接；“缺口”指本次未发现足以承诺完整能力的实现证据，不是对第三方全仓的否定。

| 能力及职业来源 | 参考中可确认的体现 | LexOrder 应交付的工具/产物与真实增量 | 阶段 / 工作项 |
| --- | --- | --- | --- |
| SK01 客户目标与商业情境；H03/H06/H10/H11、A01 | Frappe 活动连续、Counsel 有界事项上下文；未证明完整客户授权/范围变更流程 | 在既有客户摘要上补目标、范围/排除项、时间/预算假设、决策人和版本化指示；形成 MatterBrief，不能从沟通自动推断授权 | M2 W07.1/W07.2，M3 W10.1 |
| SK02 事实、证据、时间线；H01/H04/H12/H13/H14 | Kosmos 多来源高亮，ANQI 候选与来源生命周期，诉讼可视化日期精度 | 五类要点、正反证与缺口；同一候选不反复处理，新矛盾仍复核；保留精确/区间/未知时间及原始表述 | M2 W05/W06/W08 |
| SK03 可复查法律研究；H01/H02/H05/H07/H09 | LawLink/二开已有法库适配；RAGFlow/Cherry 支撑检索，Counsel 保留供给范围；Clio 只有产品层研究对照 | ResearchMemo：问题/法域/相关日期/查询/法源版本/例外/不利依据/未覆盖；检索命中不能替代有效性与适用性核查，真实法库权益继续单独联调 | M3 W09.1/W09.2 |
| SK04 批判性分析与反向论证；H02/H04/H09/H12/H16 | 诉讼可视化双方回应、材料范围及金额检查；Kosmos 仅提供事实连接基础 | IssueMatrix：要件、支持/反向证据、关键假设、待补材料与下一步；未收到答辩与答辩未回应分开，机械算术与法律判断分开 | M3 W09.1，W10.2 复核 |
| SK05 商业判断与客户决定；H02/H06/H08/H10 | Frappe 有历史和状态、Counsel 有上下文；没有证明完整的法律方案比较与真实客户决定闭环 | 方案比较、成本/时间假设、范围变化影响和 DecisionDraft；律师建议与客户指示分别确认、留旧版本，不凭模型编概率/预算 | M3 W10.1，依赖 W07 |
| SK06 结构化起草；H01/H02/H06/H07/H08/H09/H14 | docassemble 缺项依赖与条件复核，j-lawyer 事项字段/模板，LawLink 既有生成快照 | 有界补问、必要模板、段落引用和缺项表；只读准备/渲染值/主数据回写分开，上游改变后重核受影响输入 | M3 W10.2；专业字段包 M5/M6 W15 |
| SK07 版本化审阅；H02/H03/H04/H05/H09 | Counsel 精确引用与显式影响链、Word 往返比较；诉讼可视化机械核对 | 定位问题—作者回应—实际处理—针对新版本复核；M3 补直接来源影响提示，保留历史批准；Word 谈判归因与批量问题表后续深化 | M3 W10.2；M5 W14 |
| SK08 法律项目推进；H03/H05/H06/H07/H11/H14/H16 | ANQI 可解释期限，Twenty 等待/重试，j-lawyer 无未结日历项巡检 | 责任/前置/等待/检查日、期限计算依据和新旧差异；外部律师或客户等待仍有内部负责人。技术运行等待不冒充业务等待 | M3 W11.1；M5 W14 |
| SK09 面向客户的沟通与交付；H03/H05/H06/H11/H13/H16、A01 | Frappe 沟通连续；LawLink 已有文书、审批、归档基础；未证明完整真实交付闭环 | 进展/风险/待决定/下一步简报、确切版本交付清单、实际发送证据与独立客户确认；自动生成不自动对外发送 | M3 W12.1 |
| SK10 交接与监督；H03/H06/H07/H10/H11/H13/H14、A02 | j-lawyer 巡检、Frappe 按来源资格显示历史、Twenty 可恢复运行；不能据此宣称合伙人监督已完整实现 | 复用责任交接，形成接收检查表、关键期限/未决问题/授权材料包和反馈；Server 真实接收人确认；当前 Server 实施资料整理与本人事项巡检；设计可复用，但 Personal 仍搁置 | M5 W14；M3 保留既有责任守卫 |
| SK11 双语/跨法域；H01/H07/H08/H09/H12 | 本次开源阅读未证实“条款对齐—法律效果差异—当地复核”完整链；多语界面/模型不构成证明，Clio 仅产品对照 | 原/译文固定版本、术语/数字/否定/例外对齐表；按法域分栏研究、来源时点和当地律师待核实项；逐法域与样本验证 | M2 W07.1 预留；M5/M6 W15 |
| SK12 反馈、知识与方法复用；H03/H05/H10/H11/H15、A02 | Counsel 版本化知识及来源影响、docassemble/j-lawyer 模板化方法；一般知识库不能证明脱敏/专业审核 | 首发手工选入/脱敏/审核；后续从复核反馈形成版本化作业包、条款立场与例外、复审任务及失效影响 | M3 W09.3；M5 W14/W15 |

#### 3.5.3 采用决定与不直接搬入的行为

1. **材料操作与法律来源分开。**采用 Paperless/AnythingLLM 的逐件摄入和失败补救；同一次操作重试幂等，同内容的不同来件/举证方/收件时间保留业务来源。LexOrder 的短信附件已按 `(smsId, sha256)` 区分重复操作和重复送达；通用摄入沿用此语义。不得用全局 hash 命中向无权用户透露其他事项。
2. **候选、来源、人工裁决分开。**采用 ANQI 的跨材料人工处理记忆；只有严格相同身份且无实质变化的候选沿用处理结果。新矛盾、身份修正或新版本实质变化须复核；语义相似仅提合并建议。人工拒绝不是法律真值，也不能让新反证永久消失；费用候选匹配不等于到账确认。
3. **输入覆盖和检索诊断支持专业判断。**把 LexOrder 既有分段/截断/skipped/errors 扩成 AiRun 通用记录，分别保存接收、解析、召回、实际供给模型及引用范围；供给不证明模型理解。参考 Cherry 的召回测试/片段/排序展示，LexOrder 另补材料、索引和配置快照以复现查询；不把排名/相关分称作事实置信度或胜诉概率；不将原文和完整查询写普通日志。
4. **检索与完整审查分别设计。**采用 AnythingLLM/Counsel 的输入组织经验，定向问答按问题召回，指定材料审查按材料/页段清单推进；被预算或压缩排除的部分可见。法律研究额外核对来源身份/时点/效力角色及反向依据。多文档问题表是后续产品设计，每格保留来源和未知原因，不以表格填满代表尽调完成。
5. **文书准备和复核保留副作用边界。**借 docassemble 的依赖复核增强现有模板；当前 `template-engine.ts` 的 `applyOverrides` 会写 Client/Party，AI 补问或预览不得隐式走该回写。首发已有 SK07 的作者回应和处理记录必须落地；Counsel 的 Word 谈判轮次比较留 M5，缺少原始基线时不能归因所有改动，更不能把文字保留当成法律同意。
6. **变更影响沿显式关系计算。**采用 Counsel 的不可变引用依赖；M3 先覆盖直接来源变化，未连边/截断明确范围有限。M5 再处理经验和旧成果间接影响；不引入图数据库，不重绑历史引用、批准或交付。
7. **协作复用现有责任与对象。**Frappe 的历史继承须逐来源鉴权；LexOrder 已有客户关联事项和最近动态（`clients/insights.ts`），增量是连续分页、沟通/跟进/指示/决定/交付链接，不能写成没有客户全景。Twenty 仅用于固定步骤、等待与恢复，技术任务不取代 WorkResponsibility；j-lawyer 的“无下一动作”只提示补安排，不自动造法定期限。
8. **原件及恢复独立于可重建索引。**采用 Paperless 清单/完整性检查和 RAGFlow 同版恢复边界；索引重建读取固定原件，外部内容改变须新版本。派生复用按完整内容/解析/嵌入指纹且复核权限，不按文件名；主动取消的外发不因重启自动续做。现有队列/可靠投递继续增强，不另搭平台。

本次不采用通用工作流画布、平行 CRM、完整 Docassemble/Frappe 服务、AppFlowy 语言/同步迁移或额外 RAG 后端。SSO、显式跨团队隔离墙、数据区域及企业审计导出属于 Server 后续专项候选：已有角色、受限事项和审计不是这些能力的完整证明，先明确目标部署和验收再立项；保留 Personal 无认证的历史设计，不因此安排其恢复。后续顺序与可验收条件见[实施计划 §3.9—3.10](WORKBENCH_PLAN.md#39-参考研究进入-m2m4-的具体增量)。

### 3.6 Server M2 模块决定与阅读边界（2026-11-16）

| 模块/用户任务 | 参考依据 | 采用与实际入口 | 不采用及验证边界 |
| --- | --- | --- | --- |
| 上传后知道每件处理结果 | Paperless-ngx 固定 `4610171`，此前已读 upload-documents service / 状态托盘 | 原材料行区分原件已保存、处理中、部分处理、失败/重试；业务规则独立实现 | 不复制整个管理平台；扫描无 OCR 不写成功 |
| 要点同时核对支持和反证 | Kosmos 固定 `c6454fd`，此前已读模型/事实行/OCR badge | 复用 EvidenceItem，加多条原版本来源；操作就近 | 不覆盖原件、不借可变 textContent 伪造锚点；来源当前权限单独检查 |
| 隔几天恢复客户指示 | Frappe CRM 固定 `3509bd4`，此前 Activities.vue/crm_lead.py 阅读记录 | 复用客户身份/活动；在原案件档案增加版本化目标与指示 | 不抄销售阶段或样式；本轮未重新抓取到固定源码，不声称重新验证 |
| 管理可选服务 | 现有 /admin/ai 和官方服务接入指南 | 沿用设置入口，独立启用/状态/加密凭据；MCP 目录与自定义远程 | 不在启动探活、不自动执行第三方写工具、不把目录当真实接通 |

三 agent 已按“入口、对象、下一步、失败出口、权限、文件 owner”做两轮独立/交叉审查。Next/React 代码遵循本地版本指南，UI 改版后置；本批只有必要业务分区与状态接线。

### 当前项目状态对计划的影响

- 前批初始评估为 `97867e2`，随后对齐 main `2997b54754565081271ca4b66139949d310e2fe0`；M1 当时从 `b313adf8` 接续，本轮 Server M2 从 `f973b87` 开始。appleoppa 的通用功能、迁移、权限与调度适配已合入；本轮保留其源码及来源记录。本轮已将内置解析、覆盖与恢复接入事项上传管线，具体证据见计划 §8.4；局部传票解析和启动补扫仍不等于通用 OCR、完整休眠或整套数据恢复已完成。
- Kosmos 默认源码分支为 `dev`。其[当前 AI 开发文档](https://kosmos.law/docs/dev/subsystems/ai/context/)说明，原生案件聊天引擎于 2026-10-29 退役，界面于次日退役，改由远程 MCP 对外提供案件访问。旧 README 或历史设计不能作为“完整聊天可直接迁入”的证明。
- Kosmos 的事实与高亮关系仍可参考。其某些材料处理路径会替换存储文件，本项目的设计要求保留原件，不能直接采用该行为。
- Counsel OS 官方仓库明确说明扫描 PDF OCR、全面原始法律研究等尚未完成；源代码运行路线仍需开发和测试验证。引用与文书模块只能作为审查候选，不能承诺复制即用。
- 早先的 Personal 内置/Server 必需 RAGFlow 已被用户最后纠正覆盖：当前只交付 Server，内置处理先接业务，RAGFlow/AI/OCR/法律 MCP 等均可选。RAGFlow 适配/固定准备代码已有，但仍为 `PREPARED_NOT_DEPLOYED`，无真实部署或模型证据；缺配置不阻塞业务。
- RAGFlow 1.0 检索的知识汇总默认开启；文档筛选不证明数据集汇总的全部来源获准。因此 Server 首发**明确设置** `include_knowledge_compilation: false`，由 LexOrder 先确定授权材料、再核对返回片段。官方普通 retrieval API 的 `use_kg: true` 不代表启用多跳图检索；共享 Team 规则也不能替代案件权限。实现边界及验收见[架构第 3 节](REFACTOR_DESKTOP_TEAM_RAG.md#3-rag-架构内置优先服务可选)。
- RAGFlow 只在管理员选用时提供兼容实例或独立配套配置，不加入核心启动依赖，不要求购买 Cloud。其权限、版本与持久化边界仍须按实际使用验证。
- AnythingLLM 的默认内置检索、Cherry 的本地模型证明可以把组件交给应用管理，不证明 LexOrder 已完成集成或达到相同效果。中文法律材料仍需独立验收。
- 技术官方来源与本轮隔离存储试验统一见[架构依据](REFACTOR_DESKTOP_TEAM_RAG.md#10-官方资料与代码依据)及第 2 节。Server 保留现有 PG；Personal 的精简 Next/Node + PGlite 方案现已搁置；固定版本的兼容证据不等于正式发行完成。性能暂不作为门禁，原资源阈值已撤销。

## 4. 可选法律服务 MCP 与来源

核查日期 2026-11-16；以下为官方公开的接入信息，不是本项目已取得账号、权益或实测成功。机构目录可扩展，自定义远程 MCP 为未预置服务保留入口；不虚构“市面所有机构都提供官方 MCP”。

| 提供商 | 官方说明 | 可选接入信息与边界 |
| --- | --- | --- |
| 北大法宝 | [官方接入指南](https://mcp.pkulaw.com/docs) | 本期预设独立法规检索 `https://apim-gateway.pkulaw.com/mcp-law-search-service`，Bearer Token；其他官方能力可用自定义服务配置，不推断综合地址 |
| 威科先行 | [官方 MCP 文档](https://mcp.wkinfo.com.cn/docs) | Streamable HTTP：`https://mcp.wkinfo.com.cn/mcp-servers/integrated/`；官方支持 OAuth/Bearer；本期只实现 Bearer，页面明确说明 OAuth 未实现 |
| 华宇元典 | [官方 MCP 配置](https://open.chineselaw.com/mcp-config/) | `/mcp/law/stream`、`case/stream`、`company/stream`、`securities/stream`、`hallucination/stream`；Bearer，保留原 HTTP API 适配 |
| 聚法 | [官方智能体平台](https://www.jufaai.com/agent)、[接入指南](https://www.jufaai.com/agent/guide) | 本期预设指南明确列出的 `https://www.jufaai.com/mcp/law`，Bearer API Key；案例、企业等其他官方服务可另建自定义配置 |
| 其他机构及企业尽调服务 | 获取各机构官方协议/文档后补录 | 未核实官方 MCP 时只列候选或自定义，不把网站地址/API 拼为 MCP；见微/法信/无讼/Alpha 等当前不声称已确认端点 |

本轮已实现四机构预设、自定义远程配置和管理员设置页中的手动只读检索；尚未接普通用户事项研究、自动模型调用或成果采纳。配置状态、初始化成功、工具发现、具体调用/数据权益分别登记。未配置/无权/限流/超时/无结果有不同状态，只影响该服务。默认不发送整案材料；查询由用户明确触发，候选工具只允许审核后的只读能力。Web 订阅、API、全文缓存、向量化和展示权限分别核对。首次没有真实凭据时，协议测试不能登记真实提供商通过。

## 5. 许可采用规则

| 来源 | 核实到的项目许可 | 本分支规则 |
| --- | --- | --- |
| LawLink | MIT | 保留版权和许可，作为实际源代码基线 |
| RAGFlow | Apache-2.0 | 作为 Server 可选独立服务，已有 HTTP 适配/部署准备，真实接通待验证；分发或修改按许可保留必要信息 |
| Counsel OS、Docassemble | MIT | 可以评估代码复用，仍检查具体文件和依赖 |
| ANQI、Kosmos、Frappe CRM | AGPLv3 项目基础 | 默认独立实现所需业务行为；直接采用源码时按许可处理 |
| Paperless-ngx | GPLv3 项目基础 | 默认参考处理流程；实际分发、修改或集成另核边界 |
| Twenty | 主体 AGPL，指定包 MIT，标记文件商业许可 | 逐文件和包判断，不能统一按 MIT 或 AGPL 处理 |
| j-lawyer | 需按选中的具体仓库和模块核对 | 当前仅登记行为参考，不登记已采用源码 |

改变量名、翻译到另一种语言或稍作改写，不会自动将复制的实现变成独立实现。独立服务和 API 是工程边界，不能仅凭调用方式断言没有许可证义务。修改版 AGPL 的远程交互还需核对其第 13 条要求。[GNU AGPL 正文](https://www.gnu.org/licenses/agpl-3.0.html)

每次实际移植代码都补充以下记录：来源仓库与固定提交、具体文件或模块、许可、依赖、修改说明、保留通知、验证场景。源代码许可义务与客户数据处理分别审查，源码引用不会授权复制客户数据。

## 6. 数据与验证记录要求

- 默认初始化保留空白业务数据。Personal 只建立本机操作者和必要配置，无登录账号；Server 按既有部署流程建立管理员、权限与基础配置。
- 合成客户、案件、账务和文件仅在独立开发/验收环境通过验收脚本或已授权的浏览器操作生成，明确标注合成来源，不混入真实业务库。
- 不提交密钥、运行数据库、私有附件、备份、模型原始请求响应或带身份信息的截图。
- 上游历史文档中的测试数量、安全审计结论或部署结果仅代表其对应时间和环境，不能转写为本分支已验证。
- 本次验证记录必须给出实际提交、环境、执行命令或交互场景、结果以及未覆盖范围。只完成源码阅读时，记录为源码核实。


## 7. 全球律所职业能力研究

用户要求参考全球各国顶级律所的招人要求，并把能力内化为技能。本轮选择大型国际律所、主要市场律所的官方职位、选拔框架及培养资料，同时保留一个中东欧地区补充样本。共登记 16 个主要来源，覆盖 13 个国家/地区；这不是每个国家的穷尽调查，也不以未经核实的排名认定所有样本为“全球顶级”。

**研究结论：值得内化的是可以观察和复核的工作行为——理解客户目标、查证事实与法律、形成判断、清楚表达、协调责任、按期交付和吸收反馈。学历、执业资格、语言等级与工作年限不能由 AI 技能替代。** 招聘资料补充[用户需求](PRODUCT_REQUIREMENTS_ACCEPTANCE.md)，具体实现规格见[技能目录](PRODUCT_REQUIREMENTS_ACCEPTANCE.md#10-技能是什么)。

### 1. 取样与证据规则

1. 只采用律所官网或其官方招聘系统；来源标题、地区、角色、资历和状态分别记录。
2. 区分在招职位页面、长期选拔框架、培养项目、员工职业建议与历史材料。网页可访问不等于职位仍可申请。
3. 支持岗位与执业律师分开。研究专家对 AI 的明确要求，不能推成所有律师岗位的普遍要求。
4. 表中的“核实内容”是对来源的简要归纳；技能映射、数据契约和验收方法是 LexOrder 的设计判断，不是律所公布的产品标准。
5. 过期职位可用来观察该岗位的能力结构，不用来证明当前招聘政策；未显示日期的页面不补造发布日期。
6. 不将校名、国籍、年龄、成绩或招聘偏好编码成产品的用户评分。国家/地区也不直接决定技能是否可用；法律内容须另行验证法域与资料权限。

### 2. 官方来源证据矩阵

| 编号 | 国家/地区与律所 | 来源角色与资历 | 核实的能力要求或培养内容 | 页面状态与阅读边界 | 对应技能 |
| --- | --- | --- | --- | --- | --- |
| H01 | 中国大陆 · 环球律师事务所 | 北京争议解决律师、公司业务律师及成都非诉实习生；不同条目分别约 3 年以上、3—6 年及在读要求 | 事实调查、法律检索、尽调与文书、英语及责任协作；成都实习条目明确包含使用 AI 搜集法律与行业信息 | 综合招聘页，逐条岗位不同；未见统一发布日期，不把实习要求外推到所有律师 | SK01/02/03/06 |
| H02 | 美国 · Latham & Watkins | Supreme Court & Appellate Associate；要求上诉法院 clerkship 经历 | 分析、研究、写作，处理上诉与动议、诉讼策略及保密材料 | 官网职位页可读，无明确发布日期；未独立验证申请是否仍接收 | SK03/04/05/06/07 |
| H03 | 英国 · Linklaters | 早期职业申请与 Success Framework | 主动承担责任、协作、反馈学习、适应变化；可靠交付、审慎判断和面向受众的沟通 | 长期选拔框架，不是单个职位或统一 PQE 要求 | SK01/07/08/09/10/12 |
| H04 | 英国 · Clifford Chance | 伦敦早期职业选拔 | 批判性思考、细节意识，识别假设与推论、评估证据和结论 | 招聘评估说明。测评中限制 AI 的规定只适用于该测评，不能推成工作中全面禁用 AI | SK02/03/04/07 |
| H05 | 美国 · Kirkland & Ellis | 芝加哥 Research Specialist，职位 9003；研究支持岗位，约 5 年以上相关经验 | 澄清请求、选择研究方法和资源、成本与时限管理；用权威来源验证获准 AI 的研究结果，向业务对象简明呈现 | 页面更新 2026-09-23；不是执业律师招聘。具体学历及经历只属于该岗位 | SK03/07/08/09/12 |
| H06 | 新加坡 · A&O Shearman | Restructuring Associate，11393BR，至少 2 年 PQE | 起草和审阅文件、战略与商业判断、客户预期、项目交付、多任务期限及初级成员指导 | 官网职位页可读，无明确发布日期；职位可申请状态未单独确认 | SK01/05/06/08/09/10 |
| H07 | 中国香港 · Clifford Chance | DCM/ECM Capital Markets Associate，JR8650，NQ—2 年 PQE | 交易文件、法律研究、商业方案、跨办公室及当地律师协调，英语与普通话 | **已过期职位**，仅作历史能力样本 | SK03/06/08/10/11 |
| H08 | 德国 · Freshfields | Banking & Finance Associate，EJR_DE_000004；正文提到柏林/法兰克福 | 德英双语起草与谈判、客户及跨专业协作、跨境分析、法律创造性与商业思考 | 官方 Workday 搜索索引可读，直接页面读取有限；“30+ days”不是准确发布日期，未确认实时空缺 | SK05/06/08/10/11 |
| H09 | 法国 · Gide | 巴黎 Regulatory 实习，JR69；Master 2 及相关经历 | 研究、法律意见、合同与争议文书，英语、责任与团队协作 | 官方 Workday 索引，岗位期为 2027 年 1—6 月；未据此认定仍开放申请 | SK03/04/06/07 |
| H10 | 澳大利亚 · Allens | Clerkship / Graduate 培养项目 | 主动承担工作、理解商业情境、跨团队协作、通过反馈成长 | 培养项目而非单一岗位硬门槛；页面的 2026/27 clerkship 已标关闭 | SK01/05/08/10/12 |
| H11 | 新加坡 · Rajah & Tann | 职业与训练合同培养说明 | 沟通与判断、客户价值；主管反馈、学习目标、流程改进和项目管理 | 招聘与培养混合页面；训练内容不等于全部入职前条件 | SK01/08/09/10/12 |
| H12 | 匈牙利 · KCG Partners | 布达佩斯劳动法初级律师，0—1 年经验 | 分析与细节、主动性、创造性、英语和计算机能力 | 地区补充样本，不声称有全球顶级排名；页面未列明确发布日期 | SK02/04/07/11 |
| H13 | 日本 · 长岛·大野·常松 | 招聘负责人访谈及初级律师培养 | 初级律师接触客户、参与事实访谈和争议工作、准备交易文件初稿，并通过团队及前辈反馈成长 | 招聘访谈，不是当前单一职位；未见可靠发布日期 | SK01/02/06/09/10 |
| H14 | 印度 · Trilegal | Campus Tri-connect 校园与初级职业资料 | 尽调、研究、起草与汇报；时限、主动性、客户接触和资深成员指导 | 校园培养资料，正文含历史活动；不是 2026 年在招岗位清单 | SK02/03/06/08/10 |
| H15 | 巴西 · Mattos Filho | Jovens Talentos 法学生培养项目，主要面向法律专业三/四年级 | 主动性、创新、协作，参与专业团队工作及获得主管反馈 | 页面涉及 2027 年项目；其中 8 月 12 日至 9 月 3 日申请窗口已过，其他项目状态另核 | SK01/08/10/12 |
| H16 | 南非 · Webber Wentzel | Graduate Programme Guide，Candidate Attorney 培养 | 审视假设与证据、商业知识、清楚沟通、竞争性优先级及期限变化时管理预期 | **历史官方 PDF**，正文含 2021/22 信息；本轮读取索引缓存，原 URL 曾返回 404，不作为现行招聘条件 | SK01/04/08/09 |

#### 补充解释材料

- **A01：Allens 员工署名文章**描述新人如何准备背景、理解客户商业目标、主动解决问题和及时管理工作预期。它适合帮助设计上下文简报与沟通场景，但不等于 Allens 的统一录用标准。
- **A02：Freshfields 德国职业介绍**区分法律业务、法律项目管理、知识与技术等角色。可据此观察专业服务的分工，不把每个角色的全部技能同时加给所有律师。

### 3. 从招聘语言转成可验收能力

招聘中的抽象形容词不能直接变成提示词。下表规定我们实际要观察什么，以及产品需要支撑什么。映射是本项目的设计推论。

| 能力主题 | 相关证据 | LexOrder 中的可观察行为 | 所需数据与验收 |
| --- | --- | --- | --- |
| 客户目标与商业判断 | H03/H06/H10/H11、A01 | 开始分析前说清客户要什么、可接受的成本/时间、谁能作决定；建议包含替代方案 | 目标、指示、约束、决策记录；未确认目标不写成事实 |
| 事实与批判性分析 | H01/H04/H12/H13/H16 | 区分陈述、材料、推断；支持与反向材料同时呈现，主动列出缺口 | EvidenceItem、多来源与关系、覆盖清单；关键反证样本不能遗漏 |
| 可复查的法律研究 | H01/H02/H05/H07/H09 | 明确争点、法域、相关日期、检索范围；核查原始来源，记录不支持结论的材料 | 法律来源身份、版本、查询日志；来源缺失时输出待核实，不编造引文 |
| 有依据的起草与审阅 | H02/H06/H07/H08/H09/H14 | 文书结构清楚，事实和法律引文可定位，前提及风险显式列出；复核有实际意见 | 版本文书、引用清单、问题定位与处理记录；新版本不能沿用旧审核 |
| 责任、期限与协作 | H03/H05/H06/H07/H11/H14/H16 | 管理优先级、依赖与等待；延期前告知影响，交接包含未完成工作和下一责任人 | Task/WorkResponsibility、来源期限、nextCheckAt、交接确认 |
| 面向受众的沟通 | H03/H05/H06/H11/H13/H16、A01 | 给客户明确的进展、选择、风险及下一步；给同事完整依据；实际交付可还原 | 简报草稿、受众/披露范围、DeliveryRecord、客户确认 |
| 双语与跨法域协作 | H01/H07/H08/H09/H12 | 保持术语、义务、例外、主体和数字一致；指出法律概念不可直接对应处 | 术语表、对齐段落、差异清单；翻译不改变准据法或规则 |
| 反馈、知识与技术素养 | H03/H05/H10/H11/H15、A02 | 采纳复核意见、复盘返工原因、经审核沉淀方法；AI 输出仍核查权威依据 | 技能版本、AiRun、审核反馈、脱敏知识条目、评测集 |

这些资料支持“研究—判断—表达—协作—交付”这一能力结构，不足以推出“增加代理数量就能复制顶级律所质量”或“所有岗位必须使用 AI”。H05 的 AI 验证要求和 H01 的实习生 AI 检索要求为具体样本；LexOrder 的全流程来源核验仍由产品需求和自身质量标准决定。

### 4. 内化方式与优先顺序

采用 **岗位能力 → 工作行为 → 输入/步骤/产物 → 复核点 → 评测场景 → 版本化技能** 的转换方法。

- 第一批覆盖首条完整事项流程：SK01 上下文、SK02 事实、SK03 法律研究、SK04 争点、SK05 策略、SK06 起草、SK07 复核、SK08 推进、SK09 客户沟通与交付。按 M2/M3 分段接通，不能把九项规格等同于九项已完成功能。
- 第二批完善 SK10 交接监督、SK12 知识复用；SK11 双语先做一致性核查，跨法域的实质法律结论留在对应法域能力验证后。
- 统一输入包含 Matter、目标、授权资料、相关法域和日期；统一输出包含依据、覆盖、未知项、反向材料和下一步。人工确认后才调用现有正式业务服务。
- 衡量质量采用律师标注样本与实际核查/返工成本，不能以名所名称、角色人设、生成长度或主观自评分替代。

### 5. 来源清单

以下为官方原始入口。动态网页后续可能变动；实际发布技能时在技能版本记录中保存使用的来源编号、复核日期及必要摘要，不复制整篇招聘广告。

| 编号 | 官方来源 |
| --- | --- |
| H01 | [环球律师事务所：加入我们](https://www.glo.com.cn/join/index.html) |
| H02 | [Latham：Associate — Supreme Court & Appellate](https://www.lwcareers.com/en/experienced-lawyers/united-states/associate-litigation-supreme-court-appellate) |
| H03 | [Linklaters：Your application / Success Framework](https://www.linklaters.com/careers/early-careers/your-application) |
| H04 | [Clifford Chance：How we hire — London](https://jobs.cliffordchance.com/how-we-hire-london) |
| H05 | [Kirkland：Research Specialist](https://staffjobsus.kirkland.com/jobs/18273568-research-specialist) |
| H06 | [A&O Shearman：Associate — Restructuring](https://careers.aoshearman.com/en/job/singapore/associate-restructuring/3392/46005983232) |
| H07 | [Clifford Chance：Capital Markets — Hong Kong](https://jobs.cliffordchance.com/job/associate-capital-markets-dcm-ecm-hong-kong-in-hong-kong-jid-3295) |
| H08 | [Freshfields 官方 Workday：Banking & Finance](https://freshfields.wd3.myworkdayjobs.com/en-US/FBD_101/job/Associate--m-w-x----Banking--Finance_EJR_DE_000004) |
| H09 | [Gide 官方 Workday：Stagiaire Avocat Regulatory](https://gide.wd103.myworkdayjobs.com/en-US/GIDE/job/Paris/Stagiaire-Avocat-Regulatory--H-F-_JR69) |
| H10 | [Allens：Our programs](https://graduates.allens.com.au/our-programs/) |
| H11 | [Rajah & Tann：Careers Singapore](https://sg.rajahtannasia.com/careers-singapore/) |
| H12 | [KCG Partners：Join us](https://kcgpartners.com/join-us/) |
| H13 | [长岛·大野·常松：招聘负责人访谈](https://recruit.nagashima.com/lawyers/message/) |
| H14 | [Trilegal：Campus Tri-connect](https://trilegal.com/campus-tri-connect-newsletter/) |
| H15 | [Mattos Filho：Jovens Talentos](https://www.mattosfilho.com.br/jovens-talentos/) |
| H16 | [Webber Wentzel：历史 Graduate Programme Guide PDF](https://www.webberwentzel.com/Careers/Early-Careers/Documents/webber-wentzel-graduate-programme-guide.pdf) |
| A01 | [Allens：Five skills a commercial lawyer needs](https://graduates.allens.com.au/life-at-allens/Five-skills-a-commercial-lawyer-needs/) |
| A02 | [Freshfields：Associates & Legal Professionals — Germany](https://www.freshfields.com/en/your-career/germany/legal-careers/associates-legal-professionals) |

### 6. 后续研究与维护

本轮尚未建立加拿大、中东及其他市场的足够官方样本，也未全面覆盖税务、竞争法、刑事、知识产权等专门岗位。后续扩展跟随用户业务需求，优先补真实职位和专业任务样本，不追求国家数量。

新增来源必须记录角色、地区、时点和有效状态；更新技能前说明新增来源改变了哪个步骤、输出或验收。某个岗位下线不自动使已验证的通用工作行为失效，但不能继续把它宣传为该所当前招聘要求。涉及执业资格或法律义务时，另查适用的正式规则，招聘广告不是法律依据。
