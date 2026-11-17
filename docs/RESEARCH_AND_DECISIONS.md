# LexOrder 研究与决策依据

**现行执行范围（2026-11-17，用户最新决定）：只实现直接服务律师办案的业务需求。发行、打包安装、部署完善、旧实例升级、备份与整套恢复、运维、性能/容量专项及通用基础设施优化等非业务维护，连同预研、环境准备、独立测试和验收全部延期；M4/W13/AC15 无当前排期，不分配本期 owner，不作为业务开发、提交、验收或里程碑门禁，不因 M3 完成或进入后续阶段自动启动，须用户以后明确重新安排。保留已有代码和历史证据，延期不记为完成。直接支撑业务的权限、审批、来源版本、事务、审计、幂等、材料提交失败处理、实际交付和案件归档继续保留；必要数据库结构变更按受影响业务验证。开发侧只做受影响 API/静态及必要隔离数据库检查，浏览器由用户统一验收，律师专业验收单独记账。**

更新日期：2026-11-17；外部来源核查仍以各条登记时点为准。本文合并原项目来源/许可和全球律所招聘研究；保留来源、固定版本、适用范围、时点与采用边界。产品行为见[需求与技能](PRODUCT_REQUIREMENTS_ACCEPTANCE.md)，技术取舍与试验见[架构与发布](REFACTOR_DESKTOP_TEAM_RAG.md)，不另开按话题拆分的研究文档。

## 当前研究结论与使用方式

| 证据类别 | 已完成的工作 | 形成的决定 | 不能据此宣称 |
| --- | --- | --- | --- |
| 用户需求 | 汇总用户纠正及本次三 agent 复核 | 在现有 Server 上只实现业务；M4/W13/AC15 和所有非业务维护及其准备/验收全部延期、非门禁、无自动重启；Personal 搁置，第三方独立可选 | 将维护、固定产物或外部凭据重新作为业务前置，或宣称延期/可选项已完成 |
| 既有项目 | 固定 LawLink/二开提交；保留 §3.5 对 13 个候选指定模块的深读记录与 SK01—SK12 映射，核对实际移植 | 复用 TS、事项与财务/审批链，逐步补材料和交付 | 所有参考项目的能力都已移入 |
| 桌面/存储 | 官方资料、固定版本隔离试验、共享根 App 与本机操作者接线、私有 PG 通道反例 | 精简 Next/Node + PGlite 的历史设计保留；Personal/Windows 搁置 | 后续变更后的应用可运行、全量 PG 兼容或 Windows 发行已验证 |
| RAG 后端 | LanceDB 0.41.0 SDK 原型、抽取/OCR 边界测试、RAGFlow 1.0.0 HTTP 适配与固定部署准备脚本 | 两个适配已有代码；Lance/OCR 新增 26 项通过；RAGFlow 为 `PREPARED_NOT_DEPLOYED`，真实服务/模型联调待配置 | 适配已接通完整业务、真实语义/OCR 质量已验证，或 RAGFlow 已部署 |
| 专业能力 | 16 个主要官方来源，13 个国家/地区及补充材料 | SK01—SK12 的输入、步骤、成果、人工复核与评测 | 全球排名、每国穷尽调查、名所背书或 AI 执业资格 |

研究采用“观察到的行为 → 输入输出与规则 → LexOrder 设计 → 场景验证”。来源事实、产品推论和已运行结果分别标明。动态页面不自动等于固定版本能力；新增依赖固定版本和完整性，实际采用源码时登记文件与许可。招聘页面状态按核查当日记录，后续实现时复核需要更新的来源。

