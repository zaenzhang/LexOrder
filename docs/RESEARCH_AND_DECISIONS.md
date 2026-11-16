# LexOrder 研究与决策依据

核查日期：2026-11-16。本文合并原项目来源/许可和全球律所招聘研究；保留来源、固定版本、适用范围、时点与采用边界。产品行为见[需求与技能](PRODUCT_REQUIREMENTS_ACCEPTANCE.md)，技术取舍与试验见[架构与发布](REFACTOR_DESKTOP_TEAM_RAG.md)，不另开按话题拆分的研究文档。

## 当前研究结论与使用方式

| 证据类别 | 已完成的工作 | 形成的决定 | 不能据此宣称 |
| --- | --- | --- | --- |
| 用户需求 | 整理事项工作流及本轮持续补充 | 双版本：Personal 内置 RAG、Server RAGFlow；均接独立模型 API、个人无认证、克制界面；性能不设门禁 | 用户已接受未展示的其他限制 |
| 既有项目 | 固定 LawLink/二开提交，核对数据与服务，保留实际移植记录 | 复用 TS、事项与财务/审批链，逐步补材料和交付 | 所有参考项目的能力都已移入 |
| 桌面/存储 | 官方技术资料、源码耦合盘点、固定版本隔离运行 | 精简 Next/Node；PGlite 为个人库优先实现候选，SQLite 暂不并行迁移 | 性能优劣、全量 PG 兼容或 Windows 发行已验证 |
| RAG 后端 | 核查 RAGFlow 1.0.0 正式发布、HTTP API、部署与共享权限资料 | 按用户决定：Personal 内置适配以 LanceDB 为首个目标，Server 通过 HTTP 接入 RAGFlow；共用业务/技能/引用 | 两个适配已实现、RAGFlow 全部功能已开放、检索质量或性能比较已完成 |
| 专业能力 | 16 个主要官方来源，13 个国家/地区及补充材料 | SK01—SK12 的输入、步骤、成果、人工复核与评测 | 全球排名、每国穷尽调查、名所背书或 AI 执业资格 |

研究采用“观察到的行为 → 输入输出与规则 → LexOrder 设计 → 场景验证”。来源事实、产品推论和已运行结果分别标明。动态页面不自动等于固定版本能力；新增依赖固定版本和完整性，实际采用源码时登记文件与许可。招聘页面状态按核查当日记录，后续实现时复核需要更新的来源。

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

作者 PGG 专用导入／同步脚本、旧库迁移补偿、未接线的保全组件、作者机器路径及无效测试未作为运行代码移植。逐项范围、适配理由和当前验证见[二开吸收记录](FORK_INTEGRATION_20261116.md)。元典法规检索协议核对 [rh_fg_search 官方文档](https://open.chineselaw.com/api-docs/rh_fg_search.html)；响应片段只作为摘要展示。cncases 是外部服务协议适配，未将其服务器源码或裁判文书数据加入本仓库。

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
| RAGFlow | [v1.0.0 正式发布](https://github.com/infiniflow/ragflow/releases/tag/v1.0.0)、[1.0 HTTP API](https://ragflow.io/docs/v1.0.0/http_api_reference)、[部署](https://ragflow.io/docs/v1.0.0/)、[共享权限](https://ragflow.io/docs/v1.0.0/guides/team/resource_sharing/resource_sharing_and_permissions) | 已有解析/索引/检索平台；正式版及权限语义有明确边界 | Server 已选定后端，首个联调目标 1.0.0 并锁定镜像摘要；Personal 保持内置，业务与引用由 LexOrder 管理，接入仍待实施 |
| Counsel OS | [仓库](https://github.com/eigenlegal/counsel-os)、[LICENSE](https://github.com/eigenlegal/counsel-os/blob/main/LICENSE) | 案件上下文、记录版本引用、文书审阅；部分能力尚未完成 | 独立实现覆盖记录、来源锚点和成果版本流程 |
| new-litigation-visualization | [仓库](https://github.com/MiaoQichuan/new-litigation-visualization) | 多来源事实、冲突并列、事实时间线和可视化 | 增强 EvidenceItem 和材料引用，不建立平行事实库 |
| AppFlowy | [仓库](https://github.com/AppFlowy-IO/AppFlowy)、[CodeMap](https://docs.appflowy.io/docs/documentation/software-contributions/architecture/frontend/frontend/codemap) | 界面、Rust 核心与持久层的工程边界 | 参考模块划分；不据其语言选择启动 LexOrder 全面迁移 |
| j-lawyer | [官方功能](https://www.j-lawyer.org/?page_id=22) | 案件表单、模板变量、文档与办案工作流 | 首期参考业务行为；具体源码按仓库和模块另核许可 |
| Docassemble | [仓库](https://github.com/jhpyle/docassemble)、[文书装配](https://docassemble.org/docs/documents.html)、[API](https://docassemble.org/docs/api.html) | 分支访谈、变量驱动 DOCX/PDF 装配、会话 API | 先增强既有字段和模板，复杂访谈后续服务化 |

### 当前项目状态对计划的影响

- 本轮初始评估为 `97867e2`，提交前已对齐 main `2997b54754565081271ca4b66139949d310e2fe0`。appleoppa 的通用功能、迁移、权限与调度适配已合入；本轮保留其源码及来源记录，进一步区分局部传票解析、15 分钟启动补扫与尚待建设的通用 OCR、完整休眠/数据恢复能力。
- Kosmos 默认源码分支为 `dev`。其[当前 AI 开发文档](https://kosmos.law/docs/dev/subsystems/ai/context/)说明，原生案件聊天引擎于 2026-10-29 退役，界面于次日退役，改由远程 MCP 对外提供案件访问。旧 README 或历史设计不能作为“完整聊天可直接迁入”的证明。
- Kosmos 的事实与高亮关系仍可参考。其某些材料处理路径会替换存储文件，本项目的设计要求保留原件，不能直接采用该行为。
- Counsel OS 官方仓库明确说明扫描 PDF OCR、全面原始法律研究等尚未完成；源代码运行路线仍需开发和测试验证。引用与文书模块只能作为审查候选，不能承诺复制即用。
- 用户随后明确采用 **Personal 内置、Server RAGFlow**，覆盖此前“两版内置、RAGFlow 可选”的研究建议。理由是按交付形态分工：个人保持独立，部署版采用现成解析/检索平台；这是产品与工程决定，不是已经运行出的质量或性能比较结论。RAGFlow 1.0.0 为本次固定联调目标，未安装、未联调。
- RAGFlow 1.0 检索的知识汇总默认开启；文档筛选不证明数据集汇总的全部来源获准。因此 Server 首发**明确设置** `include_knowledge_compilation: false`，由 LexOrder 先确定授权材料、再核对返回片段。官方普通 retrieval API 的 `use_kg: true` 不代表启用多跳图检索；共享 Team 规则也不能替代案件权限。实现边界及验收见[架构第 3 节](REFACTOR_DESKTOP_TEAM_RAG.md#3-rag-架构personal-内置server-使用-ragflow)。
- Server 首发提供固定开源版本的配套部署配置，也允许管理员接入已验证兼容的独立实例；不以购买 Cloud 为前置。[官方 FAQ](https://ragflow.io/docs/v1.0.0/faq)说明 Cloud 功能和 REST API 可用性受服务方案影响，不把托管演示、DEV/main 或旧版功能混作该固定版本的交付承诺。个人独立版不依赖这些远程服务。
- AnythingLLM 的默认内置检索、Cherry 的本地模型证明可以把组件交给应用管理，不证明 LexOrder 已完成集成或达到相同效果。中文法律材料仍需独立验收。
- 技术官方来源与本轮隔离存储试验统一见[架构依据](REFACTOR_DESKTOP_TEAM_RAG.md#10-官方资料与代码依据)及第 2 节。Personal 优先精简 Next/Node + PGlite，Server 保留现有 PG；固定版本的兼容证据不等于正式发行完成。性能暂不作为门禁，原资源阈值已撤销。

## 4. 法律数据库来源

| 提供商 | 官方入口 | 计划关注点 |
| --- | --- | --- |
| 元典 | [开放平台](https://open.chineselaw.com/)、[法规详情](https://open.chineselaw.com/api-docs/rh_fg_detail.html) | 从既有代码扩展；`refer_date` 定位指定日期版本；记录权限与调用结果 |
| 北大法宝 | [MCP/CLI 官方入口](https://mcp.pkulaw.com/) | 后续按实际接口权益和支持能力接入 |
| 威科 | [MCP 文档](https://mcp.wkinfo.com.cn/docs) | 后续按实际鉴权、权限及工具能力接入 |

接口账号未配置或权益未确认时，不声明法库已接通。网页订阅、API、全文缓存、向量化和再展示是不同授权事项。适配器应声明能力，不把“不支持”“无权限”“限流”解释为“没有法律依据”。

## 5. 许可采用规则

| 来源 | 核实到的项目许可 | 本分支规则 |
| --- | --- | --- |
| LawLink | MIT | 保留版权和许可，作为实际源代码基线 |
| RAGFlow | Apache-2.0 | 按 Server 已定路线作为独立服务接入，实际集成待实施；分发或修改按许可保留必要信息 |
| Counsel OS、Docassemble | MIT | 可以评估代码复用，仍检查具体文件和依赖 |
| ANQI、Kosmos、Frappe CRM | AGPLv3 项目基础 | 默认独立实现所需业务行为；直接采用源码时按许可处理 |
| Paperless-ngx | GPLv3 项目基础 | 默认参考处理流程；实际分发、修改或集成另核边界 |
| Twenty | 主体 AGPL，指定包 MIT，标记文件商业许可 | 逐文件和包判断，不能统一按 MIT 或 AGPL 处理 |
| j-lawyer | 需按选中的具体仓库和模块核对 | 当前仅登记行为参考，不登记已采用源码 |

改变量名、翻译到另一种语言或稍作改写，不会自动将复制的实现变成独立实现。独立服务和 API 是工程边界，不能仅凭调用方式断言没有许可证义务。修改版 AGPL 的远程交互还需核对其第 13 条要求。[GNU AGPL 正文](https://www.gnu.org/licenses/agpl-3.0.html)

每次实际移植代码都补充以下记录：来源仓库与固定提交、具体文件或模块、许可、依赖、修改说明、保留通知、验证场景。源代码许可义务与客户数据处理分别审查，源码引用不会授权复制客户数据。

## 6. 数据与验证记录要求

- 默认初始化保留空白业务数据。Personal 只建立本机操作者和必要配置，无登录账号；Server 按既有部署流程建立管理员、权限与基础配置。
- 合成客户、案件、账务和文件仅由独立验收脚本生成，在独立验收环境使用，明确标注合成来源。
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