**最近一次业务对照：** [§3.24](#324-业务与参考项目静态对照审查2026-11-17) 以 LexOrder `89d3245` 为业务源码基线，沿模型、服务、实际入口与失败接续对照十个固定参考项目的指定模块。分别登记当前缺陷、日常接续差距、可选 AI 问题和后置能力；本轮仅静态审查，没有实施修复或运行验收。收尾同步 `a887859` 的文档范围调整，该提交未改业务源码。用户要求将本轮问题报告合入主线后，本节末尾补齐[逐项改动与处理状态](#六本轮问题报告与改动清单2026-11-17)，完整证据仍沿用同号发现。

**云端案件演练证据：** [§3.25](#325-云端案件演练与界面审查2026-11-17)归档2026-11-17当轮界面操作、10组问题、8组设计建议、22张合成截图和关键操作摘录；原归档提交仅整理证据。后续独立收案组7项修复的研究取舍见[§3.27](#327-收案与审批独立修复的参考取舍2026-11-17)，实现与开发验证见[计划§8.32](WORKBENCH_PLAN.md#832-独立收案审批与案由修复2026-11-17)，未以旧截图冒充修复后浏览器验收。

Server M2 业务预览已完成，最终实现与实际业务证据见[实施计划 §8.9](WORKBENCH_PLAN.md#89-m2-最终收口账本2026-11-16)；初批材料/上下文、客户连续记录/人工日期分别保留于 §8.4、§8.6。[§8.3](WORKBENCH_PLAN.md#83-m1-当前验证与交接2026-11-16) 保留 M1 历史证据：Personal 共享根应用曾构建通过，后续新工作区初始化报 `M1_INITIALIZATION_COMMAND_FAILED` 后依用户指令停止验证；没有 Windows 产物。Server-only 服务脚本实跑两项 `NOT_CONFIGURED`、退出码 2，未调用 Personal；无真实模型凭据或 RAGFlow 实例时不记联调通过。

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
| RAGFlow | [v1.0.0 正式发布](https://github.com/infiniflow/ragflow/releases/tag/v1.0.0)、[1.0 HTTP API](https://ragflow.io/docs/v1.0.0/http_api_reference)、[部署](https://ragflow.io/docs/v1.0.0/)、[共享权限](https://ragflow.io/docs/v1.0.0/guides/team/resource_sharing/resource_sharing_and_permissions) | 已有解析/索引/检索平台；正式版及权限语义有明确边界 | Server 可选增强；历史适配目标 1.0.0 保留，镜像清单、部署及联调准备全部延期。默认内置解析与 PG 搜索，已有 HTTP 适配不代表真实服务接通；业务与引用由 LexOrder 管理 |
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
| Kosmos `c6454fd5488c0d231e2b4756846f690c679586ca` | [模型](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/models.py)、[来源归属](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/facts/access.py)、[动作](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/facts/views.py)、[事实行](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/templates/case/facts/fact-row.html)及跨事项来源测试 | 高亮与事实多来源关系、原文邻近操作、同案校验可参考；普通事实表单要求日期，但模型允许空日期；旧 AI block 可在用户明确指示下创建事实，其案件内 AI chat 已退役。不要把旧实现当成当前聊天功能 |
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
| SK05 商业判断与客户决定；H02/H06/H08/H10 | Frappe 历史/销售预测、Counsel 文本决定；本轮 §3.12 未证实所需完整比较业务 | 复用 OPTION/DECISION 文本与来源/更正；结构化比较、评分及自动变化分析暂缓最低、非门禁 | M3 既有记录；B 无当前新增排期 |
| SK06 结构化起草；H01/H02/H06/H07/H08/H09/H14 | docassemble 条件/依赖与核对 UI、j-lawyer 实际字段补全/模板，LawLink 既有快照 | 保留实际模板的字段值/缺项/少量明确条件/人工核对和只读准备；通用访谈/递归跨会话依赖/AI 补问暂缓 | M3 W10.2 轻量链；C 通用机制最低优先级 |
| SK07 版本化审阅；H02/H03/H04/H05/H09 | Counsel 精确引用与显式影响链、Word 往返比较；诉讼可视化机械核对 | 定位问题—作者回应—实际处理—针对新版本复核；M3 补直接来源影响提示，保留历史批准；Word 谈判归因与批量问题表后续深化 | M3 W10.2；M5 W14 |
| SK08 法律项目推进；H03/H05/H06/H07/H11/H14/H16 | ERPNext 任务前置模型/服务/UI；ANQI 局部计算/人工重算预览；Twenty 等待；j-lawyer 巡检 | D 保留轻量同案依赖/完成检查及等待；E 不具备当前所需完整版本历史/差异证据，暂缓最低，复用原期限 | M3 W11 保留范围；E 无当前排期 |
| SK09 面向客户的沟通与交付；H03/H05/H06/H11/H13/H16、A01 | Counsel 有自动内部摘要，Frappe 有邮件沟通；均未证明完整客户简报/披露/审批/交付链 | 人工 Document 简报、固定交付版本/发送事实与独立回复；F 自动客户简报暂缓最低、非门禁 | M3 W12.1 人工链；F 无当前排期 |
| SK10 交接与监督；H03/H06/H07/H10/H11/H13/H14、A02 | j-lawyer 巡检、Frappe 按来源资格显示历史、Twenty 可恢复运行；不能据此宣称合伙人监督已完整实现 | 复用责任交接，形成接收检查表、关键期限/未决问题/授权材料包和反馈；Server 真实接收人确认；当前 Server 实施资料整理与本人事项巡检；设计可复用，但 Personal 仍搁置 | M5 W14；M3 保留既有责任守卫 |
| SK11 双语/跨法域；H01/H07/H08/H09/H12 | 本次开源阅读未证实“条款对齐—法律效果差异—当地复核”完整链；多语界面/模型不构成证明，Clio 仅产品对照 | 原/译文固定版本、术语/数字/否定/例外对齐表；按法域分栏研究、来源时点和当地律师待核实项；逐法域与样本验证 | M2 W07.1 预留；M5/M6 W15 |
| SK12 反馈、知识与方法复用；H03/H05/H10/H11/H15、A02 | Counsel 知识/影响及模板化方法仍是研究资料 | 用户明确将案件→知识发布及治理暂缓最低；既有 SK07 审阅反馈、资料与模板保留 | W09.3/RQ16/AC14 暂缓，M3/M4 非门禁，不自动排 M5/M6 |

#### 3.5.3 采用决定与不直接搬入的行为

1. **材料操作与法律来源分开。**采用 Paperless/AnythingLLM 的逐件摄入和失败补救；同一次操作重试幂等，同内容的不同来件/举证方/收件时间保留业务来源。LexOrder 的短信附件已按 `(smsId, sha256)` 区分重复操作和重复送达；通用摄入沿用此语义。不得用全局 hash 命中向无权用户透露其他事项。
2. **候选、来源、人工裁决分开。**采用 ANQI 的跨材料人工处理记忆；只有严格相同身份且无实质变化的候选沿用处理结果。新矛盾、身份修正或新版本实质变化须复核；语义相似仅提合并建议。人工拒绝不是法律真值，也不能让新反证永久消失；费用候选匹配不等于到账确认。
3. **输入覆盖和检索诊断支持专业判断。**实际启用自动技能时按具体切片记录接收、解析、召回、实际供给及引用范围，是否采用 AiRun 另行决定；供给不证明模型理解。参考 Cherry 的召回测试/片段/排序展示，按实际需要记录材料、索引和配置以复现查询；不把排名/相关分称作事实置信度或胜诉概率；不将原文和完整查询写普通日志。
4. **检索与完整审查分别设计。**采用 AnythingLLM/Counsel 的输入组织经验，定向问答按问题召回，指定材料审查按材料/页段清单推进；被预算或压缩排除的部分可见。法律研究额外核对来源身份/时点/效力角色及反向依据。多文档问题表是后续产品设计，每格保留来源和未知原因，不以表格填满代表尽调完成。
5. **文书准备和复核保留副作用边界。**参考 docassemble 与 j-lawyer 的有限条件/字段值核对，用现有模板服务实现；本次值、主档修改和只读准备分开，处理已证实 applyOverrides 写主数据路径。通用访谈/递归跨会话依赖/AI 补问最低优先级暂缓；SK07 人工意见回应和修订处理继续做，Word 轮次仍后置。
6. **变更影响沿显式关系计算。**采用 Counsel 的不可变引用关系；M3 只覆盖实际来源直接影响，范围未连边/截断如实说明。知识与旧成果间接关系不自动排 M5，不引入图数据库，也不重绑旧引用、批准或交付。
7. **协作复用现有责任与对象。**Frappe 的历史继承须逐来源鉴权；LexOrder 已有客户关联事项和最近动态（`clients/insights.ts`），增量是连续分页、沟通/跟进/指示/决定/交付链接，不能写成没有客户全景。Twenty 仅用于固定步骤、等待与恢复，技术任务不取代 WorkResponsibility；j-lawyer 的“无下一动作”只提示补安排，不自动造法定期限。
8. **原件与业务来源独立于可重建索引。**保留材料提交、具体版本、幂等、当前权限及真实失败处理；派生复用不按文件名猜测，主动取消的外发不自动续做。Paperless 清单/完整性报告、RAGFlow 同版恢复、通用队列增强和索引运维等维护设计保留，相关准备、建设与独立验证全部延期，不由参考研究自动立项。

本次不采用通用工作流画布、平行 CRM、完整 Docassemble/Frappe 服务、AppFlowy 语言/同步迁移或额外 RAG 后端。SSO、数据区域、企业审计导出及其他非业务基础设施专项全部延期，不自动安排后续排期；现有角色、受限事项与业务审计继续保留。明确事项隔离或外部协作业务须另按实际需求确定范围。Personal 无认证只保留历史设计；后续业务候选见[实施计划 §3.9—3.10](WORKBENCH_PLAN.md#39-参考研究进入-m2m4-的具体增量)，维护不构成其前置。

### 3.6 Server M2 模块决定与阅读边界（2026-11-16）

| 模块/用户任务 | 参考依据 | 采用与实际入口 | 不采用及验证边界 |
| --- | --- | --- | --- |
| 上传后知道每件处理结果 | Paperless-ngx 固定 `4610171`，此前已读 upload-documents service / 状态托盘 | 原材料行区分原件已保存、处理中、部分处理、失败/重试；业务规则独立实现 | 不复制整个管理平台；扫描无 OCR 不写成功 |
| 要点同时核对支持和反证 | Kosmos 固定 `c6454fd`，此前已读模型/事实行/OCR badge | 复用 EvidenceItem，加多条原版本来源；操作就近 | 不覆盖原件、不借可变 textContent 伪造锚点；来源当前权限单独检查 |
| 隔几天恢复客户指示 | Frappe CRM 固定 `3509bd4`，此前 Activities.vue/crm_lead.py 阅读记录 | 复用客户身份/活动；在原案件档案增加版本化目标与指示 | 不抄销售阶段或样式；本轮未重新抓取到固定源码，不声称重新验证 |
| 管理可选服务 | 现有 /admin/ai 和官方服务接入指南 | 沿用设置入口，独立启用/状态/加密凭据；MCP 目录与自定义远程 | 不在启动探活、不自动执行第三方写工具、不把目录当真实接通 |

三 agent 已按“入口、对象、下一步、失败出口、权限、文件 owner”做两轮独立/交叉审查。Next/React 代码遵循本地版本指南，UI 改版后置；本批只有必要业务分区与状态接线。

### 3.7 M2 客户连续记录与事实日期实施决定（2026-11-16）

沿用 §3.5 已读取的固定来源，不重复全量研究或声称运行第三方产品；两项的本地现状和用户路径已再次核对。

| 用户任务 / 参考 | 本项目决定与采用边界 | 实际验收关注 |
| --- | --- | --- |
| 回看客户较早沟通、关联案件和指示：Frappe CRM `3509bd4` 的 activities.py / Activities.vue / 转换业务 | 保留原客户页，既有表连续分页、逐来源资格和真实可见计数；不复制 Frappe 源码、销售阶段或重复客户身份。指示版本分别呈现，实际交付仍属 M3 | 超过原 50/100/6 条窗口，同时间翻页、客户合并/软删除、事项或财务撤权、来源跳转和失败重试 |
| 核对事实发生顺序及反证：Kosmos `c6454fd` 的 Fact/事实行；诉讼可视化 `16c480c` 的 casefile.schema.json | 日期精度独立于正文，多来源就近；LexOrder 明确 UNKNOWN 与闭区间，不照搬强制完整日期或封闭事实分类。原始日期表述保留，发生日与记录时间分开 | “某年夏天”保持未知或人工明确的区间；只改日期仍生成修订；撤权后当前/历史日期和排序位置隐藏 |

用户合理性审查：入口留在客户详情、事项材料区域；分页操作与其列表就近，事实编辑沿用原弹窗，不增加全局菜单。未知、空白、加载失败可继续人工处理；不把数据查询成功等同于 UI 交互已通过。日期、授权呈现与文件所有权见架构 §6.4.2 和计划 §7.4。

实施状态：上述两项已在 `da2701b` 汇合，沿用 LawLink 页面独立实现，没有移入 Frappe/Kosmos/诉讼可视化源码或增加第三方运行依赖。新增 7 个真实 PG 场景、两组开发模式真实会话 HTTP 和生产构建通过；当时真实浏览器因缺 originating context 阻塞。固定来源与采用边界以 §3.5.1 和本表为准，本轮没有重复运行或重新验证参考产品；完成账本见计划 §8.6。后续浏览器证据与离线输入诊断见 §3.8/§3.9 及计划 §8.7/§8.8，自动候选处理记忆和持久 AiRun 仍分项推进。

### 3.8 用户页面反馈后的入口修正（2026-11-16）

本轮重新读取 LexOrder 当前 MatterDetailPage、MatterDetailTabs、ProcedureWorkflowPanel、MatterArchive、EvidenceTimeline、TeamMatterOverview 及管理导航，直接复现已登录事项链接 404；未新增第三方源码或重复运行参考产品。沿用 §3.6 / §3.7 已记录的 Frappe CRM 对象内活动、Kosmos 事实/来源关系和 LawLink 原布局，仅修补本项目遗漏。

以下是当时采用及验证记录；其中旧 ID/大小写后备策略已被用户后续“不保留兼容/fallback”约束取代，现行决定见 §3.10 与架构 C02，不作为继续保留旧分支的依据。

| 用户任务 | 当前事实与本项目决定 | 审查及验收边界 |
| --- | --- | --- |
| 从客户或案件列表打开事项 | 数据库编号含小写，旧解析仅按大写查询；改为原编号/旧 ID 精确优先，再解码精确查询，最后只接受唯一完整编号的大小写后备匹配 | 原鉴权保留；软删除、精确或后备歧义不跳另一事项。复验用户的原链接，不改编号伪造成功 |
| 重开事项了解下一步 | MatterBrief 原来只有服务、未接 UI；「档案与摘要」首部补授权摘要，原目标与指示保留在同页 | 读取失败有重试；刷新和切换对象丢弃旧结果；受限来源不展示正文。摘要非 AI 生成，不据此宣称自动分析完成 |
| 找到材料和可选服务 | 「办案与材料」明确原材料区域，事实时间线沿用该区域；后台名称统一「AI 与外部服务」 | 不堆叠全局菜单，不移动业务身份或改变外部服务可选性；实际点击和可见结果单独记账 |

### 3.9 离线材料读取检查与按钮可理解性（2026-11-16）

| 用户任务 / 来源 | 实际阅读与采用 | 不采用及验收边界 |
| --- | --- | --- |
| 检查本次材料究竟能读到哪里：Counsel OS | 本批 root 与服务 owner 实际读取固定 `c4f40f1ffd40146531bcaa7f43e6877a733f92ca` 的 [context-preparation.ts](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/context-preparation.ts)，核对显式范围、`read.execute`、部分读取/字符预算、省略链接和新旧版本提示。借鉴有界读取与未覆盖部分可见，沿用 LexOrder 已有 Document/解析快照/权限独立实现 | 未导入源码或运行完整 Counsel OS；不采用自动扩大召回、跨事项上下文或其模型策略。已解析、可准备与实际发送分别记录，此批发送恒为 0 |
| 看懂按钮并继续原任务：LexOrder 实际运行页 | 独立 agent 在 M2C 合成事项和 `LL-2026-CC-9001` 点击目标指示、来源、历史、当事人/团队、事实和空材料，root 另做独立验证。问题包括对象不明、错误表单、同名来源、丢焦点、固定头遮挡和事实状态歧义；采用明确动词+对象、分区定位和返回位置 | 这是本项目真实观察及设计判断，不借第三方名义证明整体设计优良。沿用 §3.5.1 Frappe 对象内操作和 Kosmos 来源关系的已读依据，不重复导入/运行它们；本批保留 LawLink 样式 |

实施前合理性审查：新输入检查留在现有「办案与材料」，先勾选再检查；用户能看到具体版本、检查范围、未处理内容与补救提示。按钮修复保留原业务权限和确认状态机，不引入新的全局模块。模型未配置照常完成本地检查。实现复核与真实页面复验分别记账，组件测试不替代浏览器点击。较大信息密度问题保留为后续整理项，本轮不能以文案修复宣称全站设计完成。

M2 收口时，首次创建要点的请求身份缺口来自 **LexOrder 当前代码路径**。稳定请求键、归一化载荷指纹、有界竞争重放及不可变身份是本项目沿用现有领域守卫补齐的实现，不宣称从 Counsel OS、Frappe 或其他参考项目移植。模型/SQL、领域服务与表单在独立 worktree 分工，二轮定点审查及真实 PG/原页面结果见计划 §8.9；本批没有新增第三方源码或运行依赖。

本地框架约束也在编码前核对：root 阅读已安装 Next 16.4.6 的 `01-app/02-guides/server-actions.md`、`server-and-client-boundary.md` 及相关 Server/Client Components 指南；表单 owner 阅读 `01-app/03-api-reference/01-directives/use-server.md`，并定点阅读 Server Actions 的客户端派发、返回/重验证和授权段落。采用结论：客户端 pending 或顺序派发不提供服务端幂等；Server Action 每次请求仍需当前鉴权，客户端只传请求键和草稿，以表单生命周期隔离迟到响应。不据此声称完整框架文档都已审查，也不升级框架或绕开边界。

### 3.10 案件修复的组件与流程决定（2026-11-16）

用户要求先形成修复计划，多轮按事实检查逻辑；样式复用项目框架，业务合理分区切换，用布局表达逻辑并减少冗余文字。随后追加单一现行实现、不保留兼容/fallback、减少抽象/防御/投影/重复 hash、成熟库优先及核心端到端先行。本轮以 `4fe7479` 及专项冲突增量 `d3b5cb0` 为源码事实，不重复执行前轮浏览器审查；前轮证据、当前源码复核和未来实施验收分别登记。

| 用户任务与实际阅读 | 本项目采用的决定 | 不采用及验收边界 |
| --- | --- | --- |
| 在页面和弹窗读清事实：[components.json](../components.json)、公共 [Dialog](../src/components/ui/dialog.tsx)、[Badge](../src/components/ui/badge.tsx)、[Button](../src/components/ui/button.tsx)、[form-dialog](../src/components/patterns/form-dialog.tsx)、[moan patterns](../src/components/patterns/moan.tsx)；再次读取官方 [shadcn Radix Dialog](https://ui.shadcn.com/docs/components/radix/dialog)、[Badge](https://ui.shadcn.com/docs/components/radix/badge)与 [Radix Portal](https://www.radix-ui.com/primitives/docs/components/dialog#portal) | 已安装组件保留项目主题，用标准变体与自包含布局组合事实列表；沿用已有遮罩、焦点、键盘和滚动行为 | 不复制页面 CSS，不另造 Timeline/基础控件，不覆盖公共组件去追官网最新外观；页面与 Portal 的长文、来源、错误及窄屏各有实际验收 |
| 在复杂案件里找到当前任务：本地 matter-detail-tabs/procedure-workflow-panel 的真实结构、现有 Tabs/Segmented；复用 §3.3 已读 Frappe CRM `3509bd4` 的对象导航和列表/详情连续性结论 | 保留四个案件主页面，办案页内材料/事实与来源/待办/记录合理切换；范围控件贴近相关列表，详情顺序往返，当前区只显示当前业务 | Frappe 仅复用此前行为研究，本轮未重新运行其产品或宣称重新抓取全部源码；不搬 Vue/销售阶段、不添加新工作台、不用说明卡代替分区。此分区是本项目设计判断 |
| 编辑失败后知道哪些变了：[team-editor-dialog](../src/app/(app)/matters/[id]/_components/team-editor-dialog.tsx)、[matters/actions](../src/server/matters/actions.ts)、现有 work-responsibility-panel | 按基本资料、程序与当事人、成员独立保存；主办走现有交接。程序接口省略字段会清空，先保持完整合同；事务内核前置值 | 不把三个 Server Action 在客户端同时调用伪装成原子事务，不增加“部分保存成功”常驻说明来维持巨表单；故意失败和陈旧版本必须验证对象未被串改 |
| 从材料完成版本、人工审批与入卷：[documents/actions](../src/server/documents/actions.ts)、[material-ingest](../src/server/documents/material-ingest.ts)、[卷宗服务](../src/server/document-folders/actions.ts)、模板与审批记录服务 | 一个材料详情复用既有版本、撤回、送审及批准后入卷；补入卷事务内守卫，再接入口；状态绑定具体版本 | 不把有服务名等同可直接开放按钮，不把旧版混列可读误报成不可见，不把 AI 审查当人工审批；修订不挪用旧审批 |
| 开票、合同、结案与归档失败可继续：invoice-request-sheet、finance/actions、ledger-workspace、archive-wizard、archive/closure 和 export-access | 文件/申请各有稳定请求身份；已有材料可选；合同和审批使用原专用工作台并带受控返回；结案与归档分用真实阻断，补充归档绑定合法卷宗 | 不以预检替代提交复核，不给开票追加收款门禁，不给结案套全部归档阻断；不复制财务长表到案件页、不放开批准快照或普通归档后写入 |
| 查看 AI 历史和真实输入范围：document-review-dialog、review-document、save-review、input-coverage-service | 同一请求绑定对象；按服务端 ReviewRecord 保存；真实送审统计来自实际 segments，历史缺数据如实保留 | 离线诊断与旧审查文本来源不同，不能用相同预算伪装同一供给合同；不重做已经交付的离线诊断，不扩成完整 AiRun |
| 统一当前入口：[路由生成](../src/lib/matters/route.ts)、[路由解析](../src/server/matters/route.ts)、finance-forms 与 finance/actions | 路由仅用现有实际 internalCode，现行调用方一起更新；合同只走原财务工作台登记/变更，删除已替代旧表单 | 旧 ID、大小写后备、缺编号退 ID、按 ledgerReady 回旧表单均与新约束冲突；不迁移旧书签/配置，不以相似编号猜测目标 |
| 以真实版本读材料：[schema](../prisma/schema.prisma)、material-ingest、[模板创建](../src/server/document-templates/actions.ts)与 save-review | 首链直接使用具体 Document ID；后续统一模板/报告/上传的版本族写入，再按实际存量决定必要数据库迁移 | 这是当时的源码判断；模板/报告后续已写族，当前显式上传新版的建族行为见计划 §8.19。不能猜测库存或将新上传当作全库回填 |
| 按批准事实导出：[closure](../src/server/archive/closure.ts)、[export](../src/server/archive/export.ts)、[verification](../src/server/archive/verification.ts)与既有结案/归档服务 | 删除缺表跳过、旧指纹试算及当前 manifest fallback；现行指纹算一次，复用已验证原件 Buffer 打包，保留必要完整性与资格检查 | 不从当前数据补造历史批准，不把省 hash 理解为取消归档校验，不另建通用检查/快照平台 |

工程决定：先做“案件→具体材料→要点/来源→返回”，接口只服务当前链，组件按对象/责任组合；随后逐条扩展编辑、文书、财务、归档。草案中整批冻结公共合同、通用能力/读模型倾向、团队 hash 快照和旧报告恢复工作台均已取消。来源缺可信绑定明确不可用，必要历史数据处理只走已核实的数据库迁移，不保留第二套运行路径。

实际 [package.json](../package.json) 已有 Zod、Prisma、PizZip，项目已有存储 sha256 helper 和 Node crypto；UI 已有 Dialog/Sheet/Tabs/Button/Badge/FormDialog 及确认模式。本计划无需为上述缺口新增 UI、hash、状态或通用幂等库。先复用现有能力，真正不足时才评估成熟维护库，不把简单修复扩成选型工程。

项目约束见 [AGENTS §5.3/§5.4](../AGENTS.md#54-单一现行实现与适度工程2026-11-16-用户追加)，产品落点见[需求 §9.3](PRODUCT_REQUIREMENTS_ACCEPTANCE.md#93-案件操作的分区与交互修复规格)，具体边界见[架构 §6.4.6](REFACTOR_DESKTOP_TEAM_RAG.md#646-案件操作修复合同)。详细业务规则用于实施/验收，不原样铺到产品页；用户看到对象、分区、状态、动作和必要就近反馈。多轮审查纠正及未验证范围见[计划 §7.10](WORKBENCH_PLAN.md#710-案件界面与操作流程修复计划2026-11-16)。

### 3.11 M3 计划细化的事实与采用决定（2026-11-16）

本轮用户要求“详细化 M3，结合新的约束，审查几轮直到没问题”。工作仅为计划与定点静态核对；没有新增业务实现、运行第三方应用、调用真实模型/法库或执行 M3 浏览器验收。远端 main 已核 `559ca14`，本地 M2 源码/收口为 `01577ea`/`111371c`；新工程约束及 UI 专项合同以 `a2a705b`/`7387819` 为准，现有 UI 另核 `c582e5e`。本地未合入状态和远端状态分别记录。

| 用户任务 | 本轮实际核对的本项目事实 | 采用、复用与不采用 |
| --- | --- | --- |
| 保存可回查研究 | [来源契约](../src/lib/workbench/contracts.ts)、[schema](../prisma/schema.prisma)、既有材料/上下文服务、元典/cncases 和 [MCP 管理](../src/server/legal/mcp-actions.ts) | 契约已有三类资料，但没有完整持久研究链；使用授权资料即可先交付。补法源身份/时点和实际阅读记录，不把配置预览当真实研究接通 |
| 方案与真实指示 | [上下文服务](../src/server/matters/context-service.ts)与已有 OPTION/DECISION/不可变更正 | 复用文本及实际来源，不新增结构化比较或第二份决定；B 的暂缓证据见 §3.12 |
| 起草和逐条复核 | [模板引擎](../src/lib/template-engine.ts)、[模板动作](../src/server/document-templates/actions.ts)、[文书动作](../src/server/documents/actions.ts)、ReviewRecord | 确认 buildContext→applyOverrides 会写 Client/Party，准备边界先改；沿 Document 固定稿件和原审批，新增人工问题/回应/修订/处理，不重写 RP05/C09 基础修复 |
| 等待、依赖与现有期限 | [任务动作](../src/server/tasks/actions.ts)、[责任动作](../src/server/reminders/responsibility.ts)、[确认](../src/server/deadlines/confirm.ts)及[重算保护](../src/server/deadlines/recalc-guard.ts) | 补事项级入口、等待/检查日和 D 轻量依赖；RESCHEDULE 真改法定日，不当内部计划。E 完整计算历史/差异链暂缓，现有日历异常与业务日问题单独定点处理 |
| 人工简报与实际交付 | ClientActivity/FollowUp、Document、MatterBrief 与归档服务 | 使用人工 Document 简报，补固定交付版本与发生事实；F 自动简报暂缓。FirmFile 共享现状是未来知识设计依据，W09.3 已暂缓，不增加知识候选/发布模型 |
| 找得到操作并回到原处 | matter-detail-tabs、procedure-workflow-panel、matter-context-section、document-review-dialog、现有 patterns/ui、C02/C05/C06/C09/C10 合同 | 四个主页面不增加一级模块墙；M3 消费下一现行 workPane 合同，按实际交接文件推进，不保留旧 work 参数。已保存重开与未保存草稿恢复分清，窄屏本轮不纳入 |

参考项目沿 §3.5.1 的固定代码及既有阅读结论使用：研究/引用采用 Counsel 的可复查输入和直接影响关系，事实关系采用 Kosmos，期限解释采用 ANQI，模板依赖采用 docassemble，操作连续性采用 Frappe CRM。**本轮没有重新运行或重新读取这些项目全部源码，不扩大已有证据边界。** 每个实施切片按 AGENTS §5.1 再读取其真正触及的相关实现/UI 小范围并记录，不重复遍历全参考清单。人工复核、真实客户决定、交付及脱敏发布的具体组合是 LexOrder 的设计判断，不能宣称某个参考项目已提供完整同等闭环。

新约束采用决定：复用已有主对象，先研究保存，再接轻量模板/人工复核、任务等待/成熟同案依赖，随后人工简报/实际交付及两类工作包验收。W09.3、B/E/F 深化及 C 通用机制暂缓最低，不安排 owner、不预建模型、不作为门禁。保留确切文书/交付与现有来源记录，日常读取不重复 hash；沿已有 TS/Next/Prisma/表单/DOCX 库，不加新平台或兼容层。

原 M3 细化稿由三名独立 agent 完成事实首审、执行稿交叉审查和修订后定点复核，第二轮8项问题均已关闭；具体发现与历史关闭状态统一记[计划 §7.11.9](WORKBENCH_PLAN.md#7119-m3-关闭标准与审查账本)。本轮范围裁剪以 §3.12 和计划 §7.11.10 为准，不以此前审查重新启用暂缓项；计划通过不表示实现/浏览器/专业结论已通过。

### 3.12 范围裁剪与轻量采用的源码复核（2026-11-16）

**用户决定：**先明确将 A/W09.3 案件成果→知识沉淀暂缓、最低优先级、非门禁，并要求同步全部相关计划；随后授权对 B—F 逐项检查参考项目，有成熟且适配当前架构的业务就采用，否则同样暂缓并用轻量路径承接。不是把全部增强一概取消，也不因参考有功能就迁入整套服务。

**核实口径：**本轮三名 agent 分别读 B/F、C、D/E 的固定源码与实际 UI 代码，root 复读关键入口并核对本项目依赖。以下是源码研究和计划决定；没有运行参考产品、其测试或本项目应用，不声称真实浏览器或业务实现验收通过。已有研究事实继续保留，现行采用决定覆盖旧“首发必做”措辞。

| 范围 / 固定来源 | 实际读到的业务与入口 | 采用边界和本期决定 |
| --- | --- | --- |
| B：Counsel OS `c4f40f1ffd40146531bcaa7f43e6877a733f92ca`；Frappe CRM `3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952` | Counsel [store.ts](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/store.ts)、[Editor.tsx](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/ui/src/workspace/Editor.tsx)、[MatterPage.tsx](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/ui/src/workspace/MatterPage.tsx)有文本成果/人工决定/固定引用的保存与重开；Frappe [CRM Deal](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/crm/fcrm/doctype/crm_deal/crm_deal.py)是销售状态和预测 | 未证明法律备选方案、成本/时间假设、比较版本与真实客户指示的完整结构化链。B 暂缓最低、非门禁；直接复用现有 OPTION/DECISION 文本、来源和历史，不搬销售概率或建立第二套决定 |
| C：docassemble `36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d` | [parse.py](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/parse.py)、[standardformatter.py](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/standardformatter.py)有缺项求值、递归依赖失效/旧值、核对编辑 UI；[depends-on](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/depends-on.yml)、[条件核对](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/review-conditional.yml)、[DOCX](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/docx-template.yml)示例贯通实际访谈机制 | 成熟机制存在，但依赖 Python/YAML 动态求值与运行时。保留本期实际模板的少量明确条件、缺项补全和人工重核；通用访谈、递归跨会话依赖、任意表达式和 AI 补问暂缓最低，不迁入整个平台 |
| C：j-lawyer `f523d141327e5c74269dd9c71b54ae1c05a415a3` | [FormInstancePanel](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-client/src/main/java/com/jdimension/jlawyer/client/plugins/form/FormInstancePanel.java)、[FormsService](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-server/j-lawyer-server-ejb/src/main/java/com/jdimension/jlawyer/services/FormsService.java)、[模板对话框](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-client/src/main/java/com/jdimension/jlawyer/client/editors/files/AddDocumentFromTemplateDialog.java)有案件资格、字段保存、模板实际占位符/现值/空值警示与生成，过时加载结果隔离 | 采用“选模板/主体→实际字段值→补缺→核对→生成”。不搬 Java/Swing/Groovy 插件、MD5 变更机制；其插件 depends 不冒充字段依赖引擎。LexOrder 已有变量/缺项/5个渲染字段/快照，补确切对象和只读副作用即可 |
| D：ERPNext `19964b09a0045c014bb2f9ab66cd8703eb3722df`（本轮增补） | [task.py](https://github.com/frappe/erpnext/blob/19964b09a0045c014bb2f9ab66cd8703eb3722df/erpnext/projects/doctype/task/task.py)、[task.json](https://github.com/frappe/erpnext/blob/19964b09a0045c014bb2f9ab66cd8703eb3722df/erpnext/projects/doctype/task/task.json)、[task.js](https://github.com/frappe/erpnext/blob/19964b09a0045c014bb2f9ab66cd8703eb3722df/erpnext/projects/doctype/task/task.js)、[依赖子表](https://github.com/frappe/erpnext/blob/19964b09a0045c014bb2f9ab66cd8703eb3722df/erpnext/projects/doctype/task_depends_on/task_depends_on.json)及测试源码：持久有向边、递归 CTE 环检测、完成前检查、同项目选择 UI、角色/项目资格 | D 保留轻量同案依赖，复用 Task/WorkResponsibility、真实权限/事务/审计；统一覆盖单条/批量及责任面板完成。不要照搬自动排程、项目树、冗余逗号依赖投影或“取消等于满足前置”。本轮只采用业务设计，未移植或运行源码 |
| E：ANQI `25efcf7f2a3329f9ecdc092b3ced0e17a685c83a` | [deadline-core.js](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/deadline-core.js)、[engine.js](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/engine.js)、[records.js](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/routes/records.js)、[case.js](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/public/js/case.js)、[db.js](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/db.js)与字段日志：确定性计算、人工覆盖保护、依据 UI、新旧日期预览后确认均有实现；规则当前读取，节假日启动清表重载，确认后直接更新 | 不能据局部能力证明不可变规则/日历计算历史、持久待复核差异及所见版本审查。E 整项深化暂缓最低、非门禁；保留既有期限/来源理由/确认调整/提醒。当前日历读取失败空表和宿主日期方法是本项目实际边界，保留入口定点处理，不扩成新期限平台 |
| F：Counsel OS 同上；Frappe CRM 同上 | Counsel [brief-drafting.ts](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/brief-drafting.ts)、[organization.ts](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/organization.ts)、store.ts、[BriefDraftAssist.tsx](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/ui/src/workspace/BriefDraftAssist.tsx)确有有界输入、内部摘要建议、事务版本保存/接受/拒绝/撤销与 UI；Frappe [activities.py](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/crm/api/activities.py)、CommunicationArea 有邮件活动/编辑发送 | 内部 status/summary/questions/nextActions 与邮件通信不能证明客户受众/费用披露、具体 Document 审批及实际交付链。F 暂缓最低、非门禁；人工 Document 简报沿现有审批/交付，MatterBrief 只读聚合保留；内部摘要可作未来有界输入/预览参考 |
| RAGFlow 与本项目实际调用 | RAGFlow `db1cd5929a7885a3074547791f5ecc4d2f891739` 的[摄入服务](https://github.com/infiniflow/ragflow/blob/db1cd5929a7885a3074547791f5ecc4d2f891739/internal/service/document/document_ingest.go)处理文档解析任务；本项目 [ragflow-adapter.ts](../src/server/rag/ragflow-adapter.ts)为 HTTP 适配，目前构造调用位于隔离验证工具；[search/actions.ts](../src/server/search/actions.ts)已有授权 PG 正文检索 | A—F 没有直接导入/调用 RAGFlow，不把知识条目发布与检索引擎混为一个模块。当前沿内置解析＋既有正文检索＋手工选材/锚点，可选模型用原客户端；RAGFlow 完整部署联调继续按需后置、非门禁，不新建另一个替代服务，也不将词法检索声称为语义 RAG |

**复用与暂缓的共同边界：**来源位置、具体版本、当前授权、原审批、历史和实际交付仍是保留业务的要求。已有 FirmFile/模板不被删除或假标为审核知识。暂缓方向只保留编号、阅读依据和恢复时需要重新确认的设计，不预建 schema/框架/测试，不自动移入 M5/M6；更不以轻量名义增加失败 fallback。若以后实际采用上游代码，沿 §5 登记精确文件/许可/修改与验证，本轮仅更新设计。

**执行调整：**W10.2 不再依赖新比较模块；W11 不新建 E 的计算历史/差异表；W12 不等待自动简报；当时 W13.1 移除 W09.3 前置；现按用户 2026-11-17 决定，W13 整体延期，不再作为待接续任务。M3 当前关闭条件改为六条，AC14 保留“暂缓、非门禁”；C/D 保留的实际路径仍需实现后验证。本轮证据仅为源码与文档复审，未完成的实现不得记为通过。

### 3.13 同日界面专项的已完成记录（2026-11-16）

以下同步主线 `5d30e00` 已保存的研究/操作记录，原专项完成情况见计划 §8.10；本次范围修订没有重新执行这些浏览器操作。

参考边界固定为现有 LexOrder `d3b5cb0` 的 `procedure-workflow-panel`、`matter-detail-tabs`、`evidence-panel`、`evidence-timeline`、客户详情和可选服务设置，以及已安装的 `ui/tabs`、`ui/dialog`、`ui/sheet`、`Button/Badge`。沿用 §3.3/§3.7 已研究的 Frappe CRM 按用户任务组织、材料与来源就近回查原则；本批没有重新运行第三方产品，不宣称新增外部研究。

用户任务是从指定案件/程序/环节处理材料、待办或记录，并能回到原位置。现有工作主栏将责任、材料、处理状态、读取检查、记录连续堆叠，同一材料重复出现；这与用户新增的合理分类、通过布局传达逻辑原则不符。本项目设计决定：保留顶层导航与 LawLink 风格，工作区用既有 Tabs 切换三类任务，材料诊断用既有 Sheet 按需打开，不新增一级菜单或重新实现基础组件。

真实浏览器在旧预览 `yP9WcvJo46BbK7BWGwzbG` 复现事实时间线中要点元信息挤在一起，DOM 计算样式显示 `.dos-ev-list` 在 Portal 内为 block/gap normal；来源层关闭后焦点落到 BODY。现有样式限定 `.mo-dossier`，Portal 无此祖先。采用自包含布局和既有 Radix 焦点机制；不改公共弹窗滚动、不复制整套页面 CSS。新候选实际复验已确认列表 flex/gap、长文换行/滚动，以及来源关闭后回到原来源按钮，准确构建及边界见计划 §8.10。

客户与服务设置继续采用同一套 Tabs，按工作任务切换；已访问面板保留页面内状态，避免筛选、分页和输入被卸载销毁。客户搜索框失焦与详情链接同时导航的竞态来自真实浏览器连续操作：输入搜索后直接点客户，旧 returnTo 丢搜索词；修复为详情链接携带当前输入意图，改变条件时页码归一到第一页，失焦到详情链接不另发列表导航。此处是本项目实际操作证据，不套用外部产品结论。MCP 新草稿保留和已有配置 revision 更新分别处理，不将保存等同于连接/发现/查询成功。

读取检查进一步以材料数、文本量、逐件状态与按需展开的位置代替重复标题和长解释；保留原真实覆盖、未处理范围及权限/预算原因。当前预览实测两份材料共 74 字符，混合 PDF 1/2 页及未识别第 2 页仍可见，改选立即清除旧结果。没有修改字符计算、材料顺序或服务权限。重复文案减少不表示省略风险与补救信息。

### 3.14 M3 裁剪后执行优化的本地事实（2026-11-16）

本轮响应用户“优化一轮新计划”。先拉取并核对远端 main `5d30e0052514b71b2725311e300b4d8552d1bb7d` 和现有计划 `work/m3-plan-review` 的 `5a6e61df4a107e9ab78e282de01ab5d1ccc13d73`；从后者建立隔离工作区，只更新原四主文档。以下为本项目源码与方案核对，沿用 §3.12 的固定参考结论，没有新增外部产品研究、运行或法律有效性结论。

| 实际阅读依据 | 确认的事实/设计缺口 | 本轮采用决定 |
| --- | --- | --- |
| 远端 main、现有计划；本地 UI 候选 `b930f61` 的 `dossier-location.ts`/工作区 | main 已合 M2/UI 完成记录，仍为三类 `work`；候选已有四类 `workPane`，尚不能说合入 main | 分列事实；root 只接本切片必要合同，集成后采用单一路由，不以整包专项阻塞独立服务 |
| 计划 §7.11 与架构 §6.8 的研究/稿件关系 | 方案允许研究草稿出稿，但只明确已核对研究修改时生成修订 | 任何被成果引用的研究修订及采用法源元信息固定；后改另存，专业未核实状态不升级 |
| [责任动作](../src/server/reminders/responsibility.ts)、[任务动作](../src/server/tasks/actions.ts) | CANCEL 把责任设为 CANCELLED，但同样把 Task.completed 设 true；批量入口可提前把 completed 当成功；旧直接写入支路尚在 | D 前置满足和办结重放只认 DONE，并先核资格；取消/重开/解除有明确语义，W11 触达入口一次接统一合同，不扩大清理 |
| [现有审批事务](../src/lib/approvals/service.ts) | approvalTransaction 已有 Serializable 和事务锁，责任动作已使用 | D 关系/环及完成状态在该事务内检查提交，不新增锁平台；只验新并发风险 |
| 当前工作区的 buildActionItems/onAddTask；候选 `b930f61` 同名组件 | 列表沿程序/环节收集 stage.tasks，新增入口依赖选定程序/环节；单改表单无法使事项级任务可找回 | W11 同切片接创建、全案读取、责任板和保存后定位，零程序路径实际验收 |
| [客户历史服务](../src/server/clients/history-service.ts)、候选位置合同及 §8.10 旧定位边界 | 旧上下文/Note 主要回到事项区域，不能证明 M3 新对象已具备精确回链 | 只给新增研究/修订、Document/问题、清单/回复接真实身份；新交付动态回到原对象，不先修所有旧历史 |
| [文书读取资格](../src/lib/approvals/documents.ts)及架构 §6.8 | 现有具体待审批文书有独立附件授权；普通派生来源全检的绝对措辞会与其冲突 | 保留明确绑定的审批正文授权；原研究/片段/费用/历史/交付另核，不以普通下载权豁免来源；目标/来源撤回仍阻断，C09 不解禁 |
| 计划 §3.5/§7.11.4/§7.11.6 的 W12 前置和 owner | 人工简报/固定交付依赖具体 Document 与原审批/披露，不需要整个 W11；原 C 同时持有任务/交付而产生串行等待 | C 独占交付，可先用既有文书；A 研究结束后转任务并行，B 文书；收尾仅汇合既定场景与证据 |

这些是当时计划审查的边界和实施决定，不增加 W09.3 或 B/E/F、C 通用机制，不预建平台/投影。审查记录见[计划 §7.11.11](WORKBENCH_PLAN.md#71111-裁剪后的一轮执行优化2026-11-16)。当时未执行 M3 代码、数据库、浏览器或专业验收；后续合并及证据见计划 §8.19，不能把当时状态当作当前状态。

### 3.15 案件状态与核心界面的多项目审查（2026-11-16）

用户希望一个案件有一个整体状态，全案总览与多个程序及其材料/环节分明；文档连续修改只是痛点举例，本轮先研究案件状态和核心界面。实际只读了下列固定源码及官方文档，未运行第三方产品；浏览器事实与计划见[计划 §8.13](WORKBENCH_PLAN.md#813-案件状态与核心界面审查2026-11-16)。

| 参考与实际依据 | 可取的核心模型或交互 | 对本项目的边界 |
| --- | --- | --- |
| Kosmos `c6454fd`：[案件总览](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/templates/matters/overview/main.html)、[程序](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/matters/proceedings/models.py)、[材料程序归属](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/templates/case/documents/proceeding-display.html) | 全案概览、一案多程序、材料按真实程序归属及筛选，与用户目标最接近 | 已读程序模型和界面未见中国审级类型、前序关联或通用环节；各程序可分别记录状态，不证明具体审级合法并行。其案件首次进入 Complete/Closed 时批量终结非 Dismissed 程序，程序编辑/删除亦未见同时限定 URL 案件和目标程序，不能照搬状态和授权；材料处理的部分路径覆盖原件。 |
| ANQI `25efcf7`：[案件页](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/public/case.html)、[阶段操作](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/public/js/case.js#L1694-L1711) | 阶段线、清晰的阶段切换和事件/期限提示 | 只有案件行上的一套程序/阶段，点击节点并确认后修改案件阶段；附件没有程序或环节外键，不适合直接替换本案多程序模型。 |
| j-lawyer `f523d14`：[案件摘要](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-client/src/main/java/com/jdimension/jlawyer/client/editors/files/CaseSummaryPanel.java)、[专用状态事件](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-server-entities/src/main/java/com/jdimension/jlawyer/persistence/DunningCaseEvent.java) | 全案概要、未结事项和对特定程序状态变更留历史 | 通用案件模型不等于本项目多程序环节；德国催告程序规则不能作为中国诉讼规则。 |
| 商业产品官方说明：[Clio 案件状态](https://help.clio.com/hc/en-us/articles/9286056633115-Change-Matter-Statuses)、[Clio 阶段](https://help.clio.com/hc/en-us/articles/15083241879195-Create-and-Manage-Matter-Stages)、[Filevine 阶段](https://support.filevine.com/hc/en-us/articles/360004140772-Phases) | 案件状态和可配置办理阶段清晰显示，阶段变更可回查或触发工作 | 官方说明是产品行为而非其数据库实现；不能把销售式单阶段、自动重建任务或自动迁移旧阶段当作法律事实。 |

LexOrder 已有 `Matter → MatterProcedure → MatterStage` 与 `Document.procedureId/stageId`，有基础可用，缺口主要在程序状态操作、真实环节状态、跨程序总览、归属一致性和用户可见的错误出口。历史 Note 没有程序/环节外键，期限/开庭只有程序外键；不能声称这些对象已精确绑定环节。Kosmos、ANQI 和 j-lawyer 均为 AGPL 项目；直接复制或翻译实质代码需核对许可与分发/网络使用义务，不能无条件作为 MIT 代码粘贴。当前结论是按业务行为设计并保护既有身份、原件、授权和审批历史，尚未移植其源码或更换数据库模型。

### 3.16 W11 任务推进与期限正确性实施依据（2026-11-16）

本次从远端 main `0fc5da17337629c3673214c662fbba0382edc438` 建独立实现分支，接收已优化计划 `79b4346`。跨会话已发现研究/起草/交付在另一组独立工作区实施；本组只承接 W11 与其必要入口、日历缺陷，不写对方工作区。未取得跨会话回执，不能据本记录声称对方确认了分工。

| 用户任务与实际阅读 | 采用及不采用理由 | 合理性与验收 |
| --- | --- | --- |
| ERPNext 固定 `19964b09a0045c014bb2f9ab66cd8703eb3722df`：`task.py` 状态与递归依赖检查、`task.js` 同项目/排除自身选择、Task/Task Depends On 的表单字段 | 采用同事项选择、服务端环检查和办结守卫；复用本项目已有 Serializable 事务。不上 NSM 项目树、自动排程或重复依赖投影；不采用上游取消也可满足前置的语义 | 用户在同一 Task 的前置区选任务；只有 DONE 满足，取消保留阻塞。真实 PG 验跨案、自环、递归环、取消/重开及并发；并未运行 ERPNext 产品 |
| ANQI 固定 `25efcf7f2a3329f9ecdc092b3ced0e17a685c83a`：已缓存 `deadline-core.js`/`engine.js` 及连接器取得的 `public/js/case.js` | 采用日期键与 UTC 算术、配置状态与建议值分开；保留人工日期。源码确认现有 15/30 日读取差异和异常吞没后定点修复，不采用条件重推导、版本化重算或计算历史平台 | 无配置明确未核对，故障不写入规则期限；人工期限仍可录入。三时区定点测试及上海同日存取真实 PG；未宣称参考项目已跑通或日历年度已完整 |
| 本地 UI 候选 `2be3781`（核心位置合同来自 `b930f61`）、当前工作区与 Next 16.4.6 已安装官方文档 | 只接本次消费的四区 `workPane` 与原生 history 更新合同，扩展真实 Task ID；当前框架原生 history 与 useSearchParams 联动，refresh 保留客户端状态，因此保全创建须明确触发同一任务列表重读 | 无程序可创建/找回，失败保稿与同案历史有局部离开确认；失效目标不切到其他对象。未合入候选整包材料、审核、财务及路由改造，未开展全站 UI 重审 |

外部等待的“一个有效等待”、取消如何结束等待、重开不复活及 revision 冲突后显式核对，是本项目针对律师任务责任的设计判断；由任务/等待/Deadline 分离的实际服务和场景验证，不声称直接来自参考项目。新增 SQL 只服务 Task 子关系，没有恢复 W09.3 或 B/E/F、C 通用机制。执行和未验收范围见计划 §8.16。

### 3.17 远端修复后的案件模型判断（2026-11-16）

仍以 §3.15 的固定源码与官方资料为依据；本次检查 LexOrder 已合入的界面收尾及 W11 任务实现，并审查尚未安全合入的 `work/case-repair-core`。Kosmos 的全案、程序与材料归属仍最贴近用户描述，但其源码为 AGPL；借鉴可见业务行为与对象关系，不声称已经复制其整个模型或实现。用户举出的文档连续编辑只是痛点例子，本轮未实现在线编辑。

一个 Matter 应有唯一的整体生命周期状态；不同程序可以并存，各自有办理状态和真实环节。当前 Matter 已有整体状态，MatterProcedure 已有程序状态，Task 可属于事项或真实 MatterStage，Document 也有程序/环节外键；W11 增加等待、前置关系和事项级任务，因此此前“任务只能按环节展示”的判断需要更新。但 MatterStage 的 ACTIVE/HIDDEN 只是可见性，不能当法律阶段状态；界面仍从名称、程序日期、任务及期限推测当前环节，不能当权威办理进度。Note 只有名称标签，没有程序/环节外键；Deadline/Hearing 没有环节外键。阶段完成、变更历史、跨程序总览及真实归属仍需统一设计，不能把未关联历史记录按名称猜回填。

本次收紧了环节材料的显示：只用真实 stageId 归属，未归属材料仍可在其他材料中查看；为现有真实环节恢复任务创建，虚拟预设须先显式启用。保存上传草稿后切换目标须保留原目标并阻止误传；空程序、环节删除在事务中核对关联及上传意图。已预留上传可在环节隐藏后按原意图完成，历史材料和任务不因隐藏被改写。旧任务如缺责任记录只读列出已知事实并提示核实，尚无完整人工修复或责任提醒闭环。

建议下一批围绕实际业务链重构，而非复制某个项目数据库：Matter 整体状态与受权的生命周期操作；各程序真实状态与明确推进；程序内可核对、可回看的环节状态与变更记录；材料、任务、记录和期限分别以真实外键或明确的未归属范围呈现；全案总览聚合所有受权程序、事项级内容及未归属项。保全是当前模型的全案对象，不能假定属于每个程序。分别审查并行程序、法定期限、角色、历史数据和迁移，必要时在受影响范围内结构性重构。详细合并事实和未解决问题见[计划 §8.17](WORKBENCH_PLAN.md#817-远端汇合后的案件状态和工作区复评2026-11-16)。

### 3.18 新到 M3 代码对判断的影响（2026-11-16）

这是合并前的历史评估：当时 `work/m3-implementation-20261116` 提供研究、人工复核和固定版本交付，但等待/任务结构与当时主线冲突。后续已按当前模型整合，现行代码和证据见[计划 §8.19](WORKBENCH_PLAN.md#819-m3-保留范围的实现与验证2026-11-16)；当时冲突见[历史记录](WORKBENCH_PLAN.md#818-新到-m3-分支与更新后的-prisma-分支2026-11-16)，不能再说这些功能仍仅在独立分支。

### 3.19 M3 实施切片的实际阅读与采用（2026-11-16）

本轮响应“开始执行 m3 阶段”，从 main `0fc5da1` 开工并合入后续 `80f16db`。三名实现者在编码前按模块复读 §3.12 的固定源码，root 负责共享资格、现行框架和跨模块整合；未运行参考产品，也未直接复制其业务源码。已有许可与来源记录保留。

| 用户任务与实际阅读 | 采用的交互/业务行为 | LexOrder 的限定与验证落点 |
| --- | --- | --- |
| 研究/引用：Counsel OS `c4f40f1` 的 Editor、CitationPicker、workspace/store 的 work 保存与引用 | 将实际来源和确切成果保存在同一工作任务，隔离迟到读取，打开原文后回原修订 | 本项目独立设计不可变 ResearchRevision、法源时点/核实状态、支持/反向/未读范围；不将参考项目当成已完成法律研究服务。研究 PG 与工作区组件检验保存、重试、撤权、来源和重开 |
| 模板/核对：j-lawyer `f523d14` 的 AddDocumentFromTemplateDialog 实际字段/现值/空值入口；docassemble `36d7bd4` 的 review-conditional 与 DOCX 示例 | 选择确切模板和对象，显示实际字段，补缺后由人核对再生成 | 不迁移 Java/Swing/Groovy 或 Python/YAML 访谈运行时；模板预览删除主档写副作用，临时值进入 Document 快照；变更对象清除失效值 |
| 人工复核：Counsel 的具体成果/引用和本项目原审批/文书实际服务 | 问题与具体文书、真实来源及后续修订保持关系 | 问题→回应→修订→合格复核是本项目设计，不声称参考已有相同闭环；具体审批正文的 READ 与原来源/EXPORT/SUBMIT 分开验证 |
| 等待/依赖：ERPNext `19964b09` 的 task.py validate_status、task.js 依赖选择和同项目约束 | 同案候选、成环拒绝、完成前检查 | 不采用取消满足前置、自动排程、项目树或冗余依赖投影；复用现有 Task/WorkResponsibility 及授权事务。真实 PG 覆盖增删边与三类完成入口并发及岗位撤权 |
| 人工简报/交付：Counsel `c4f40f1` 的 BriefDraftAssist、briefDrafting | 人工编辑、明确未决事项、失败保稿、具体草稿可重开 | 不移植自动简报；固定清单、发送/收悉/回复与客户历史是本项目设计，复用 Document、Client 与归档快照。没有真实外发，导出不写发送 |

root 同时核对现有 Next 16.4.6 本地文档、React/Prisma 类型与项目已有组件；不新增状态框架或业务副本。构建发现两处旧页面的同步 searchParams 签名，按安装版本的 page 约定改为 Promise + await。首次浏览器预览到登录页，登录后界面与真实律师专业判断尚无证据，准确状态统一见[计划 §8.19](WORKBENCH_PLAN.md#819-m3-保留范围的实现与验证2026-11-16)。

定点复审实际关闭来源授权递归、原稿响应丢失、法源重核、交付凭据正文、重复准备、未存复核输入、审批错对象与重进、完整包释放前撤权等具体问题；不以复审轮数代替结果。另确认空 familyId 仍可能由现行其他材料写入口产生，新详情/复核采用明确不可用状态而不推断版本族，统一写入问题留在原 C05/RP05 范围。

本轮没有恢复 W09.3、B/E/F 深化、C 通用访谈、Personal/Windows 或窄屏；没有把可选 AI/OCR/RAGFlow/MCP 配置变为门禁，未宣称这些外部服务已经接通。

### 当前项目状态对计划的影响

- Server M2 在原七条条件下完成业务预览，详见计划 §8.9；W08 的本地 `NOT_SENT` 输入范围检查不代表模型调用。M3 保留业务已合入，登录后的业务及专业验收尚未关闭，实际修复及 API/静态证据见计划 §8.21—8.22；M4 和全部非业务维护现已延期，不作为业务门禁。
- 前批初始评估为 `97867e2`，随后对齐 main `2997b54754565081271ca4b66139949d310e2fe0`；M1 当时从 `b313adf8` 接续，本轮 Server M2 从 `f973b87` 开始。appleoppa 的通用功能、迁移、权限与调度适配已合入；本轮保留其源码及来源记录。本轮已将内置解析、覆盖与恢复接入事项上传管线，具体证据见计划 §8.4；局部传票解析和启动补扫仍不等于通用 OCR、完整休眠或整套数据恢复已完成。
- Kosmos 默认源码分支为 `dev`。其[当前 AI 开发文档](https://kosmos.law/docs/dev/subsystems/ai/context/)说明，原生案件聊天引擎于 2026-10-29 退役，界面于次日退役，改由远程 MCP 对外提供案件访问。旧 README 或历史设计不能作为“完整聊天可直接迁入”的证明。
- Kosmos 的事实与高亮关系仍可参考。其某些材料处理路径会替换存储文件，本项目的设计要求保留原件，不能直接采用该行为。
- Counsel OS 官方仓库明确说明扫描 PDF OCR、全面原始法律研究等尚未完成；源代码运行路线仍需开发和测试验证。引用与文书模块只能作为审查候选，不能承诺复制即用。
- 早先的 Personal 内置/Server 必需 RAGFlow 已被用户最后纠正覆盖：当前只交付 Server，内置处理先接业务，RAGFlow/AI/OCR/法律 MCP 等均可选。RAGFlow 适配/固定准备代码已有，但仍为 `PREPARED_NOT_DEPLOYED`，无真实部署或模型证据；缺配置不阻塞业务。
- RAGFlow 1.0 检索的知识汇总默认开启；文档筛选不证明数据集汇总的全部来源获准。因此 Server 首发**明确设置** `include_knowledge_compilation: false`，由 LexOrder 先确定授权材料、再核对返回片段。官方普通 retrieval API 的 `use_kg: true` 不代表启用多跳图检索；共享 Team 规则也不能替代案件权限。实现边界及验收见[架构第 3 节](REFACTOR_DESKTOP_TEAM_RAG.md#3-rag-架构内置优先服务可选)。
- RAGFlow 配套部署、运维及预备工程全部延期，现有适配/准备代码保留但不代表接通；实际明确启用的业务仍按来源、权限及版本边界处理，缺配置不阻塞普通业务。
- AnythingLLM 的默认内置检索、Cherry 的本地模型证明可以把组件交给应用管理，不证明 LexOrder 已完成集成或达到相同效果。中文法律材料仍需独立验收。
- 技术官方来源与本轮隔离存储试验统一见[架构依据](REFACTOR_DESKTOP_TEAM_RAG.md#10-官方资料与代码依据)及第 2 节。Server 保留现有 PG；Personal 的精简 Next/Node + PGlite 方案现已搁置；固定版本的兼容证据不等于正式发行完成。性能/容量专项和预备测量全部延期、非门禁，原资源阈值已撤销。

### 3.20 分支整合后的模型判断（2026-11-16）

以 §3.15 的已读源码和商业产品官方说明为依据：Kosmos 的全案概览、一案多程序、材料归属仍最贴近用户目标；ANQI 可参考阶段线，Clio/Filevine 可参考状态展示。它们各自只覆盖目标的一部分，采用可见业务行为并独立实现。M3 的研究、复核和交付，以及案件修复分支的有效改进已与主线统一，任务仍是同一套模型。当前 `Matter.status` 为全案总体状态，`serviceStatus` 另记服务完成；各程序可分别办理，`MatterStage.status` 的 ACTIVE/HIDDEN 仍只是可见性，当前办理环节尚无权威确认。材料和任务有真实环节关联，记录、期限及开庭尚不能都按环节可靠归类。本批已按实际状态动作和现存外键实现全案、程序及环节的范围修复，保留开工前判断与采用边界；具体代码和本次验证见[计划 §8.21](WORKBENCH_PLAN.md#821-当前主线的-m3-接续执行2026-11-16)。

**审级先后和并行事项的核对。** [民事诉讼法（2023年修正）](https://ipc.court.gov.cn/zh-cn/news/view-6231.html)第 171—174 条以一审判决或裁定后的上诉及原审法院报送为二审相关程序；第 156—158 条也规定部分先行判决和管辖权异议等裁定上诉。因此，对同一实体裁判的通常一审、二审不应画成两条同时审理的平行主线，但也不能简单设定“整个一审绝对结束后才允许任何二审记录”。诉讼中财产保全可与诉讼工作并存，见[最高法财产保全规定](https://www.court.gov.cn/zixun/xiangqing/30101.html)。上诉准备、法院立案、一审已作裁判及裁判是否生效分别是不同事实；具体裁判和例外的状态须依据案件记录及律师确认，不能由程序名称自动推断。

**用户质疑程序前序关系后的修正。** 已核查的 [Kosmos 程序模型](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/matters/proceedings/models.py#L8-L43)没有前序字段；[ANQI 阶段模板](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/rules/stage_templates.json#L1-L10)使用顺序数组，并非多程序实体的依赖关系。法律事件有先后，不意味着产品必须维护一张程序依赖表。现有程序可记录类型、案号、状态及日期，`order` 仅为创建时追加的展示顺序，不能据此认定法律先后。当前没有实际场景证明需要前序字段或强制前序规则，撤回此前将其作为模型缺口或设计前置的判断；优先解决真实状态、材料与任务范围。此结论只针对已核查的参考，不概括所有开源产品。

**两份 GPT 报告的事实核对与采用范围（2026-11-16）。** 原报告提出的“事实 → 证据 → 争点 → 法律依据 → 决策 → 行动 → 交付”可以作为可选的业务关系视角；审查版提醒复用当前模型。现有代码已有一行一版本的 `Document`、`EvidenceItem` 的性质/修订/支持和反驳来源、`ResearchRevision` 及 `MatterContextRecord` 的方案/决定；这不等于各对象已形成完整的结构化关系或通过真实律师验收。`ResearchSource.lawMetadata` 可记录取得日期/途径、机关、法域和效力期间等，查询记录分别记录取得范围和阅读结果；这些人工记录不证明模型本次实际读过相应原文，也不自动证明法律效力。

审查版提出让“等待客户材料”不被普通待办淹没：`TaskWaiting` 已记录等待对象、成果、下次检查及结束结果，任务列表和详情已有展示与操作；本批源码核查确认原有检查日未接扫描器，现已补入站内到期提醒和列表待检查入口；同时排除既有邮件摘要出口，具体本次验证见计划 §8.21。优先补强现有任务入口与[W11.1](WORKBENCH_PLAN.md#7115-各工作项的最小业务合同)，不另造一套等待或任务模型。

本轮重新核对固定源码：Kosmos 的 [Fact 模型](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/models.py#L319-L346)可以分别关联多个 Document 和 Highlight，模型日期可空，[普通表单](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/facts/forms.py#L17-L30)要求日期；其[案件内 AI chat 已退役](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/docs/decisions/2026-10-30-ai-chat-retired.md)。ANQI 的[快速解析](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/routes/records.js#L736-L773)不直接产出期限，但其受信任的[agent 直写入口](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/routes/internal.js#L81-L104)可以创建待人工复核期限，不能概括为“所有 AI 入口都不能创建期限”。这些是第三方实现事实，不改变 LexOrder 的现行人工确认规则。原报告与审查版的引用标记未随附件展开；只将已重新核实的资料及实际源码用于本计划。[上海律协商事诉讼业务操作指引（2019）](https://www.lawyers.org.cn/info/453c50f6b8374371ae6e5331a9e2c301)中整理证据来源、支持/不利材料和事件时间线的建议支持相关工作场景，但不证明本产品的具体效率或律师使用频率。

审查版还认为仅从 schema 看不到审计删除保护；实际迁移 [`20260921000005_restore_db_guards`](../prisma/migrations/20260921000005_restore_db_guards/migration.sql) 定义了阻止 `AuditLog` 删除的触发器。仓库中的迁移定义不证明每个实际部署都已应用，也不能单独证明日志不可更新或绝对不可篡改。两份报告均未提供本次 LexOrder 真实浏览器及律师验收证据，不用其百分比或“二分钟”指标当成已验证结果。

### 3.21 M3 接续的实际合同与交叉审查

本批复用 §3.15、§3.20 已固定的参考资料，不把旧资料的阅读范围扩大为本次已经运行参考产品，也未复制 AGPL 项目的实质源码。实现判断以本仓库 `df48eef` 起点和实际 EvidenceItem/研究、程序状态、任务提醒调用链为依据；浏览器实际操作、数据库/组件测试和律师专业判断分别登记在计划 §8.21。

| 实际问题与依据 | 本批采用及理由 | 未采用与证明边界 |
| --- | --- | --- |
| 正常创建 ISSUE 只有当前 EvidenceItem，修改才保存旧 EvidenceItemRevision；确认不会递增 revision。研究先前只接受已存在的当前 revision，正常入口因此失配 | 不改变证据历史含义，改在真正保存研究时固定当时输入；CURRENT 同时核 revision/confirmedAt，历史选择只读真实历史，SAVED 明确保留原研究输入；来源查看、派生授权及新归档同步消费 | 不在普通读取补造当前修订，不以后来的核对状态倒填旧研究，不按最新来源替换已采用版本；数据迁移只复制旧研究实际绑定的修订 |
| 当前环节/司法进度由任务、名称和日期推断；Note 无环节外键、Deadline/Hearing 仅到程序，保全只有事项关联 | 全案保留整体状态，程序通过显式动作记录；界面只显示真实外键范围与已有进度日期，未归属独立可达；保全复用自身授权服务。新增信息程序待核对，状态变更核所见版本与现有业务守卫 | 不增加程序依赖表/前序门禁，不按类型和展示顺序断言法律先后，不自动回填归属或实际结案；仅有代码不等于真实律师认可所有场景 |
| TaskWaiting 已有 nextCheckAt，但原扫描器没有消费；仅写站内 Notification 仍可能被现有 email-digest 汇总外发 | 在现有扫描中新增到期等待检查，锁后重读当前责任/资格和时点、每天按实际检查意图去重；任务列表显示待检查，邮件摘要明确排除 TaskWaiting | 不建第二套任务/提醒身份，不暂停或重算法定期限，不把等待结束等同于收到答复或任务完成；不外发合成验收资料 |

交叉审核纠正了归档读取的 matterId 缺项、SQL CHECK 的 NULL 逻辑、已终结日期可被直接清空、进度入口权限不一致和邮件摘要出口。采用理由是这些位置处在本批真实调用链，而非为假设风险增加通用框架。本次只新增保存研究输入所需 JSON 字段与 SQL 约束，其余继续复用原业务对象、权限/事务/审计、组件和依赖。

M3 原六项业务关闭条件与律师专业验收保留；M4 已整体延期，原恢复要求只作保留设计，不进入当前业务验收；研究/程序/提醒修复不证明整条业务链或法律适用已验收。知识发布、结构化方案比较、复杂期限重算、自动客户简报、通用访谈及 Personal/Windows 继续暂缓。用户提到连续修改文档只是痛点示例，本批没有扩建在线编辑或同步系统。

### 3.22 API、人工决定与恢复准备的实际依据（2026-11-17）

用户将浏览器验收留给本人后，本批基于 `eaf9e19` 的真实调用链完成 API、隔离数据库与静态接续，沿用 §3.15、§3.20 的参考边界，没有重新研究或移植另一套工作流。以下采用决定来自本项目源码、已安装 Next 的实际实现和合成隔离复现；结果见计划 §8.22，不能扩成律师或浏览器验收。

| 实际证据 | 采用与原因 | 未扩展的边界 |
| --- | --- | --- |
| [matter-review](../src/server/conflicts/matter-review.ts) 原来把普通零命中检索自动写成 DIFFERENT/决定人/决定时间；真实收案批准另有显式继承审计 | 普通检索待人工判断；复用同一检查、匹配决定人的明确审计辨别人工/正式继承。读取及准入共用新增命中检查，旧决定不回填；以现有 decidedAt 拒绝旧页面覆盖 | 不用 note 文案猜历史，不新增冲突身份/前序程序模型；合成判断不冒充律师判断 |
| [期限动作](../src/server/deadlines/confirm.ts) 原来只使用请求到达后读取的 updatedAt，事务外资格无法处理等待期间的归档/撤权 | 现行入口提交所见版本，复用授权/事项/期限锁，ReadCommitted 锁后复读原日期和当前资格再保存与审计 | 不开发暂缓的 E 重算平台，不重新实现已有模板；只为模板补解密后实际 DOCX 输出断言 |
| 下载/预览原来在文件处理前核权，处理完成后直接返回；现有交付已有发布前复核模式 | [read-release](../src/server/documents/read-release.ts) 在处理后复核真实会话及当前来源，成功审计同事务。交叉审核将事务内会话读取改为事务外版本基线→真实会话→锁内版本比对，消除单连接池自等 | 保留具体审批附件资格，不另造认证上下文、缓存身份或通用授权框架，不重复读取/hash 原件 |
| 真实 HTTP 观察到合法 127.0.0.1 Origin 被拒。安装的 Next 16.4.6 `server/web/next-url.js` 及 `spec-extension/request.js` 会将 loopback request.url 规范成 localhost；下载 200 响应实际无 Cache-Control | 交付以已规定的受信 NEXTAUTH_URL origin 精确比较；不同 loopback origin 仍拒绝。下载显式 private/no-store，真实 HTTP 断言验证 | 不改 Next 全局规范化，不信任请求 Host/转发头，不用换测试域名或删除保护制造通过 |
| 原 backup/restore 的变量、缺件、加密及目标目录缺陷已用真实文件/OpenSSL、明确 PG 命令替身复现 | 复用现有 env 加载与已安装 tar-stream，收敛为单一 local 格式；完整预检、私有暂存固定输入、空目标恢复、数据库单事务与文件发布分开 | 不自动转换旧备份、不支持或假称覆盖 S3；不以命令替身、包校验或宿主结果宣称真实 PG 恢复/容器发行 |

并行审查还纠正了冲突动作等待授权锁时的 Serializable 旧快照、旧决定覆盖、恢复等待确认期间源包替换，以及旧验证脚本未同步参数的问题。取舍依据是当前真实链上的确定问题；本批没有 schema 或历史迁移改动，没有恢复搁置业务。浏览器由用户后续验收，律师专业复核及 M3 原六项业务汇合仍待证据；M4 和全部非业务维护已延期。上述恢复脚本修改为延期前完成的历史工作，不授权继续准备、开发或验收。

### 3.23 只推进业务，维护全面延期的范围决定（2026-11-17）

用户明确要求 M4 全部延期，并进一步指示：“只要是涉及到这种维护，不是业务的需求全部推迟并不作门禁，只实现业务”。采用决定是：

- 将 M4/W13/AC15、发行打包、安装部署完善、旧实例升级、备份/整套恢复、运维、性能容量和通用基础设施专项，连同预研、环境准备、独立测试/验收全部移出当前任务与门禁；不分配当前 owner，不设置自动恢复条件，未来须用户明确重启。
- 保留直接业务需要的权限、审批、来源版本、事务、审计、幂等、材料提交失败处理、真实交付和案件归档。业务必要的数据库结构变更不因维护延期而禁止，仍按具体影响核验。
- 当前业务沿用现有运行环境和实现，不为架构完整性补通用框架或复做已实现模块；API/静态、浏览器和律师专业验收分别记账，浏览器由用户统一处理。
- 三 agent 交叉核对发现旧文档在阶段顺序、RQ15/RQ19、W01/W02/W13/W16、AC15、发行清单及运行说明中还保留维护前置；本次在 AGENTS 和四份主文档同步纠正。已有代码、历史测试和未验证事实保留，不把延期写为完成。

随后按用户要求，固定 `89d32453cfcaab380e62220c7d25aa88637fd878` 核对案件/客户、研究来源、模板/复核、任务/期限及交付/归档的实际入口和保存链，并交叉核对材料版本族、Note 编辑、研究锚点、客户指示采用与动态定位缺口。目标/指示的直接关系属于架构 §6.8 保留的窄业务承诺，不等于已暂缓的 B 完整自动变化分析。结果统一记入[计划 §8.24](WORKBENCH_PLAN.md#824-维护延期后的业务余项核对2026-11-17)，区分部分完成、可选未贯通、已有待验收及明确暂缓；不另立维护任务或平行清单。本次未修改业务代码、重跑测试或做浏览器/律师专业验收。

### 3.24 业务与参考项目静态对照审查（2026-11-17）

#### 审查结论、基线和边界

**结论：LexOrder 已有可用的业务对象和较完整的法律业务守卫；与参考项目的主要差距，集中在日常操作的连续性、现有能力是否真正进入界面，以及少数入口的规则不一致。不能用“缺模块”概括，更不宜再建一套客户、任务、材料、事实或审阅系统。** 本轮同时发现了会使法院来件确认整批回滚、将未创建事项显示为已采纳、绕过当前承接复核等确定或触发条件明确的问题，应先于新增平台处理。

- **代码基线：** [LexOrder `89d32453cfcaab380e62220c7d25aa88637fd878`](https://github.com/zaenzhang/LexOrder/tree/89d32453cfcaab380e62220c7d25aa88637fd878)。开始审查时已获取远端，工作树干净，HEAD 与 `origin/main` 相同。收尾获取并合入了后续[纯文档提交 `a887859`](https://github.com/zaenzhang/LexOrder/commit/a887859339811797875361a043f4f53d69d7f325)，核对确认它未改业务源码、schema 或迁移；保留其维护延期决定及业务余项记录，再补入本次对照。下文源文件行号仍指 `89d3245`，不把本次文档提交算成被审查业务版本。
- **方法：** 主审与三个只读分工分别检查客户/工作推进、材料/文书/复核/交付、事实/研究/检索/AI；主审另查财务、归档、来件和当前迁移，并交叉核对高优先级问题。沿“数据结构→服务→真实调用入口→UI→失败/继续路径”判断；读取已有测试以辨别覆盖盲区。
- **证据性质：** 本轮没有运行应用、浏览器、数据库、测试或第三方项目，没有修改业务代码。SQL 列错配等由当前 schema、迁移及事务链静态确认；时区等条件性问题明确列出触发条件。不是全仓安全审计、运行验收、法律规则适用性结论或上游质量排名。
- **范围：** 只评价当前 Server 业务。按用户现行决定，维护/升级/恢复、Personal/Windows、知识发布、B 结构化方案比较、E 期限版本化重算深化、F 自动客户简报、通用访谈继续暂缓，不因本报告恢复为交付门禁。AI/OCR/RAGFlow/MCP 按需配置；未配置不算核心业务失败。前文各批次有关 M4/恢复的记录保留其历史时点，不能覆盖这次范围边界。
- **优先级含义：** P1＝已保留业务中的办理阻断、错误成功或关键规则绕过；P2＝已存在流程的定位、接续、覆盖范围或效率问题；“候选”＝需按真实业务价值选择的增强。以下是审查建议，未自动修改实施排期、指定 owner 或增加验收门禁。

#### 本轮实际阅读的参考模块

参考均使用项目此前登记的固定提交重新读取相关源码，不声称是 2026-11-17 的各项目最新版。仅从本轮确实读到的实现提取行为；没有以 README 功能清单替代实现证据。

| 参考项目 / 固定提交 | 本轮实际源码与调用范围 | 对照价值与采用边界 |
| --- | --- | --- |
| LawLink `4736aa100515bb15f47443cdb6b0ae65745e5fff` | [schema](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/prisma/schema.prisma)、[来件确认](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/sms/confirm-actions.ts)、[财务登记](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/finance/ledger-registration.ts)、账务更正、冲突复核、审批资格、用章、归档查询与导出 | 法律业务基线已大量继承；继承也会保留缺陷。下述来件两项、已签署登记绕过及归档列表上限不能归为“上游已做好而我们没移植” |
| Frappe CRM `3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952` | [活动聚合](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/crm/api/activities.py)、[活动 UI](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/frontend/src/components/Activities/Activities.vue)、[全局任务](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/frontend/src/pages/Tasks.vue)、TaskArea、CRM Task 字段、视图筛选、Lead 转化 | 客户关联行动可进入全局待办；沟通原件与历史筛选。复用 ClientActivity/ClientFollowUp，不迁入另一套 CRM 或销售对象 |
| ERPNext `19964b09a0045c014bb2f9ab66cd8703eb3722df` | [Task 服务](https://github.com/frappe/erpnext/blob/19964b09a0045c014bb2f9ab66cd8703eb3722df/erpnext/projects/doctype/task/task.py)、同目录 task.js：依赖、环检测、完成检查、日期安排 | 本项目轻量同案依赖已落地；保留“前置取消不等于完成”，不复制其完整排程系统 |
| j-lawyer `f523d141327e5c74269dd9c71b54ae1c05a415a3` | [打开文档](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-client/src/main/java/com/jdimension/jlawyer/client/utils/CaseUtils.java#L843)、[变更监测](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-client/src/main/java/com/jdimension/jlawyer/client/launcher/DocumentObserver.java#L779)、[保存回传](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-client/src/main/java/com/jdimension/jlawyer/client/launcher/CaseDocumentStore.java#L709)、ObservedDocument、DocumentMonitorEntry、模板字段 UI；[无待办案件查询](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-server/j-lawyer-server-ejb/src/main/java/com/jdimension/jlawyer/services/ArchiveFileService.java#L4167)及客户端调用 | 连续编辑是打开、变化、回传、状态可见的完整任务；无下一步案件可主动找出。保留 LexOrder 不可变版本，不照搬覆盖原件行为 |
| Paperless-ngx `4610171a94e5932e85a80e480032e397cdb6f309` | [多文件上传服务](https://github.com/paperless-ngx/paperless-ngx/blob/4610171a94e5932e85a80e480032e397cdb6f309/src-ui/src/app/services/upload-documents.service.ts#L21)、[逐件状态托盘](https://github.com/paperless-ngx/paperless-ngx/blob/4610171a94e5932e85a80e480032e397cdb6f309/src-ui/src/app/components/common/upload-status-tray/upload-status-tray.component.html#L21)、consumer 摄入及重复件处理 | 多选、逐件结果、失败接续、成功打开目标；不复制其删除重复来件的处理到法律来源链 |
| Kosmos `c6454fd5488c0d231e2b4756846f690c679586ca` | [Highlight 模型](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/models.py#L248)、[事实来源查询/绑定](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/facts/views.py#L505)、[事实行原文入口](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/templates/case/facts/fact-row.html#L19)及访问控制 | 事实与原文具体位置就近操作；不另建事实库，不从源码推定阅读器实测效果 |
| ANQI `25efcf7f2a3329f9ecdc092b3ced0e17a685c83a` | [候选身份](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/candidate-facts.js#L19)、[重跑继承决定](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/legalrag-bridge.js#L358)、[接受/忽略/恢复](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/routes/legalrag.js#L236)、[真实 UI 调用](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/public/js/case.js#L2158) | 程序事件/收费候选按逻辑身份处理，复用已有对象与保留多来源；不是任意自然语言事实自动同一认定 |
| Counsel OS `c4f40f1ffd40146531bcaa7f43e6877a733f92ca` | [真实工具入口](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/chat-tools.ts#L317)、context-preparation、[精确引用](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/citation-location.ts#L3)、DocumentReader、[固定版本比较](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/document-rounds.ts#L9)、docx/rounds、[比较 UI](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/ui/src/workspace/DocumentRound.tsx#L8) | 有界可续读、已读范围内引用、取得法源后留存修订、两/三版 DOCX 比较及覆盖警示；不等于支持中国法库或完整 Word 排版/修订语义 |
| docassemble `36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d` | [DOCX 实际示例](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/docx-template.yml#L47)：可选字段与文书确认 | 本轮仅重读该示例，未重读全解释器；借鉴字段必填边界，不恢复通用访谈 |
| new-litigation-visualization `16c480c3947e78ba49623423ea0486277f5fe99d` | [check_claims.py](https://github.com/MiaoQichuan/new-litigation-visualization/blob/16c480c3947e78ba49623423ea0486277f5fe99d/plugins/mqc-nlv/skills/mqc-trial-confrontation-master/scripts/check_claims.py#L47)、时间线 casefile.schema.json | 逐主张材料、回应与缺口的机械检查；是技能脚本，不当作成熟 Web 产品，更不照搬硬编码举证责任或浮点金额算法 |

Twenty、Cherry Studio、AppFlowy、AnythingLLM 和 RAGFlow 的完整产品实现不是本轮重读对象；此前研究仍保留原阅读边界。以上仅比较业务行为，未复制第三方实质源码，也未据此形成新的许可采用决定。

#### 已具备的基础，后续不得重复开发

| 业务 | 当前代码已经做到 | 本轮主要差距 |
| --- | --- | --- |
| 客户与收案 | [客户历史](../src/server/clients/history-service.ts#L165)聚合沟通、联系人、指示、交付、到账、跟进、收案、案件和笔记，连续游标且逐来源鉴权；[转案](../src/server/intakes/actions.ts#L700)保留身份、客户、当事人、成员、收费草稿、材料、紧急事项和继承复核 | 跟进未进入全局工作，原始沟通资料和旧记录定位不足；转案后环节归类接续不清 |
| 任务、等待与责任 | [同案依赖与等待](../src/server/tasks/workflow-service.ts#L189)有环检测、完成前置校验、等待结果/改期；[到期等待提醒](../src/server/reminders/task-waiting.ts#L8)已有；[交接](../src/server/matters/handover.ts#L22)由接收者承接后生效 | 案件内知道等待，全局总览未表达；无下一步案件与案情理解型交接仍是候选 |
| 材料与来源 | [新版本摄入](../src/server/documents/material-ingest.ts#L149)保留不可变版本；[处理状态](../src/app/(app)/matters/[id]/_components/material-processing-status.tsx#L75)有失败、未识别范围、继续操作；[来源校验](../src/server/evidence/source-links.ts#L77)固定版本/hash/解析/锚点 | 单件上传、编辑回传未接入、Office 定位和部分调用者未消费锚点 |
| 事实、争点与研究 | 多来源支持/反驳/背景、日期明确/区间/未知、修订历史及核对失效；[研究服务](../src/server/research/service.ts#L106)固定争点输入、保留修订，已有规则、例外、反方、结论、未决；[生成成果](../src/server/research/draft.ts#L41)实际产出关联研究的 DOCX | 事实重复呈现，研究普通入口选不到已有片段，检索采用信息需要手工衔接 |
| 人工复核与交付 | [人工复核](../src/server/document-reviews/service.ts#L129)包含作者接受/部分接受/拒绝、具体新版本关联、合格审核人复核；[交付](../src/server/deliveries/service.ts#L55)固定文档版本/hash，区分导出、发送、收悉、回复和内容确认 | 依据选择窗口、原文位置和上版未决意见接续不足；人工发送是当前设计，不等于没有交付功能 |
| 财务、审批、归档 | [账务登记/确认](../src/server/finance/ledger-registration.ts#L51)区分待确认与到账；既有更正/核销/退款和资格守卫；[归档导出](../src/server/archive/export.ts)核对批准快照和原件 | 发现已签署登记的准入不一致及归档总览范围问题，不据此宣称整个财务/归档缺失或已全面验证 |
| 检索与可选 AI | 已有授权数据库正文检索；[元典类案保存](../src/server/yuandian/save-case.ts#L44)保留链接、裁判日期、保存时间并入案；[AI 审阅](../src/server/ai/review-document.ts#L116)有文档 hash、实际分段及部分覆盖披露 | 正文结果跳转和续查不足；RAG 适配并非普通案件查询入口；启用 AI 后仍缺后续段续审与逐项来源 |

#### 一、确定或触发条件明确的业务缺陷

##### S01｜P1｜来件首次确认开庭/期限，会在当前标准 schema 下整批回滚

**场景：**来件已经匹配有效案件/程序，责任人有效，尚未生成同类事项；律师单项“采用”或“全部确认”。

[确认服务](../src/server/sms/confirm-actions.ts#L189)在新建 Hearing/Deadline 后，又手写 `WorkResponsibility` INSERT（第 199、214 行），使用 `workKind`、`targetId`、`matterId`、`updatedAt`。但[当前 schema](../prisma/schema.prisma#L3030)及[基线建表](../prisma/migrations/0_init/migration.sql#L1707)使用 `taskId/deadlineId/hearingId`，没有上述四列；[responsibilityReady](../src/server/reminders/responsibility.ts#L10)只查表存在，标准数据库会进入错误分支。SQL 报列不存在后，外层第 92 行开始的 Serializable 事务整体回滚，包括新事项、触发器责任/通知以及本批此前的修改，不能写成“事项已建立但责任漏建”。

现行[责任触发器](../prisma/migrations/20260921000005_restore_db_guards/migration.sql#L26)已经按程序责任人、有效人员及具体目标外键创建责任与承接通知，并接到 Hearing/Deadline 的 AFTER INSERT。**最小方向是删除重复错误写入、继续使用已有责任创建机制**；补兼容列仍无法满足真实目标外键约束，另手写正确 FK 又可能与触发器唯一记录冲突。

[现有测试](../src/tests/server/sms-confirm-suggestions.test.ts#L34)将 `responsibilityReady` mock 为 false，绕开此分支；本轮只读测试，未运行。该确认文件与固定 LawLink 参考版本逐字相同，上游 schema 同样使用具体三外键，属于继承缺陷，不能归因于最近 M2/M3 模型变更。结论适用于仓库 schema/迁移一致的数据库，未检查在线数据库。

##### S02｜P1｜按整条来件去重，会把另一真实事件标为已采纳却不建立

[分析服务](../src/server/sms/analysis.ts#L229)允许一条来件产生多个具体事件建议；[确认服务](../src/server/sms/confirm-actions.ts#L192)却只要 `generatedHearingId` 或 `generatedDeadlineId` 非空就直接返回，不比较本条建议的日期、标题、来源或目标身份。外层第 104 行仍标记 ACCEPTED，第 143 行按输入条数报成功，UI 显示“已确认应用 N 项”。

**触发条件必须分开：**全新来件首次批量创建先被 S01 阻断，不能声称当前标准库正常“建第一项、吞第二项”；但已有生成记录的来件当前已可触发。现有[人工生成入口](../src/server/sms/actions.ts#L410)能正确创建事项并写 generated ID；[收件箱](../src/app/(app)/inbox/_components/inbox-view.tsx#L458)在已处理页签仍可展示/采用其余建议。此时早退发生在错误 SQL 之前，另一真实事项可被标为已采纳而没有创建或明确关联。修复 S01 后，同批不同事件仍会暴露同一去重缺陷。

ANQI 对照的是事件 type/date、必要文书提示等逻辑身份，并保存 `accepted_entity_id`、区分新建与关联已有；不是按整条上传记录去重。**最小方向：每条建议保存实际目标，区分“新建/关联已有/未应用”，不同事件分别办理；同事件多来源可明确复用。** 此项同样已在固定 LawLink 中存在。

##### S03｜P1，受 S01 遮住的新建分支｜识别到的案号没有传给事件的程序选择

[analysis.ts 第 206 行](../src/server/sms/analysis.ts#L206)用案号匹配程序，但匹配结果只用于 FIELD_CHANGE；第 230 行的事件 payload 没有程序 ID。[确认第 193、208、224 行](../src/server/sms/confirm-actions.ts#L224)另取排序第一的 ENGAGED 程序。

例如同案有一审、二审两个代理程序，文书案号指向二审，当前事件选择仍指向第一个代理程序，责任触发器也将沿该程序选择负责人。**由于 S01，新建路径当前先回滚；这里是该阻断修复后仍会保留的确定选择错误，未声称已观察到错误事项持久化。** 最小方向是将案号匹配结果变成待核对程序选择；无唯一匹配时由人选定，不按列表顺序代替业务归属，也不推进已暂缓的期限重算体系。

##### S04｜P2｜隐藏的 DOC_TYPE 待确认项挡住自动整理完成

[分析第 184 行](../src/server/sms/analysis.ts#L180)创建 DOC_TYPE 建议，默认 PENDING；[UI 第 458 行](../src/app/(app)/inbox/_components/inbox-view.tsx#L458)将它隐藏，“全部确认”也不包含它；[完成判断第 131 行](../src/server/sms/confirm-actions.ts#L131)却统计全部 PENDING。因此处理完所有可见建议后，自动 ORGANIZED 仍可能无法收口。

这不是彻底无法结束：[人工标记已处理](../src/server/sms/actions.ts#L516)出口存在，有待审文件时另受去向说明要求约束。差距是分类元数据、人工决定集合和完成条件不一致。最小方向为统一这些集合或明确将已写入的分类元数据排除在待决定项外；真实未决事项继续保留。

##### S05｜P1｜直接登记“已签署合同”跳过当前主体/范围复核

[registerBillingTx 第 22 行](../src/server/finance/ledger-registration.ts#L22)允许携 `signedAt` 直接插入 ACTIVE 和分期应收；同文件 `signBillingTx` 第 45 行在草稿确认签署前却调用 `assertMatterReviewCurrent`，注释明确“原合同签署＝委托范围正式承接”。[动作包装](../src/server/finance/ledger-actions.ts#L71)、[账务访问检查](../src/server/finance/ledger-access.ts#L11)只提供会话、现行资格、案件及归档检查，没有补上这项复核；当前迁移也没有 Billing INSERT 对应守卫。[登记 UI](../src/app/(app)/finance/reconciliation/_components/registration-workspace.tsx#L34)默认“已签署”，真实用户可走这条路径。

**影响是同一正式承接状态因入口不同接受了不同业务前置条件，不是对合同法律效力的判断。** 固定 LawLink 参考也有该不一致。最小方向是统一生效入口的现行复核；若业务明确允许补录已经发生的签署事实，应保留该性质及待复核约束，不能用与新承接不可区分的 ACTIVE 绕过规则。无需改造整套账务或收款模型。

##### S06｜P2｜自定义 DOCX 循环/可选块的字段准备与渲染语义不一致

例：`{{#plaintiffs}}{{name}}{{/plaintiffs}}`。[提取变量](../src/lib/template-engine.ts#L366)会把它平铺成 `name, plaintiffs`，实际上下文却是 `plaintiffs[].name`；[上传](../src/server/document-templates/actions.ts#L254)保存自动提取与手填变量的并集，用户无法删去误提取的根 `name`。[准备/生成](../src/server/document-templates/actions.ts#L97)都按根路径核对缺值，`detectMissing` 第 335 行又把空数组视作缺失，数组字段同时被设为只读。

后果包括：已有多个原告姓名仍被要求填无关根字段；可选第三人列表为空却无法完成准备；填根字段与实际循环输出不一致。真正 Docxtemplater 渲染仍按循环 scope 取值。**限定自动抽取的自定义循环/可选块，不能泛化为所有内置模板坏了**，内置模板有人工控制的变量清单。docassemble 本轮示例区分可选字段，j-lawyer 的字段核对也不等于“所有空值必须填”。修复现行轻量模板的作用域/条件判断即可，不恢复通用访谈。

##### S07｜P2｜案件列表写着可按案号/当事人搜索，查询却遗漏这些关联

[UI 第 206 行](../src/app/(app)/matters/_components/matters-view-v4.tsx#L206)提示“按名称、案号、当事人搜索”；[查询第 130 行](../src/server/matters/actions.ts#L130)实际 OR 只有 `title/internalCode/primaryClient.name`。程序法院案号、对方、第三人和非主要客户未纳入搜索。其中法院案号与对方/第三人又被同一查询读取供列表使用，却未参与搜索条件。

律师拿着被告名称或法院案号查询可能得到无结果，除非恰好也写在标题里。已有权限过滤、分页、URL 筛选和返回保持应保留；补真实关联字段即可，不需要新搜索平台。

##### S08｜P2｜材料命中返回了锚点，点击却只进案件首页

[检索服务](../src/server/search/actions.ts#L178)返回 `documentVersion/parseRunId/anchorId/sourceLocation/pageNo`，但 `href` 只到 Matter 或 Intake；[搜索界面](../src/components/layout/search-dialog.tsx#L258)只执行 `go(item.href)`。第 328 行仍提示“材料正文支持按页定位”。

因此命中 PDF 第 20 页后，用户还要找材料、打开、再定位。Kosmos 的原文动作与 Counsel 的精确引用可作为对照；本项目自身已有原文来源能力。最小方向为文档命中直接携固定版本和位置打开原文，“去案件”保留为独立动作，复用原授权与读取链。

##### S09｜P2｜事实时间线与事实列表完整渲染了同一批内容两遍

[FactsWorkspace 第 28 行](../src/app/(app)/matters/[id]/_components/facts-workspace.tsx#L28)先传全部 items 给 EvidenceTimeline，第 30 行又逐条渲染 EvidencePoints；[Timeline](../src/app/(app)/matters/[id]/_components/evidence-timeline.tsx#L15)已经分别对有日期/未知日期项渲染完整 EvidencePoints。重复的是标题、正文、来源及编辑操作，而第二套才有“以此争点开始研究”。

这是可由组件树直接确认的重复，不是纯审美意见。保留一套主呈现，或做明确的时间/类型切换，并把研究动作放在同一事实组件。现有多来源、反证、历史、日期能力无需重写。

##### S10｜P2，条件性｜按业务日期筛选依赖宿主机时区

[matters/page.tsx 第 61 行](../src/app/(app)/matters/page.tsx#L61)用 `new Date(year, month-1, day, ...)` 生成日期边界，再过滤 DateTime 类型的 `Matter.intakeDate/Intake.receivedAt`。系统业务口径明确为上海时间，但构造函数使用宿主机时区。

**若 Server 运行在 UTC**，所选“11月17日”对应上海时间 17日08:00 到18日07:59:59，漏掉当日前八小时并多取次日前八小时；若恰好部署为 Asia/Shanghai 则不触发。这里是静态时区推导，未读取在线配置或运行复现。复用[已有业务日期边界](../src/lib/clients/relationship.ts#L28)即可，不涉及已暂缓的 E 期限深化。

#### 二、与参考模块相比，日常办理还存在的接续差距

以下多为已有对象/服务没有被完整消费，不能一律当作数据错误，也没有自动纳入近期开发。

##### G01｜客户跟进能记录，但未进入全局待办，也缺原记录上的改期/转交

**场景：**尚未成案的客户答应周五补件，助理记录后希望主办回电；经办休假又需要转交。当前[跟进服务](../src/server/clients/relationship-service.ts#L54)有截止时间、责任人、完成/取消和审计，但创建时固定 `assigneeId=user.id`；[输入](../src/lib/clients/relationship.ts#L20)没有选负责人，UI 明示由本人负责。未找到同记录的改期/重分派动作。

[日程](../src/server/schedule/query.ts#L56)、[全局工作队列](../src/server/dashboard/actions.ts#L471)和[离岗责任检查](../src/server/reminders/offboarding.ts#L3)不消费 ClientFollowUp。跟进在有权限的客户详情、连续历史及相关案件摘要仍可读取；[关闭资格](../src/server/clients/relationship-access.ts#L31)允许本人、PRINCIPAL_LAWYER 或具备 `clients.write=ALL` 的自定义角色，在满足客户读写资格时处理。跨客户办理仍需分别进入这些入口核对，缺少统一到期与责任人队列。结束旧项并新增下一项会通过结果活动保留接续关联，但不能作为同一跟进的改期或责任转交记录。

Frappe CRM 将关联 Lead/Deal 的 CRM Task 同时纳入全局列表、负责人/日期编辑及来源跳转。适合本项目的增量是在既有总览/提醒读取 ClientFollowUp，并为原记录提供有原因的改期与转交；不要复制成另一条 Task，也不直接搬用 CRM 的任意改派替代本项目承接语义。

##### G02｜案件内可见等待/前置，全局工作总览仍笼统显示“办理中”

[任务服务](../src/server/tasks/workflow-service.ts#L108)已经给案件页面返回 activeWaiting/prerequisites，完成守卫第 293 行也会拦截；[全局队列](../src/server/dashboard/actions.ts#L463)和[WorkRow](../src/server/reminders/responsibility.ts#L11)没有这些摘要，[责任面板](../src/components/matters/work-responsibility-panel.tsx#L27)仍按 OPEN 统一展示办理中及办结动作。

因此跨二十个案件浏览工作时，列表不能直接区分可推进、等答复、前置未完成和待检查事项；需要另开现有任务详情核对，直接点击办结则会在服务校验时收到阻断原因。服务守卫并未被绕过。参考 Frappe 的实际状态视图和 ERPNext 完成校验，复用现有关系给总览补摘要/筛选即可；不增加平行任务状态机。

##### G03｜客户连续历史已贯通，沟通原件与历史精确定位仍弱

[ClientActivity](../prisma/schema.prisma#L672)与[写入服务](../src/server/clients/relationship-service.ts#L39)保存渠道、摘要、发生时间、作者，没有原始 Document/附件及实际沟通联系人关系。MatterContext 可引用活动摘要，但摘要本身不足以回看客户原话及附件。Frappe 的 activities.py 实际聚合邮件发收人、附件和送达状态；本项目 EMAIL 枚举不能据此当作邮箱已接通。

另一方面，[历史请求](../src/lib/clients/history.ts#L6)只有 clientId/cursor，[历史 UI](../src/app/(app)/clients/[id]/_components/client-history-panel.tsx#L9)有连续分页但没有日期/类型/案件筛选，若干来源只跳客户分区或案件根页。追查半年前的指示还要逐页找。

适合的增量是人工关联既有原件/联系人、增加日期/类型/案件筛选和具体来源跳转。完整邮件/WhatsApp 双向同步和通用视图引擎不是本轮要求；客户身份和连续历史不重建。

##### G04｜材料逐件处理已有接续，接件 UI 仍一次一份

[案件上传入口](../src/app/(app)/matters/[id]/_components/procedure-workflow-panel.tsx#L2410)用 `File|null`，FormData 只有一个 file，input 无 multiple 且读取 `files[0]`。客户一次给三十份材料时需重复开窗、选择和提交。[待上传接续](../src/app/(app)/matters/[id]/_components/pending-material-uploads.tsx#L15)及[处理状态](../src/app/(app)/matters/[id]/_components/material-processing-status.tsx#L38)已存在，不能说没有逐件状态/重试。

Paperless 的上传服务遍历文件集合，每份保留进度、taskId、失败原因和成功对象链接。优先增量为多选、共同归属默认值、逐件调整/结果/重试，调用现有单件摄入服务；无需第二套摄入平台，也不以 WebSocket 为前置。

##### G05｜连续编辑已有安全取件/新版本接口，普通用户链路仍停在手动下载再上传

[checkout](../src/app/api/desktop/checkout/route.ts#L13)、[受控取件](../src/app/api/desktop/file/route.ts#L14)、[uploadNewVersion](../src/server/documents/actions.ts#L433)及摄入服务已经能绑定用户、旧版本、短时令牌并拒绝过时基线。全 src/tools/scripts 的调用检索未发现实际 UI/连接器消费 checkout；[材料详情](../src/components/documents/document-detail.tsx#L95)真实操作仍是下载、手动上传新稿。

j-lawyer 则从模板/案卷打开文件，经 CaseUtils、DocumentObserver、CaseDocumentStore 到可见保存状态形成完整链。**差距是从“有 API”到“律师连续改稿可用”的产品接续。** 若选择推进，应选一种可用的编辑回传方式，仍生成不可变新版本，明确保存失败/版本冲突；不能照搬覆盖原件，也不等于恢复 Personal 或建通用同步系统。

##### G06｜Word/表格来源身份已保留，但原文预览还不能准确跳到该位置

[parse-material](../src/server/rag/parse-material.ts#L63)把 Word raw text 按约4000字符形成 TEXT 锚点，诚实说明不是原 DOCX 段落身份；Excel 已有真实表/行/列。[来源视图](../src/server/documents/material-processing.ts#L48)可表达提取位置，PDF 可加页码，但 Office originalUrl 指向整份 preview；[预览路由](../src/app/api/documents/[id]/preview/route.ts#L87)转换 HTML 没有对应锚点 DOM。

Counsel 区分阅读视图与保存的精确文本，并验证引用在已读范围内。适合先补的是现有抽取片段/表格坐标的精确打开与预览性质说明；完整 OOXML 段落/修订/布局映射继续单独后置，不假称普通转换保真。

##### G07｜三个固定窗口缺少继续查找；影响分别是检索、依据选择和归档总览

| 入口与证据 | 确认的范围 | 业务影响与准确边界 |
| --- | --- | --- |
| [全局搜索](../src/server/search/actions.ts#L58)、[UI](../src/components/layout/search-dialog.tsx#L109) | 最新200候选，最终每组最多20条，返回无 cursor/hasMore/total | 常见词命中很多材料时不能续查；显示数量只是返回数组长度。不是证明任意查询都漏件，更不是要求向量库。保留最终权限过滤，补范围提示/稳定续查 |
| [人工复核来源](../src/server/document-reviews/service.ts#L84)、[选择器](../src/components/document-reviews/document-review-panel.tsx#L100) | 取最新101条，仅前100条进入鉴权选项；有“最近100份”说明，但无查找/继续加载 | 同案早期合同可能有权却选不到。创建服务本来允许任意有权同案材料，缺口在选择器；不能泛化到[交付选择器](../src/server/deliveries/service.ts#L249)，后者是全量 |
| [归档总览查询](../src/server/archive/actions.ts#L584)、[页面](../src/app/(app)/archive/page.tsx#L22) | 最近200条已批准 ArchiveRecord，无参数/总计/分页；`items.length` 显示“已归档 N 件” | 200条记录不等于200个案件，补充归档可多条；旧记录不能从此总览续查。数据仍保留，有权限者可经已归档案件列表/具体链接访问，不能称档案丢失。固定 LawLink 查询已有同一上限 |

这些是有界查询缺少后续入口/口径的问题。最小增量为各自现有权限范围内的查询、分页和正确计数；不要一律改成无界全量，也不要为此替换全部列表框架。参考的价值在于对象选取和返回路径明确，不宣称所有上游列表均无窗口限制。

##### G08｜人工复核的原文位置和跨版本未决问题没有接续到新稿

[人工复核合同](../src/server/document-reviews/contracts.ts#L6)的 location/revisionLocation 是文字，basis 为单个 documentId，没有复用 parseRun/anchor；[面板](../src/components/document-reviews/document-review-panel.tsx#L29)链接统一 download inline，无具体页/片段。正文与复核还分在不同 Tab，核对者需来回寻找。

再看版本：[问题查询](../src/server/document-reviews/service.ts#L54)只按 exact documentId，[版本清单](../src/server/documents/detail-actions.ts#L44)不带前版未决意见/已关联修订摘要。V1 的问题仍保存且可回看，但进入 V2 时没有就近提示，容易重复查找或漏掉上下文。

优先复用现有原文选择/预览，在 V2 显示可打开的前版未决摘要；不复制或重绑旧意见。**这是信息接续缺口，不据此自行增加“所有意见关闭才能批准”的门禁。** 作者解释、部分采纳、独立批准与交付各有语义。Counsel 的版本比较仅支持“明确上下文和来源”的参考，未证明它实现了本项目完整人工复核流程。

##### G09｜研究后端已支持片段来源，普通研究 UI 造不出该数据

[研究合同](../src/server/research/contracts.ts#L51)复用支持 parseRunId/anchorId 的 sourceInputSchema；[研究来源编辑器](../src/components/research/research-source-editor.tsx#L15)只选择 documentId/relation/PDF页及法源元数据，提交不含锚点。虽然能显示“固定原文片段”，普通新增路径并没有片段选择。

同项目[事实来源选择器](../src/app/(app)/matters/[id]/_components/evidence-panel.tsx#L280)已有 listMaterialSources、分页和锚点提交。对照 Kosmos 高亮绑定/Counsel 精确引文，最小方向是复用这段已有能力到研究页面，保留同一授权与固定身份。没有理由再建研究专属来源模型或先部署 RAG。

##### G10｜类案能够入案，查询→采用→研究修订仍需要重复手工衔接

必须先确认：[元典保存服务](../src/server/yuandian/save-case.ts#L44)及[查询面板](../src/app/(app)/matters/[id]/_components/case-search-panel.tsx#L108)已将关键词/语义类案保存为本案 Markdown，含案号、法院、裁判日期、原链接、保存时间及当次返回内容；研究可选这些材料。不能写“全部法库结果只能抄录”或“没有来源留存”。保存返回片段也不等于另行取得并核实完整裁判文书；本服务没有自动取回全文的步骤。

真实差距是本次查询参数/provider/结果采用没有直接形成研究 queryLog；[研究来源](../src/components/research/research-source-editor.tsx#L35)默认 MATERIAL，法源身份、效力时点及取得方式仍需手填；法规结果、[管理员 MCP 预览](../src/server/legal/mcp-actions.ts#L81)未形成普通研究的直接采用入口。

Counsel 的工具把取得公共法源、保存修订、实际读取、引用分开。适合先接已有元典保存到“加入当前研究待核实来源”，保留查询、网址、取得时间及摘要/全文性质；人工核实不自动变 CHECKED。其美国法源工具不证明中国法库适配，MCP/RAG 也不是本项前置。

##### G11｜收案转案保留了材料，但真实环节归类没有续接

[转化第 812 行](../src/server/intakes/actions.ts#L812)建程序；第 860 行注释称归入首环节，实际只写 matterId/procedureId 和旧“阶段:xx”标签，没有 stageId。程序物化环节不回填材料；[当前材料呈现](../src/app/(app)/matters/[id]/_components/procedure-workflow-panel.tsx#L2938)只按真实 stageId 匹配。

**材料仍能在全案/程序未归属区域找到，未丢失；不能把所有材料自动认成“代理授权”。** 差距是转换后没有清楚的分类续接，旧注释又与现行实现不符。可提供“本次收案材料归类”入口，只给明确类型建议目标；若产品决定保持未归属，则把该路径明确。不要恢复旧标签兼容或伪造归属。

##### G12｜同文件候选决定已记住，跨来件的同一事件仍缺明确复用/忽略/恢复

[analysis.ts 第 239 行](../src/server/sms/analysis.ts#L239)按 smsId/fileId/kind/fieldKey/suggestedValue 去重，包含被拒绝项，因此“同文件重跑无条件复活”是误报。但[SmsSuggestion](../prisma/schema.prisma#L2282)没有案件级逻辑事件与多来源集合，同一事件从另一文件/来件提取时无法继承已有决定。

ANQI 的 candidate-facts、accept/decline/reopen 及真实 UI 区分新建/关联已有、显示多个来源，支持忽略原因和恢复。此项与 S02 相反：同一消息内去重过粗，跨消息又不认识同一事件。可先仅针对明确程序事件提供复用和多来源，不自动语义合并全部事实；有疑问继续待人工决定。更完整候选管理是业务候选，不把通用 AI 记忆平台列为前置。

##### G13｜材料主列表没有按已有版本族收拢，历史稿与当前稿逐行混排

此项接续[计划 §8.24](WORKBENCH_PLAN.md#824-维护延期后的业务余项核对2026-11-17)，本轮再沿实际入口复核。[案件查询](../src/app/(app)/matters/[id]/page.tsx#L94)读取全部未撤回版本，并保留 familyId/isLatest；[procDocs 投影](../src/app/(app)/matters/[id]/_components/matter-detail-tabs.tsx#L401)却丢掉这两个字段，只传 version。[材料主列表](../src/app/(app)/matters/[id]/_components/procedure-workflow-panel.tsx#L2497)按每条 Document 计数和 map，没有按版本族形成主入口，材料行仅对 v>1 显示版本数字，没有当前/历史标志。

例如同一诉状修改五次，主列表会呈现五条材料，而已有[材料详情](../src/components/documents/document-detail.tsx#L106)本来就支持版本切换。差距是列表没有消费已建立的版本身份；这也直接对应现有需求 §9.3，而非本轮引入新文档模型。可用真实 familyId 形成“一族一个主入口、详情看各版”，保留具体版本选择与权限，不按同名猜版本，也不把找到的历史稿自动冒充当前稿。参考项目的材料主对象/历史入口组织可借鉴，但不声称 j-lawyer 或 Paperless 使用与本项目完全相同的不可变版本族。

##### G14｜办案沟通/研判记录可新增和展示，已有 Note 编辑服务没有接到入口

同样接续计划 §8.24。[ProgressDialog](../src/app/(app)/matters/[id]/_components/progress-dialog.tsx#L44)不接已有 Note，每次初始化清空，仅调用 createNote；[记录投影和列表](../src/app/(app)/matters/[id]/_components/procedure-workflow-panel.tsx#L1734)没有保留供编辑使用的 Note/authorId，LogRow 的现有操作接的是旧备忘/快递，沟通及研判记录仍为展示。全 src 对 `updateNote` 的检索只找到[服务定义](../src/server/notes/actions.ts#L61)，没有调用方。

用户记错沟通日期、联系人或研判内容时，主入口缺少对这条记录的更正动作；不能以“后端已有函数”认定编辑体验完成。现有接口限制本人记录并检查案件写入资格，可在原记录上接编辑模式，同时核对该保存链的现行权限、归档、所见版本和审计，不重建沟通系统，也不能将新建一条记录当作已经编辑旧条。

##### G15｜目标/客户指示的修订尚未与实际采用成果形成直接关系

当前[目标/指示记录](../prisma/schema.prisma#L3261)已有系列、版本、更正/替代、来源与人工确认；[研究](../src/server/research/service.ts#L75)已固定争点输入并提示争点/材料变化；[研究出稿](../src/server/research/draft.ts#L60)已经建立具体研究修订→分析稿关系；[模板快照](../src/server/document-templates/actions.ts#L161)也保存实际字段值、程序/当事人选择及模板身份。因此不能说没有版本、没有成果溯源或没有变化提示。

缺口是没有明确选入“这份研究/文书实际采用哪一版 GOAL/INSTRUCTION”。`MatterContextRecord.sourceDocumentId` 是指示从哪里取得，不代表哪些成果采用了该指示；手工把指示抄进模板字段，保存的是值，也不会自动知道其指示修订身份。于是客户将指示 V1 更正为 V2 后，系统能展示指示历史，却不能只沿真实采用关系指出哪些研究/稿件需重新核对。

Counsel 的[reference-impact](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/reference-impact.ts#L15)、[实际存储调用](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/store.ts#L1173)和[读取入口](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/http.ts#L259)沿显式固定引用比较新旧版本，同时记录无关系及截断范围。可借鉴的是“确实采用的修订→变化后提示核对”，不是它与本项目完全相同的客户指示模型。最小范围是实际采用时选定修订、只提示这些直接关系；没有关系就说明未检查，不按同案/文本相似推断，不改写历史批准/交付，不强制先有客户决定，不恢复 B 比较、自动评分或全案多跳平台。

#### 三、仅在已启用 AI 审阅时存在的两项接续问题

##### O01｜P2｜长文诚实显示部分覆盖，但再审仍重复开头，无法继续未审后文

[prepareReviewSegments](../src/lib/ai/review-coverage.ts#L26)每次从0开始，只保留前6段，每段约6000字符；[审阅输入](../src/server/ai/review-record-service.ts#L11)只有 matterId/documentId，没有后续位置。[批量审阅](../src/server/ai/batch-review-matter.ts#L74)只跳过 COMPLETE，因此 PARTIAL 长文下次仍重复同一前缀。

例如约6万字符的材料，前约3.6万字符被选入，后文不能通过再次调用这项功能续到。[覆盖汇总](../src/lib/ai/review-coverage.ts#L41)如实记录未发送范围，问题是不能续读，不能描述为伪装全文完成。Counsel 的 `counsel_read_record` 接受 start/length、记录实际 ranges、返回 nextStart，说明有预算限制也能有继续入口。最小方向为同一固定版本续审未送出范围、失败只重试相应段、合并实际覆盖；换版本不沿用旧偏移。

##### O02｜P2｜锚点覆盖预览与实际审阅输入分离，风险条目不能逐项回到依据

[覆盖预览](../src/server/ai/input-coverage-service.ts#L149)有锚点与区间，但第194/197/210行明确 PREVIEW、NOT_SENT、离线预览；[实际审阅](../src/server/ai/review-document.ts#L34)另行提取 PDF/DOCX 裸文本并分段。[ReviewItem](../src/lib/ai/review-parser.ts#L6)只有 type/severity/title/detail；保存产物虽有文档 hash 和实际覆盖，缺每条问题的精确引文/位置。

所以“违约责任不对称”等风险不能直接点回模型依据段。这里没有否定文档级溯源，也没有把离线预览误称真实发送。对照 Counsel 在真实已读 ranges 内核验引文的做法，适合让实际输入复用固定解析来源、记录实际送入片段，并对逐项引文服务端核验，再复用已有原文预览；不要求先造通用 AiRun 平台。

当前 `createRagFlowAdapter/retrieveScopedEvidence` 的主要消费者仍为验证脚本和测试，未形成普通案件 RAG 查询入口；MCP 是管理员配置/预览。产品内真实数据库正文搜索、元典关键词/语义类案等仍然存在。上述差异只用于准确说明实现状态，不把可选服务未部署算作核心交付失败。

#### 四、确有参考价值，但本次不自动恢复排期的能力

| 候选 | 现状和参考证据 | 适合的边界 |
| --- | --- | --- |
| C01：主动找出“在办却没有下一步”的案件 | 当前总览从已有 Task/期限/开庭形成；j-lawyer `getAllWithMissingCalendarEntries` 及客户端实际查出没有未办日历项的未归档案 | 可在案件列表增加“待安排下一步”筛选；只提示律师安排，不自动制造法定期限或恢复复杂排程。保留 W14 候选 |
| C02：接收人快速理解案情的交接摘要 | [当前交接快照](../src/server/matters/handover.ts#L8)固定责任工作、程序、待确认账务/开票/用章/保全，但未汇总目标指示、未决争点、研究/复核/交付上下文 | 现有责任接收机制不重建；以后可加受权摘要与原记录入口。Frappe 只有活动组织可参考，未证明有完整法律交接包；具体方案属本项目判断 |
| C03：逐主张/要件的回应与材料缺口 | [研究修订](../prisma/schema.prisma#L3322)已有规则、例外、反方、结论、未决等文本；NLV 脚本把 obtained/not_obtained、空回应原因、金额构成机械检查 | 复杂诉讼确有需求时才在现有研究加小型对照，不把尚未收到答辩状当无异议；不照搬硬编码法律责任，不恢复 B 方案比较或新门禁 |
| C04：Word 两/三版轮次比较与批注归因 | 本项目目前为版本列表/分别预览；Counsel 真实 `counsel_compare_document_rounds` 工具读取固定 sent/returned/可选 baseline，有限尺寸/时限、段落差异/作者/批注及 UI | 不是已验证独立 REST 接口，也不等于完整 Word 等价比较，页眉/脚注/布局等有覆盖边界。继续后置，先补 G05/G08 的日常接续 |

#### 五、按业务收益安排的处理顺序与定点复验场景

本表保留当时的审查建议及反例；现行排期和实施状态统一见[计划 §7.14](WORKBENCH_PLAN.md#714-两份审查报告合并后的业务实施计划2026-11-17)，不能据本表推定整组已进入本批。

| 顺序 | 建议范围 | 为什么优先 / 以后实施时要验证什么 |
| --- | --- | --- |
| 第一组：现有办理的正确性 | S01、S02、S03、S05，再 S04/S06 | 标准 schema 下首次采纳开庭/期限；已有 generated ID 后采纳另一个真实事件；同来件不同事件与重复同事件；多程序正确归属；直接已签署与草稿确认的同一复核条件；隐藏建议完成口径；循环/空可选块字段与实际 DOCX 一致 |
| 第二组：把已有能力接到实际入口 | S07/S08/S09/S10、G02/G07/G09/G13/G14 | 被告/法院案号查案；材料命中直接到固定版本/位置；事实只呈现一次且同处研究；UTC 部署下上海日期边界；全局等待/依赖摘要；窗口外材料/归档可续查；研究可选择已有原文片段；版本族主入口和已有 Note 编辑可达 |
| 第三组：减少重复劳动并补实际采用关系 | G01/G03/G04/G05/G06/G08/G10/G11/G15，G12按来件使用量 | 跟进到期/转交、旧客户指示定位、三十文件中一件失败仍能继续、编辑回传版本冲突、前版未决问题可回看、检索结果成为待核实研究来源、转案未归属材料可主动分类；仅对明确采用的目标/指示修订提示成果待核对 |
| 条件组 | O01/O02 | 仅在使用 AI 时：长文第二次真正进入后续范围；失败仅补相应段；引文确实来自实际送入且仍获准的固定来源。未配置不阻断普通业务 |
| 后置候选 | C01—C04 与既有暂缓项 | 不指定本期 owner，不预建模型，不因参考项目存在就恢复排期或门禁 |

上述是未来实施的定点场景，**本轮未执行这些验证**。读到的已有成功测试不能覆盖所有真实分支：来件责任检查被 mock false；自定义模板测试未覆盖循环作用域/可选空数组；函数/契约能处理锚点、checkout 或任意材料，也不能证明普通页面已提供调用。后续应围绕实际触发点补证据，无需为了本次文档审查重跑全仓测试。

**本次交付仅为研究记录及计划中的审查账目，业务代码、schema、迁移和原验证结果均未改动。** 核心判断是先消除真实入口的错误，再贯通已经有的数据和动作；需要新增的专业能力按日常频率与案件价值分别选择。

#### 六、本轮问题报告与改动清单（2026-11-17）

`c24c2fc` 将前述 S01—S10、G01—G15、O01—O02、C01—C04 共31条既有发现整理成处理建议，未新增31个缺陷，也未实施修复。该次完整处置表保留于[固定提交](https://github.com/zaenzhang/LexOrder/blob/c24c2fc3477a77b7fab47646b6a0cfb858f2b45a/docs/RESEARCH_AND_DECISIONS.md#六本轮问题报告与改动清单2026-11-17)，归档检查见[计划 §8.26](WORKBENCH_PLAN.md#826-本轮问题报告整理2026-11-17)。

为避免研究证据、历史报告和执行表各自维护一份状态，**现行范围、顺序、owner及关闭证据只更新[计划 §7.14](WORKBENCH_PLAN.md#714-两份审查报告合并后的业务实施计划2026-11-17)**；本节上方31条原编号、源码触发条件和参考证据保持可查。G07三个查询窗口、G08两个接续能力仍按原报告项计数，实施时分别验证；G15实际消费方须按架构 §6.8细化，不把“研究/成果”的概括扩成所有研究强制绑定客户指示。维护及既有暂缓业务均不因此恢复。

### 3.25 云端案件演练与界面审查（2026-11-17）

本节归档用户授权的云端案件演练：设计合成材料、模拟律师操作、整理界面和业务表达问题。下面“本轮”指2026-11-17已执行的云端构建审查；原主线归档复用该轮证据，没有重启或重跑应用，也不声称较新的main已经复验。F01—F09在当轮记录为已复现、待修复的问题组；F10为已观察到的文案/规则不一致，严格格式或允许待补的产品规则尚未确定；D01—D08在当轮为待评估的设计建议；与[§3.24静态业务对照](#324-业务与参考项目静态对照审查2026-11-17)的S/G/O/C编号分别记账。本节保留原始观察，不回写为完整M3验收通过；后续实现状态统一见计划§7.14，本组7项开发修复见§8.32。归档状态见[计划 §8.27](WORKBENCH_PLAN.md#827-云端案件演练证据归档2026-11-17)。

审查日期：2026-11-17。沿用现有云端构建和用户已登录会话；按用户要求，没有计算或校验hash。业务时间按产品界面标注的北京时间（UTC+8）记录。

#### 结论

本轮已完成一组可复现的真实界面操作，覆盖客户、收案、审批状态、正式案件、合同上传、环节任务、期限与庭期、律师费登记、金额更正、客户指示更正及历史回看。发现的问题集中在业务信息显示错误、保存后丢失操作位置、输入保护不足，以及页面信息层级和文案不一致。

建议先修复三项会影响用户理解业务事实的问题：**日期型期限被显示成未录入的08:00；采购合同被混入委托收费扫描件；审批“提交于”误用收案日期。** 随后处理草稿丢失、范围重置、收案状态提示及桌面布局。后端审批冻结、收款待财务确认和指示历史保留在已执行步骤中表现正确。

本报告保留10组F观察（9组确定修复、1组规则待定）、8组设计与表达建议，以及明确的通过项和未覆盖边界。本轮以审查为目标，未修改产品业务源码。

#### 环境与最终保留状态

| 项目 | 结果 |
|---|---|
| 环境 | 云端独立测试环境；当轮会话内浏览器入口 http://127.0.0.1:4173/ |
| 当轮业务源码提交 | 原记录未登记，当前无法准确还原；`8333f7d`为证据归档提交，不能作为被浏览器验收的代码版本。不得从截图时间或当前main反推 |
| 实际浏览器角色 | 周清和（主任律师），合伙人/主办测试账号；沿用用户登录 |
| 正式案件 | QA20261117河汐诉星桥智能设备买卖合同货款纠纷 |
| 案件内部号 | LL-2026-CC-0001 |
| 当轮最终案件页 | http://127.0.0.1:4173/matters/LL-2026-CC-0001?view=archive |
| 标的字段 | 已从61,560元更新为46,560元；刷新后保留，原案由仍在 |
| 实际上传 | 1份设备采购合同PDF，分类“合同”，来源“当事人提供” |
| 客户沟通/跟进 | 1条最初沟通，1条11月18日17:00跟进 |
| 案件任务 | 1条回款核对任务；一审→举证质证；11月18日17:00截止 |
| 期限 | 11月27日举证；17:00写在标题/依据，新增入口无法结构化填写时刻 |
| 庭期 | 12月4日09:30；第三法庭（演练）；保存时间正确 |
| 律师费 | 约定8,000元，登记5,000元，保留“待确认”；未执行到账确认 |
| 客户指示 | 新建后作一次录入更正，历史中保留第1版和第2版；新版待核对 |

上述loopback地址仅标识当轮会话内页面，不是公网交付地址；本次文档归档没有重新检查其当前可用性。

收案审批的第二角色步骤由独立测试审批人经正常登录和正式业务接口辅助完成，浏览器已验证转为正式案件。该步骤不等于审批角色的界面已测试。未伪造会话或审批历史，未放松本人不能审批自己申请的规则。

本轮所涉公司、姓名、邮件、法院、通知和交易均为合成演练资料；未对外发送、支付、签署或办理真实案件。以下日期用于演练产品，不构成法律期限意见。

#### 一 案件与材料

采用已立案后新律师接手的设备采购货款纠纷，案件检索前缀为`QA20261117`。所有主体、邮件、金额、合同和通知均为虚构。

| 案件要素 | 演练设定 |
|---|---|
| 客户 | 河汐智能设备（演练）有限公司，供货方、原告 |
| 相对方 | 星桥餐饮管理（演练）有限公司，采购方、被告 |
| 交易总额 | 130,800元 |
| 三笔回款 | 39,240元、30,000元、15,000元，合计84,240元 |
| 旧本金 | 61,560元，尚未计入第三笔回款的立案口径 |
| 修订后未收本金 | 46,560元 |
| 对方扣款主张 | 质量扣款4,800元、口头折让1,200元，均未获我方认可 |
| 客户新指示 | 可讨论11月25日前一次支付43,000元的和解；最终须书面确认 |
| 律师费 | 约定8,000元，已演练登记5,000元待财务确认 |
| 举证与开庭 | 虚构通知给定11月27日17:00、12月4日09:30 |

设计该场景是为了观察多笔回款、新旧指示、缺少原始材料、质量争议、条件式授权和财务角色切换时，界面能否帮助用户分清当前事实与历史来源。43,000元谈判金额、6,000元扣款争议、46,560元未收本金以及本所律师费分别有不同含义，不应混记。

共准备14个最终文件：8份文本、4份PDF、2份DOCX。

| 材料 | 形式 | 用途 |
|---|---|---|
| 01 案件场景与录入摘要 | Markdown | 完整案情和可直接录入值 |
| 02 设备采购合同 | TXT、PDF | 采购标的、合同价款、付款约定 |
| 03 送货签收与质量反馈 | TXT、PDF | 签收内容、设备故障争议、缺失证据 |
| 04 付款流水与对账 | TXT、PDF | 三笔回款、旧金额与新余额 |
| 05 客户沟通v1 | TXT、DOCX | 首次陈述、旧金额及初始处理指示 |
| 06 客户补充指示v2 | TXT、DOCX | 新回款、更正金额及条件式和解授权 |
| 07 诉讼通知与证据目录 | TXT、PDF | 人工录入的举证、开庭时间及待补材料 |
| 08 用户操作流与观察清单 | Markdown | 15步主路径、分支和复现记录要求 |

PDF和DOCX已渲染并逐页检查，各为1页。本轮实际在产品内只上传了1份设备采购合同PDF；其余文件仍是演练材料包。客户指示中的来源文件名由承办人手工填写，不代表该DOCX已经上传或形成文件关联。

#### 二 实际操作与结果

| 流程 | 实际执行 | 结果及证据 |
|---|---|---|
| 工作台与客户 | 观察首页，创建河汐客户及联系人 | 客户可回看；01、02、08 |
| 客户沟通 | 保存最初指示和补证跟进 | 1条沟通、1条跟进，并在案件摘要中显示；08、12 |
| 收案向导 | 录入双方、程序、案由、61,560元标的和8,000元收费 | 必填错误可触发；提交后内容可查阅；03—05、09、11 |
| 待审批状态 | 打开补正按钮、尝试修改冲突结论 | 申请实际只读；冲突修改被正确拒绝，但入口误导；09—11 |
| 正式转案 | 独立审批API辅助后，通过案件列表进入正式案件 | 案件、当事人、收费和客户关联保留；12 |
| 材料上传 | 选择PDF、改名称、Esc关闭、重开；随后重新上传合同 | 草稿被清空；重新上传成功；13—15 |
| 环节任务 | 一审→举证质证→为此环节新建任务 | 关联及11月18日17:00保存正确，但查看范围回全案；17、E03 |
| 法院期限与庭期 | 手工新增11月27日期限和12月4日09:30开庭 | 庭期正确；期限出现08:00假精度；两处重复列表；19、20 |
| 律师费登记 | 从案件财务进入，登记5,000元合成律师费 | 返回默认档案页；再次进入财务可见待确认5,000元；21 |
| 金额更正 | 仅将标的字段改为46,560元 | 更新成功；案由保存正确，但编辑窗初始不回显名称；22、23、26 |
| 客户指示 | 记录补充指示，再更正表述，打开历史版本 | 两版本均保留，显示新版待核对；23、24、26 |
| 最终回看 | 刷新案件页面 | 46,560元、案由及指示第2版均保留；26 |

第1版客户沟通实际录入为11月17日09:00；材料中的原始邮件设定另行保留。补充指示记录使用本次演练录入时刻，不据此验证原始文件事件时间。信用代码为明显无效的演练标记，不是真实证件。

#### 三 已复现问题

##### F01 日期型期限显示用户没有录入的08:00

**优先处理，业务信息精度错误。** 新增期限仅有“到期日”，输入2026-11-27后，上方显示“11-27截止”，下方“事项责任与交接”以及案件摘要却显示“2026-11-27 08:00”。合成法院通知要求17:00，当前新增入口只能把它写进标题和依据。

复现：一审→待办→事项→期限→填写日期2026-11-27并保存→对比期限列表与责任面板。证据：19、20及E01的DOM摘录。

原因：日期串被转换成UTC午夜，责任面板按北京时间输出时分。应区分“只有日期”和“精确到时刻”的期限，统一新增、调整、改期和展示。未证明发生了提前9小时提醒；不能以此推断通知系统已经错发。

##### F02 采购合同被当作委托收费扫描件

**优先处理，材料用途混淆。** 上传客户与被告之间的设备采购合同，分类“合同”、来源“当事人提供”后，它出现在“档案与摘要→委托与收费→扫描件”，紧邻8,000元委托代理合同草稿。

复现：上传02采购合同PDF→打开档案→查看委托与收费。证据：15、25。12中该扫描件字段原为空。

原因：页面按所有`CONTRACT`类别材料聚合，没有按委托/收费合同附件关系区分。应依据明确的业务关联取数，不能凭文件分类、名称或PDF格式判断用途。本次没有发现它改变财务账目。

##### F03 审批“提交于”及等待时长用错时间字段

**优先处理，流程时间语义错误。** 同一申请在弹窗顶部显示“提交于2026-11-17 13:38”，逐轮记录显示第1轮14:48。源码核对确认，审批记录把业务`receivedAt`作为`submittedAt`，并用于“提交于”及等待天数。

证据：11。同屏时间差本身不是充分归因，结论依据是明确的字段映射。应使用当前有效送审轮次的实际提交时间，收案日期保持其业务含义。逐轮时间与冲突检索时间之间另有一小时时差，本轮没有定论，不把它归为时区bug。

##### F04 必填缺项计数与实际校验不一致

**影响：中。** 两家公司信用代码为空时，页面分别报“公司/组织需填写统一社会信用代码”，底部却显示“第2/4步 · 1项待完成：收费方式”。用户按计数提示补资料，仍会被未计入的字段拦住。

复现：已有公司客户+公司相对方，信用代码均留空，点击下一步。证据：04，错误与计数在同一截图中。建议让计数、星号、错误提示和真正的阻断规则共用同一来源。

##### F05 待审批收案被表述成需要补正

**影响：中。** 新申请刚提交，收案详情状态“待确认”，主按钮却写“查看补正并重新提交”；点击后实际是“待审批”和只读页面。

复现：提交新收案→点该主按钮。证据：09、11。详情页只按创建人/主办身份选文案，没有正确检查补正状态。建议待审批显示“查看审批进度”，退回后才显示补正动作。实际服务端没有允许重复送审，本项不属于权限失效。

##### F06 锁定收案仍允许输入不能保存的冲突说明

**影响：中。** 待审批页仍有可编辑说明框和“可承接”等按钮；输入后点击，返回“保存失败：当前收案不可修改；待审批申请请先撤回”。

证据：10证明控件存在；错误原文来自该次实际UI调用结果（E04），截图没有截到短暂提示。前端允许待审批编辑，后端正确限定可修改状态。应在输入前明确只读，保留后端冻结保护，不通过放宽权限修复界面。

##### F07 上传弹窗关闭后丢失草稿

**影响：中。** 选择合同PDF并输入显示名后按Esc关闭，重开时文件与显示名均为空，没有放弃修改确认。

复现：上传材料→选择文件、改显示名→Esc→重新上传材料。证据：13、14。图片证明文件选择丢失，显示名已输入与重置由E02的DOM摘录证明。建议保留当前草稿或在关闭前确认放弃，成功提交后再清空。

##### F08 保存后丢失当前工作位置

**影响：中，有两处独立复现。** 在“一审→举证质证”新建环节任务后，页面URL清除程序和环节，回到全案。任务本身仍正确关联举证质证。另一处是从案件财务登记实收，成功后跳回案件默认档案页，财务页签和原程序范围丢失。

证据：17证明任务归属；E03保存后的DOM摘录证明查看范围回到全案；21证明收款待确认，E05记录返回位置。未采用关闭动画中的截图证明最终页面。

建议保留原程序、环节、页签及合理滚动位置。任务保存后就地展示新任务；收款保存后回财务原位置直接展示待确认收款。后端任务归属和财务确认规则不需放宽。

##### F09 已选案由在编辑窗首次显示为空

**影响：中低，初始回显错误。** 详情有“买卖合同纠纷”，打开编辑案件信息却显示“点击选择”，自由文本为空，容易让用户误以为案由缺失。只改金额至46,560元后，案由仍正确保留。

证据：22、23、26。原因是下拉框在打开选项后才加载名称，初始已有ID却没有标签。应显示当前案由名称或明确加载状态。实际数据没有被清空，不把它报告成案由丢失。

##### F10 信用代码文案与实际约束不一致

**影响：中低，流程与数据质量不一致。** 空值强制阻断，但提示18位的字段可以接受`QA-HEXI-NOT-REAL`和`QA-XINGQIAO-NOT-REAL`，并在申请和案件中保存。

证据：04、23及当轮申请内容记录；保存的演练值见本项正文。实现仅检查非空及最长长度，没有与18位提示一致的格式规则。建议先明确允许“待补”还是必须有合格代码，再统一规则；不把本现象扩大成身份认证或安全漏洞。

#### 四 设计与表达建议

| 编号 | 观察与影响 | 建议 | 证据 |
|---|---|---|---|
| D01 | 最终确认页长案名被截断，对方只显示“1个”，遗漏标的61,560元，只显示律师费8,000元 | 完整展示案名、双方名称、标的额和收费金额，分别标注 | 05 |
| D02 | 桌面选中一审后，“开始办理/终结程序”横向挤压主信息，“一审”竖排，案号机构截断 | 卡片主信息与动作纵向分区，或低频动作收进菜单 | 19 |
| D03 | 同一期限和开庭在“期限与庭期”与“事项责任与交接”重复出现，操作用“完成/办结”“调整/改期”两套词 | 合并为一份日程列表，在同一条记录上展开责任与交接 | 20 |
| D04 | 已有客户的必填我方诉讼地位藏在“补全身份”折叠区 | 把本案诉讼地位作为独立、直接可见字段；错误定位到控件 | 04及实际展开路径 |
| D05 | 案件默认首页先展示大块空“事项级保全”；全案/未归属/程序卡占用较大首屏 | 优先展示当前案情、目标和下一步；无记录保全收起为入口，减少空卡 | 12 |
| D06 | 首页给律师显示`.env`/SMTP/重启；记录称“来自 Intake”；上传占位为“事项材料材料”；材料名与“文书与复核”入口重复 | 运维细节移到管理界面，事件使用业务语言，去掉重复词；材料行保留清晰主入口和必要操作 | 01、12、14、15 |
| D07 | 工作台顶部和欢迎区重复冲突预检，日程入口多处出现；空数据统计与极少记录分页占位 | 按当前数据阶段突出下一步，把重复入口和无意义空状态收敛 | 01、08 |
| D08 | 公司公共联系方式与具体联系人字段归属不清；原生日期显示月/日/年、AM/PM，记录却使用中文常见顺序 | 明确机构/联系人字段归属，统一日期显示规范，避免用户反复辨认 | 02、03、08 |

设计建议基于本次桌面、少量数据场景，不等于所有用户场景都应删除对应功能。尤其D02是在桌面宽度下实际发生，不属于尚未覆盖的移动端问题。

#### 五 本轮通过的具体行为

- 已登录会话可持续完成客户、收案、案件和财务的相关操作；云端页面可用。
- 客户沟通及跟进成功保存，并在案件摘要中出现相同内容与时间。
- 收案审批前置条件不足时已填表单保留；补齐独立测试审批人后成功提交。
- 申请人查看自己的待审批申请时为只读；修改冻结内容被后端拒绝。
- 正式案件关联了原客户、双方当事人和收费安排；设备采购合同PDF上传成功。
- 环节任务的程序、环节、责任人和11月18日17:00截止时间正确保存；庭期12月4日09:30正确。
- 5,000元律师费登记后明确为待确认，没有直接计入已确认实收。8,000元委托合同仍为草稿，暂无有效应收不计为统计bug。
- 金额字段更新为46,560元，案由仍为买卖合同纠纷，刷新后保留。
- 客户指示更正保留原版本；历史中能同时看到两版内容、理由与来源，新版显示待核对。

#### 六 证据与覆盖边界

本节随仓库保留22张经过选取的原始界面截图；主体与案件数据均为合成演练资料。图号沿用当轮编号，登录页、工具异常和过渡帧没有纳入。图片仅作本节证据附件，结论、状态和后续要求仍集中在本节及计划中，不另建平行报告。完整原始DOM输出、账号凭据、数据库、运行配置与上传附件不提交。

| 图号与证据文件 | 观察点 | 对应结论 |
| --- | --- | --- |
| [01-dashboard.jpg](evidence/2026-11-17-case-audit/01-dashboard.jpg) | 工作台与重复入口 | D06、D07 |
| [02-client-form.jpg](evidence/2026-11-17-case-audit/02-client-form.jpg) | 公司及联系人表单 | D08 |
| [03-intake-step1.jpg](evidence/2026-11-17-case-audit/03-intake-step1.jpg) | 收案日期与原生输入显示 | D08 |
| [04-intake-required-count.jpg](evidence/2026-11-17-case-audit/04-intake-required-count.jpg) | 必填错误与完成度计数 | F04、F10、D04 |
| [05-intake-confirmation.jpg](evidence/2026-11-17-case-audit/05-intake-confirmation.jpg) | 收案最终确认摘要 | D01 |
| [08-client-followup-saved.jpg](evidence/2026-11-17-case-audit/08-client-followup-saved.jpg) | 客户沟通与跟进保存 | 通过项、D07、D08 |
| [09-intake-submitted.jpg](evidence/2026-11-17-case-audit/09-intake-submitted.jpg) | 提交后状态与补正按钮 | F05 |
| [10-intake-locked-control.jpg](evidence/2026-11-17-case-audit/10-intake-locked-control.jpg) | 待审批仍显示编辑控件 | F06；错误提示见 E04 |
| [11-approval-readonly.jpg](evidence/2026-11-17-case-audit/11-approval-readonly.jpg) | 审批只读、提交时间与轮次 | F03、F05 |
| [12-matter-created.jpg](evidence/2026-11-17-case-audit/12-matter-created.jpg) | 正式案件初始档案及空状态 | F02 对照、D05、D06 |
| [13-upload-filled.jpg](evidence/2026-11-17-case-audit/13-upload-filled.jpg) | 关闭前已选合同文件 | F07；显示名见 E02 |
| [14-upload-reopened.jpg](evidence/2026-11-17-case-audit/14-upload-reopened.jpg) | 上传弹窗重开后草稿为空 | F07、D06 |
| [15-material-saved.jpg](evidence/2026-11-17-case-audit/15-material-saved.jpg) | 采购合同上传成功 | F02、D06 |
| [17-task-created-detail.jpg](evidence/2026-11-17-case-audit/17-task-created-detail.jpg) | 任务实际归属与截止时间 | F08；全案范围见 E03 |
| [19-deadline-saved.jpg](evidence/2026-11-17-case-audit/19-deadline-saved.jpg) | 期限保存与程序卡挤压 | F01、D02 |
| [20-schedule-duplicate-time.jpg](evidence/2026-11-17-case-audit/20-schedule-duplicate-time.jpg) | 期限精度与重复日程 | F01、D03 |
| [21-fee-pending.jpg](evidence/2026-11-17-case-audit/21-fee-pending.jpg) | 5,000元收款仍待确认 | F08；返回位置见 E05 |
| [22-edit-amount-only.jpg](evidence/2026-11-17-case-audit/22-edit-amount-only.jpg) | 编辑窗口案由初始不回显 | F09 |
| [23-instruction-amount-saved.jpg](evidence/2026-11-17-case-audit/23-instruction-amount-saved.jpg) | 金额更正及指示保存 | F09、F10、通过项 |
| [24-instruction-history.jpg](evidence/2026-11-17-case-audit/24-instruction-history.jpg) | 客户指示的两版记录 | 记录版本通过项 |
| [25-contract-misgrouped.jpg](evidence/2026-11-17-case-audit/25-contract-misgrouped.jpg) | 采购合同进入委托收费扫描件 | F02 |
| [26-final-reloaded.jpg](evidence/2026-11-17-case-audit/26-final-reloaded.jpg) | 刷新后的金额、案由及新版指示 | F09、通过项 |

##### 关键操作与DOM摘录

以下仅摘录当轮与结论直接相关的值。截图、DOM和操作结果分别标明，避免把短暂提示、保存后路由或未上传的材料当成图片已经证明的事实。

| 编号 | 当轮观察到的值 | 证据性质与用途 |
| --- | --- | --- |
| E01 | 期限列表“11-27 截止”；责任面板“2026-11-27 08:00 · 办理中”；依据“2026-11-27 17:00前提交，日期和时刻均需人工核对。” | 图20对应DOM摘录，支持F01；17:00只写入标题/依据，不是新增表单结构化时刻 |
| E02 | 关闭前“已选 02_设备采购合同_演练.pdf（4 KB）”，显示名“设备采购合同｜2026-09-15｜演练”；重开后“未选择文件”，显示名文本框为空 | 图13、14对应DOM摘录，支持F07；图13的显示名截图存在取帧时差，不能单凭图片断言已输入名称 |
| E03 | 保存后任务区标题“全案任务”，同一任务仍显示“一审 · 举证质证”和“2026-11-18 17:00” | 当轮保存后DOM摘录；图17独立证明任务关联正确。原关闭动画截图不随仓库归档 |
| E04 | “保存失败：当前收案不可修改；待审批申请请先撤回” | 在图10对应页面点击“可承接”后的实际UI返回；图片只证明控件可编辑，未捕获这条短暂提示 |
| E05 | 从案件财务登记收款后，返回 /matters/LL-2026-CC-0001，未保留财务页签及原程序范围；手动回财务后显示“待确认”5,000元 | 当轮导航操作记录加图21；不表示财务人员已确认到账 |

##### 覆盖边界

1. 材料包共14个文件，实际通过UI上传了1份采购合同PDF。没有完成所有文件逐份上传，也没有验证PDF在线预览、下载内容、DOCX新旧文件版本或完整卷宗导出。
2. 本轮验证的是客户指示**记录版本**，不是附件文件版本。模板文书生成、人工复核、送审与交付全过程没有在本轮标为通过。
3. 独立审批通过正常认证业务接口辅助，不是第二角色浏览器UI实测。财务角色的到账确认、退款、核销和开票未执行。admin账号的完整权限矩阵未覆盖。
4. AI/OCR/RAGFlow/MCP等可选服务未作为验收门槛。没有把关闭可选能力或尚未配置SMTP列为产品故障。事实与来源的完整提炼、检索与引用链未全面覆盖。
5. 自动化填充曾未更新受控组件日期状态，键盘事件后保存成功，已排除。文件选择期间的工具等待不作为应用性能证据；任务表单的瞬时画面不代表最终值，以17保存后的11月18日17:00为准。
6. 收案缺独立审批人属于演练环境配置，已补齐，不计产品缺陷。浏览器日志采样只出现扩展元数据报错，没有将它记为应用bug，也不声称已完整排除所有应用异常。
7. 不把上传新材料后未自动改标的额算bug；本轮金额变更由用户操作路径明确保存。也不把保留原始收案事实摘要等同于当前标的保存失败。
8. 未执行真实对外通信、付款、合同签署或法院提交；未验证手机/窄屏、多浏览器、多人并发、全部异常路径。报告结论限于已列操作。


#### 工程定位与修复验收

以下定位来自实际操作后的只读代码核对；本轮没有修改产品业务代码。下面路径供工程定位，指向仓库现有文件；这些结论来自当轮只读核对，不证明后续 main 已重新运行或复验。优先级表示建议修复顺序，不表示已发生生产损失。

##### 第一批：会改变用户对业务事实理解的问题

| 问题 | 已确认原因 | 修复验收要求 |
|---|---|---|
| 日期型期限出现未录入的08:00 | 新增表单只有日期；`z.coerce.date()` 将日期串转换成UTC午夜；责任面板统一按北京时间显示时分 | 日期型期限不得显示伪造的精确时间；通知明确17:00时，应能在新增与改期入口一致录入、保存、回看；不能把所有历史日期简单批量加减8小时 |
| 采购合同混入委托收费扫描件 | 案件详情仅按 `category === CONTRACT` 聚合，然后把一般合同全部显示在委托与收费的“扫描件” | 上传采购合同或其他业务合同仍归入案件材料；只有与委托/收费合同明确关联的附件进入该扫描件区；财务统计不应因普通材料分类变化而变化 |
| 审批“提交于”及等待时长误用收案日期 | 收案审批记录的 `submittedAt` 实际映射为 `receivedAt`；弹窗和等待时长据此计算 | 收案日与提交日不同、退回后重新提交时，列表、弹窗和等待时长均使用正确轮次的提交时间，业务收案日期保持原意 |

##### 第二批：保护输入、保留操作位置、统一状态

| 问题 | 建议验收 |
|---|---|
| 上传草稿被Esc关闭清空 | 选文件、改名称和来源后按Esc、点遮罩或关闭，保留草稿或明确询问放弃；成功上传后才重置。测试不用计算文件校验值 |
| 创建环节任务跳全案 | 在一审→举证质证创建任务，成功后保留原程序/环节；任务详情仍显示正确关联和截止时间 |
| 收款登记返回默认档案页 | 从案件财务入口登记后返回原案件财务视图及范围，能直接看到本笔“待确认”记录；不得自动确认到账 |
| 待审批却显示补正按钮 | 新提交显示“查看审批进度”；只有实际退回补正后才显示补正与重新提交入口 |
| 锁定冲突结论仍能编辑 | 待审批状态在输入前就呈现只读；允许撤回时提供清楚入口；保留后端冻结守卫 |
| 必填缺项计数错误 | 同时缺两方信用代码与收费方式时，底部计数和实际字段错误一致；已有客户的诉讼地位错误可直接定位 |
| 案由名称首次不回显 | 已存标准案由在编辑窗首次打开即显示名称；只改金额并保存，案由ID与名称均保持 |
| 程序卡选中后挤压 | 在本次桌面宽度下选中一审，标题、案号和机构仍可读；状态动作不与主信息争抢横向空间 |

##### 代码位置索引

| 问题 | 主要文件或数据流 |
|---|---|
| 日期型期限精度 | [src/app/(app)/matters/\[id\]/_components/procedure-forms.tsx](../src/app/%28app%29/matters/%5Bid%5D/_components/procedure-forms.tsx) → [src/server/procedures/schemas.ts](../src/server/procedures/schemas.ts) → [src/server/procedures/actions.ts](../src/server/procedures/actions.ts) → [src/server/reminders/responsibility.ts](../src/server/reminders/responsibility.ts) → [src/components/matters/work-responsibility-panel.tsx](../src/components/matters/work-responsibility-panel.tsx)；另需统一 `procedure-content.tsx` 的调整入口 |
| 合同用途混淆 | [src/app/(app)/matters/\[id\]/_components/matter-detail-tabs.tsx](../src/app/%28app%29/matters/%5Bid%5D/_components/matter-detail-tabs.tsx)、[src/app/(app)/matters/\[id\]/_components/matter-archive.tsx](../src/app/%28app%29/matters/%5Bid%5D/_components/matter-archive.tsx) |
| 审批时间字段 | [src/server/approval-permissions/records.ts](../src/server/approval-permissions/records.ts)、[src/server/intakes/revision-history.ts](../src/server/intakes/revision-history.ts)、[src/app/(app)/approvals/intake-approval-dialog.tsx](../src/app/%28app%29/approvals/intake-approval-dialog.tsx) |
| 待审批状态的按钮及编辑 | [src/app/(app)/intakes/\[id\]/page.tsx](../src/app/%28app%29/intakes/%5Bid%5D/page.tsx)、其 `_components/intake-actions.tsx` 与 `_components/conflict-section.tsx`；后端 [src/server/conflicts/actions.ts](../src/server/conflicts/actions.ts) 正确拒绝修改 |
| 完成度及隐藏诉讼地位 | [src/app/(app)/intakes/_components/intake-wizard.tsx](../src/app/%28app%29/intakes/_components/intake-wizard.tsx)、[src/app/(app)/matters/_components/party-card.tsx](../src/app/%28app%29/matters/_components/party-card.tsx) |
| 上传草稿及任务保存后的范围 | [src/app/(app)/matters/\[id\]/_components/procedure-workflow-panel.tsx](../src/app/%28app%29/matters/%5Bid%5D/_components/procedure-workflow-panel.tsx) 中 `openUploadDialog`、Dialog关闭处理和 `onTaskCreated` |
| 收款后的返回位置 | [src/app/(app)/matters/\[id\]/_components/matter-detail-tabs.tsx](../src/app/%28app%29/matters/%5Bid%5D/_components/matter-detail-tabs.tsx)、[src/app/(app)/finance/reconciliation/_components/registration-workspace.tsx](../src/app/%28app%29/finance/reconciliation/_components/registration-workspace.tsx)；现有 `returnTo` 能力可复用 |
| 案由初始名称 | [src/app/(app)/matters/_components/cause-combobox.tsx](../src/app/%28app%29/matters/_components/cause-combobox.tsx)、[src/app/(app)/matters/\[id\]/_components/matter-basic-editor.tsx](../src/app/%28app%29/matters/%5Bid%5D/_components/matter-basic-editor.tsx) |
| 桌面程序卡布局 | [src/app/(app)/matters/\[id\]/_components/matter-detail-tabs.tsx](../src/app/%28app%29/matters/%5Bid%5D/_components/matter-detail-tabs.tsx)、[src/app/(app)/matters/\[id\]/_components/procedure-status-actions.tsx](../src/app/%28app%29/matters/%5Bid%5D/_components/procedure-status-actions.tsx)、[src/app/moan-pages.css](../src/app/moan-pages.css) |

##### 保留的事实边界

日期型期限的08:00是显示与精度问题；当前提醒按北京时间的日历日计算，本轮没有证明发生了提前9小时提醒。采购合同被显示在错误区域，也没有证据表明它改变了财务账目。案由名称首开不回显，实际保存并未丢失案由。这三项需要分别修正，不能扩大为未经验证的数据损坏。

本轮没有计算或核验hash。界面自动显示的短“校验值”只是被观察到的产品文案，不代表已执行完整性验证。

### 3.26 两次审查提交的合并与实施取舍（2026-11-17）

复核对象为[报告整理 `c24c2fc`](https://github.com/zaenzhang/LexOrder/commit/c24c2fc3477a77b7fab47646b6a0cfb858f2b45a)与[云端证据 `8333f7d`](https://github.com/zaenzhang/LexOrder/commit/8333f7d90c36bb975f0e5672af1c405bb1383f7a)。前者仅改研究/计划，后者增加研究/计划/导航和22张证据图片，没有业务源码或迁移变动；本次不重写这两个提交或删减原始证据。当前代码与原始截图的证据性质分开，实际执行表归计划 §7.14。

#### 复核后具体纠正

| 事实 | 合并或简化决定 | 实施时必须保留 |
| --- | --- | --- |
| 导航仍将工作区和争点研究整体标为未完成，并指向修复前 §8.20 | 导航改为已合入的实现与具体剩余缺口，当前状态只指计划 §7.14 | §8.21/§8.22是对应批次证据，不因此宣称完整M3通过 |
| §8.24五项与G09/G13/G14/G15、G03的具体指示返回重复 | 一份实施清单映射全部原编号；研究只保留发现与采用依据，旧处置表固定在Git | 49组是不同性质的观察/建议，不等于49个缺陷；同工作包仍逐原场景关闭 |
| F02已有`BillingAttachment`，F03已有`IntakeRevision.submittedAt` | 使用已有明确关联及实际轮次，不新建收费附件模型或平行审批历史 | 普通CONTRACT分类不代表委托收费附件；无真实提交记录就未知，不能以收案日补造 |
| G13、F07及D06材料动作均触达StageMaterialsPanel/DocRow | 一次改材料主入口、当前任务草稿保护及重复动作 | 版本族、上传意图是不同身份；历史版不升级为当前，失败不换文件或目标 |
| F08的任务回调清空procedure/stage，财务页面按调用方returnTo返回 | 各修已有回调和合法返回参数，无需导航框架 | 两条路径独立验证；明确新建事项级Task时回全案是正确行为 |
| F01是期限精度，S10是日筛选边界；S09是事实重复，D03是日程/责任重复 | 可按领域协调修改，不能归成一个修复或一个测试 | 不平移历史时间；不从日程呈现删除责任/交接能力；不同来源与权限分别保留 |
| F10已观察文案与非空校验不一致，报告尚未确定严格格式或待补策略 | 改为规则待定，保留事实与编号 | 不由本次审查擅自增加组织18位准入或声称身份认证漏洞 |
| 图24验证的是指示记录更正/历史；金额通过独立案件编辑保存 | 复用现有MatterContextRecord，补精确定位与实际采用关系 | 不把记录版本称文件版本；不从指示文字自动改标的/合同/账务 |

#### 参考、架构与用户任务的取舍

本轮沿 §3.24 固定项目模块，针对实际切片重读或复核：LawLink用于当前来件与财务原链，ANQI用于“建议实际关联到哪个事件”的确认语义，Kosmos/Counsel用于固定来源及直接采用的变化提示，Frappe用于记录的对象就近操作。采用行为而非复制第二套身份/系统；具体模块阅读和采用边界随对应切片补充，未重读的参考不登记为本次重验。

用户从现有材料、办案记录、研究、客户历史及收件箱入口继续办理。方案只使用当前Next/React/Prisma、已有shadcn/Radix与实际服务；材料列表读真实familyId，Note编辑读updatedAt，研究选既有SourceAnchor，指示采用选不可变记录及确认时点。只有建议实际目标与输入消费关系等确需持久化的部分才设计数据库变更，不为展示建立投影、平台或兼容路径。

**首五切片实施反馈：**复用责任触发器、BillingAttachment、Note.updatedAt、Document.familyId及现有SourceAnchor即可完成本批，不新增关系模型或通用平台。实际代码交叉复审纠正了PDF PAGE锚点重开后同时携page/anchor、补传并发同内容重试、空文件漏报和多余副本清理误报；固定历史、当前来源资格和失败保稿保持。旧无建议手工生成入口仍有合法调用，不当作已替代死代码删除。参考沿前述固定阅读范围采用业务行为，未复制第三方新源码或声称新运行其项目。

**G03实施反馈：**复用确切上下文读取和客户现有加密游标即可完成旧指示定位，不建通用导航或历史投影。交叉复审纠正了客户端恢复URL而服务端props不变、返回无游标首屏时旧响应覆盖、重复定位参数露出旧正文及来源按钮消失后的焦点归属；真实Action→服务→PG核对窗口之外旧版，读取不写历史。没有重验第三方项目或扩大到联系人、沟通附件和同步系统。

**G15实施反馈：**两个具体关系及原有创建事实足以表达固定采用，不建影响状态表或通用成果图谱。实际入口复核覆盖OPTION、研究/模板出稿、普通上传/新版本和人工brief；新批准归档复用原冻结清单。代码复审纠正独立审批经审查报告来源时误拒、OPTION前版来源失权后的更正、遗漏字段被误当清空、缓存正文失效和研究错误重试对象；确认时点先规范再参与原请求身份。测试另把错误末版、首版物理清理和context-only归档源隔离，避免既有守卫掩盖新链路。参考采用仍沿前述固定阅读范围，无新增第三方运行依赖或代码复制；本节不把计划审查当产品通过。

**审查状态与实际成果只记计划§7.14、§8.28、§8.31、§8.33及§8.34。** 本节的取舍不表示全部F/D/S/G已经安排实施；可选AI、编辑回传、跨来件语义候选、复杂期限重算和全部非业务维护仍按现行范围处理。用户继续负责浏览器验收，本执行组不把已归档截图算作后续代码通过。

### 3.27 收案与审批独立修复的参考取舍（2026-11-17）

本组只接续§3.25的F03/F04/F05/F06/F09及D01/D04；先检查其他分支、认领与共享文件，再发布计划并交叉审查。以下记录本次实际读取的固定来源及采用判断，不把原始观察表改成第二份进度表；实施和验收只在计划§7.14.5/§8.32更新。

| 用户任务与实际阅读 | 参考事实及本项目取舍 | 失败出口与验收 |
| --- | --- | --- |
| 阅读审批提交时间与继续办理；[LawLink审批records.ts，固定4736aa1](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/approval-permissions/records.ts)，全文94行；本地IntakeRevision、审批查询及详情调用链 | 原参考同样把receivedAt映射为submittedAt，属于已继承缺陷，不作为正确日期依据。采用本项目已有不可变送审轮次，不增加平行历史；入口以当前状态和实际身份共同判断 | 缺轮次明确未知，不造等待天数；冻结说明保留只读，修改沿撤回。首次/再次送审、null消费和状态矩阵分别验证 |
| 补齐收案与确认保存；[LawLink收案向导，固定4736aa1](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/app/(app)/intakes/_components/intake-wizard.tsx)，定点读完成度、身份折叠、步骤校验与确认摘要；本地schema/RHF实际输入 | 上游手写四项pendingNotes、折叠内standing和数量摘要也是本轮问题来源。保留现有向导、PartyCard及校验规则，错误从真实字段路径派生；本案地位外移，摘要直接读取当前各方与金额 | 修正输入后计数与红字同步；可选费用不制造新门槛，空白委托方仍阻断。长案名、多方、标的与律师费、0值分别验证 |
| 区分可选字段与真正缺项；[docassemble示例，固定36d7bd4](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/docx-template.yml)，全文110行 | 示例用required:False明确可选Unit/Zip，并保留人工输出确认。本项目只借鉴可选语义与人工确认，不引入其访谈引擎、模板平台或更改信用代码规则 | 以现有schema为准，不用参考项目另造必填项；可选feeType为空仍可继续 |
| 首次打开已有案由；本地cause-combobox、getCauseById及cause-scope | 现有按ID授权读取足够，原选择器只在打开全量库后同步名称。采用单条名称读取和按当前ID派生标签；这是本项目对已复现缺陷的设计判断，不宣称参考项目已有同一修复 | 失败/不存在保留原ID；A→B、清空与迟到响应不串值；同范围程序变化不误清空 |

编码前按当前安装的Next 16.4.6文档核对Server/Client与表单边界；组件复审参考React派生状态和effect依赖原则，只应用到本批状态一致性，不扩成性能专项。复用现有依赖及组件，无新增模型/迁移/依赖或整套UI改版。浏览器与律师专业验收由用户接续；mock服务、jsdom和静态复审分别记账，旧截图不作为新代码已验收的证明。

### 3.28 搜索具体来源与事实呈现的接续取舍（2026-11-17）

G15交付后按用户约束先查agent、认领和全部分支，在`43bea7a`确认S08/S09仍有实际断点。材料搜索已有精确返回值，丢失发生在入口；事实区实际两次渲染同一items。G09来源选择器和G03指示回链分别解决其他对象，不据已交付代码误关这两项。计划与状态统一见实施§7.14.4/§7.14.6。

| 用户任务与本次实际阅读 | 采用及不采用理由 | 失败出口与验收 |
| --- | --- | --- |
| 从事实就近查看原文；Kosmos固定`c6454fd`的[fact-row.html全文](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/templates/case/facts/fact-row.html)，[facts/views.py](https://github.com/Kosmos-Law/kosmos/blob/c6454fd5488c0d231e2b4756846f690c679586ca/apps/case/facts/views.py)定点505—570 | 事实行就近列原件/高亮，来源操作按实际fact关系、当前matter资料处理。采用单套呈现和确切原文入口；不移植Django对象，不据局部代码推定完整授权或把未知日期强制成有日期 | LexOrder保留自己的EvidenceItem/来源/历史/权限，受限项只占位；同条不重复，研究动作在实际可写争点上 |
| 打开确切引文；Counsel OS固定`c4f40f1`的[citation-location.ts全文](https://github.com/eigenlegal/counsel-os/blob/c4f40f1ffd40146531bcaa7f43e6877a733f92ca/runtime/src/workspace/citation-location.ts) | 精确定位基于已读范围，歧义和未读不能猜位置。采用固定身份失败不换目标；不复制其引用算法或代理框架 | 搜索沿既有getMaterialSource核当前权限和原run，失效明确反馈、不把摘要当原文；原件独立打开且搜索可返回 |

本地按已安装Next 16.4.6文档核对use-search-params及Server Action边界，沿用现有updateDossierLocation、Radix Dialog和来源服务。三轮计划纠正包括：保留Timeline过滤掉的受限占位、源弹层隔离父键盘、Office按实际支持格式分流、读取材料不新增案件写权门槛。没有运行参考项目、复制第三方源码或进行浏览器验收；独立原件另页、错误优先及保留搜索位置是本项目对当前断点的设计判断。S06/F01后续审定合同见§3.29，不以本节替代其独立范围。

S08/S09实际交付反馈见计划§8.35：复用了原件URL和现有reader，保留受限占位；root定点复审另外纠正失败状态说明及内部错误原文。两名独立代码reviewer确认无剩余阻断，34条服务/组件验证不等于真实HTTP、浏览器或律师验收。

### 3.29 模板作用域与期限精度的参考取舍（2026-11-17）

S06/F01在最新认领核对后分别由business/context核实际调用链，material及另一分工交叉审查，root第三轮核具体框架/SQL/消费者；计划见§7.14.7、技术合同见架构§6.11，以下阅读不等于实现。

| 实际读取与用户任务 | 采用判断及边界 |
| --- | --- |
| 轻量DOCX实际字段；本地docxtemplater 3.71.1的inspect-module/get-tags/scope-manager/modules/loop相关方法；[官方标签语义](https://docxtemplater.com/docs/tag-types/)及[FAQ占位符检查](https://docxtemplater.com/faq/) | 编译器已有结构化scope，空集合和反向块须沿实际渲染。用官方检查模块补当前准备层，不写第二解释器。variables改为索引、移除extra输入；存量错误并集不能证明额外必填，历史不回写。InspectModule现实际需要lodash，声明现有4.18.1运行依赖，不升级整套依赖 |
| 模板核对与可选字段；docassemble固定`36d7bd4`的[docx-template.yml全文](https://github.com/jhpyle/docassemble/blob/36d7bd4d27324a3cde2ea92ebd5afe074cdcfe2d/docassemble_base/docassemble/base/data/questions/examples/docx-template.yml)；j-lawyer固定`f523d14`的[模板对话框](https://github.com/jlawyerorg/j-lawyer-org/blob/f523d141327e5c74269dd9c71b54ae1c05a415a3/j-lawyer-client/src/main/java/com/jdimension/jlawyer/client/editors/files/AddDocumentFromTemplateDialog.java)生成/选模板/实际占位符及空值提示部分 | 采用实际字段、显式可选和人工核对，不移入访谈平台/Java UI。本地静态核25份内置定义：T16未消费的案由不是独立必填证据；专用T10归档目录自己注入数组，可空页码/备注保留。准备原值与补填值分开、同对象重核保稿、真实数组身份是本项目设计判断 |
| 明确期限日期及人工调整；ANQI固定`25efcf7`的[deadline-core.js](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/src/lib/deadline-core.js)日期键/UTC算术/due_on片段，及[case.js](https://github.com/zj-ai-lab/anqi/blob/25efcf7f2a3329f9ecdc092b3ced0e17a685c83a/public/js/case.js)editDeadlineDueByDate | 采用明确日期、调整理由和人工保护，不宣称ANQI已有DATE/DATETIME精度；不迁入variants/级联重算。LexOrder历史无精度证据故nullable不回填，新写显式精度并贯通实际责任/通知/显示 |
| 日历准确截止点；[RFC5545 §3.6.1](https://datatracker.ietf.org/doc/html/rfc5545#section-3.6.1)VEVENT日期与时点语义 | DATE-TIME无DTEND的事件在起始时点结束；沿现有ICS生成器明确表达截止点，避免默认增加一小时。不是新订阅/日历平台，UID及庭期原行为不改 |

本地已核Next 16.4.6的Forms/Server Action文档与当前Prisma、Zod、RHF输入边界，复用现有Input/Select/Dialog。F01审查纠正旧NULL编辑被默认值升格、未改值秒毫秒丢失、同值精度变更遗漏触发器、混合ScheduleItem误分类及真实逾期查询；排除无调用的旧KPI函数，保留同日已发送提醒不重发。S06审查纠正只修新上传、重核清草稿和以补填值作原值比较。F01只读实施准备另确认案件页头逾期数和MatterStickyBar/nextUncompletedDeadline为实际消费者，当时补入同一精度合同；随后实际实现与验证见计划§8.37。没有运行参考项目或移植第三方实质代码，不扩大维护/复杂期限重算/通用访谈范围。

S06实码反馈见计划§8.36：直接观察官方ScopeManager而非另写循环解释器；交叉审查发现边求值边补填会使后置根字段/对象不能影响前方条件，已改为完整context的无mutation观察并用精确顺序反例验证。剔除隐藏输入后只允许一次重新观察，后续相互影响须明确调整模板；保留纯归档渲染边界。根空白误锁、反向条件文案及客户端额外主体快照也在本批修正。4文件31条通过（含旧组合中的3条非S06用例）、真实PG7例、最终类型/lint及三方实码复审均有本次证据；没有浏览器、HTTP或专业验收。

F01实码反馈见计划§8.37：使用期限领域schema/草稿/格式与逾期函数贯通当前写入和真正消费入口，历史null不凭原钟点猜精度。三方实码审查纠正初始schema目标位置、固定交接清单的假时刻以及ICS准确期限误继承庭期2小时提醒；现有PENDING/SENT日级台账沿原去重，不以精度变更增加投递安排。规则建议DATE与人工随后明确时刻分开，保留原PENDING及人工日期保护。新业务迁移与实际PG反例、受控Action/Handler和组件均有本次证据；既有18迁移、历史时间及冻结快照保持原值。未把单元、数据库、参考阅读或日历字符串验证当作浏览器/专业验收。

### 3.30 全局任务等待与前置摘要的实施前研究（2026-11-17）

F01在745e8d5交付后重新检查认领和真实入口。G02不是缺任务工作流：TaskWaiting/TaskDependency、当前责任、办结检查、案内详情与待检查入口均已存在；缺口是首页五条和日程责任板未消费。readWorkRows还被提醒/写者/固定交接使用，不能为当前展示把动态摘要写入共用历史。G07三处续查窗口仍存在，但本轮只读预查、未认领或实施。

| 用户任务与实际阅读 | 本项目采用及不采用 |
| --- | --- |
| 跨案找等待或前置未完成任务；固定Frappe CRM `3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952` 的[Tasks.vue](https://github.com/frappe/crm/blob/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952/frontend/src/pages/Tasks.vue)，本轮实际读取列表/筛选、showTask、关联对象跳转与更新回调 | 采用原列表就近摘要、进入确切Task及返回后更新。完整筛选用LexOrder现有责任板，首页保持五条预览；不移植Vue/Frappe的视图引擎、看板、任意状态编辑或销售对象 |
| 完成前置守卫；固定ERPNext `19964b09a0045c014bb2f9ab66cd8703eb3722df` 的[task.py](https://github.com/frappe/erpnext/blob/19964b09a0045c014bb2f9ab66cd8703eb3722df/erpnext/projects/doctype/task/task.py)，本轮重读validate_status及完成检查片段 | 沿用本项目既有最终服务守卫，不把UI摘要当许可。明确不采用上游Cancelled也满足前置的规则；不引入自动排程、项目树或重复依赖投影 |

用户合理性和三轮审查纠正：无已知阻塞不等于有权办结；外部等待与前置可同时存在，检查日不改办案/法定日期；缺责任和异常关系不隐藏成正常。首页“本人任务”和责任板混合集合不同，使用准确入口文案/锚点，不伪造同一总数。当前正文权限独立于应急行可见，全文不随摘要泄露；筛选不清详情草稿、不提交隐藏勾选。root另读本地Next 16.4.6的Forms、page/searchParams Promise与revalidatePath，确认实际首页/和各业务修改出口，修复接线仍须实现及定点验证。没有运行参考产品、移植第三方实质代码或新增依赖；计划见§7.14.8，非测试通过证据。

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

现有初始化语义与隐私边界继续保留，仅为具体业务 API/静态检查使用必要的合成隔离环境；不启动安装、部署或恢复专项。

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
- 后续 SK10 交接监督、SK11 双语按已有需求推进；SK12 知识沉淀、B/E/F 深化及 C 通用机制保持最低优先级暂缓，不随阶段自动恢复。
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
