# 上游来源与许可记录

核验日期：2026-11-15。本文记录采用的基线、业务参考及许可边界。链接到 `main`、`dev` 或在线文档的内容可能变化；实际复制源码或锁定外部依赖时，必须补记具体提交或版本。本文不将业务参考自动登记为已复制源码，也不将项目介绍等同于运行验证。

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

## 2. 已检查的 LawLink 源码事实

| 固定版本来源 | 核实内容 | 对整合计划的约束 |
| --- | --- | --- |
| [prisma/schema.prisma](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/prisma/schema.prisma) | Client、Intake、Matter、Deadline、Document、EvidenceItem、Engagement、任务队列等模型 | 先复用主对象，按模块增加关系与记录 |
| [文档服务](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/documents/actions.ts) | Document 版本行、familyId、最新版本与新版本写入 | 引用绑定具体版本，不另建平行版本体系 |
| [期限规则函数](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/lib/deadline-rules.ts) | 期间计算等基础函数 | 复用现有计算边界；法律规则由实际法域与依据核定 |
| [期限重算保护](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/deadlines/recalc-guard.ts) | 已确认或调整期限不允许规则静默覆盖 | 进一步补来源事件和差异复核，不重建保护 |
| [任务队列](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/cron/queue.ts) | 去重、租约、失败重试和失败终态 | 复用队列，长 OCR 需任务拆分或续租 |
| [批量文档审查](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/src/server/ai/batch-review-matter.ts) | 逐件检查审查资格、批量范围与跳过信息 | 新 AI 流程保留材料级权限和覆盖信息 |
| [package.json](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/package.json) | 现有技术栈及 DOCX、PDF 相关依赖 | 先增强已有模板和文档能力 |
| [AGENTS.md](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/AGENTS.md) | 上游业务语义、维护规则及历史实施记录 | 历史通过结果不作为本次测试证明；字段存在不等于 UI 可用 |

特别保留的事实：`Task` 与 `Note` 当前要求 `matterId`；`Engagement.endedAt` 表示委托实际终止，`Intake/Matter.serviceEnd` 表示服务期限；`EvidenceItem` 已区分事实、主张、分析、争点与待核实；既有正文搜索、服务端期限复核和提醒台账不应被描述为缺失。

## 3. 参考项目及采用边界

| 项目 | 官方来源 | 核实的优势或现状 | 计划采用方式 |
| --- | --- | --- | --- |
| 案齐 ANQI | [仓库](https://github.com/zj-ai-lab/anqi)、[设计文档](https://github.com/zj-ai-lab/anqi/blob/main/docs/DESIGN.md)、[LICENSE](https://github.com/zj-ai-lab/anqi/blob/main/LICENSE) | 今日计划、程序事件、期限解释、人工保护、建议处理 | 从行为和验收场景独立实现；AGPL 源码不是默认直接复制对象 |
| Kosmos | [仓库](https://github.com/Kosmos-Law/kosmos)、[案件构建](https://kosmos.law/docs/dev/subsystems/case-building/)、[LICENSE](https://github.com/Kosmos-Law/kosmos/blob/dev/LICENSE) | 事实、文档、高亮、证人及其关联 | 以既有 EvidenceItem 增强原文和事实关系；不整体迁入 Django 应用 |
| Frappe CRM | [初始工作流程](https://docs.frappe.io/crm/setup-guide/your-first-steps-with-frappe-crm)、[任务](https://docs.frappe.io/crm/task)、[仓库](https://github.com/frappe/crm) | 客户活动与跟进，转化时保留笔记、邮件和任务 | 原生客户逻辑；不并行维护同一批客户身份 |
| Twenty | [仓库](https://github.com/twentyhq/twenty)、[LICENSE](https://github.com/twentyhq/twenty/blob/main/LICENSE) | 关联记录与工作流；许可按包和文件区分 | 先采用交互行为，组件复用逐包评估 |
| Paperless-ngx | [仓库](https://github.com/paperless-ngx/paperless-ngx)、[文档](https://docs.paperless-ngx.com/) | 扫描、索引、归档和文档处理 | 增强现有材料生命周期；整套服务按规模另评估 |
| RAGFlow | [仓库](https://github.com/infiniflow/ragflow)、[1.0.0 HTTP API](https://ragflow.io/docs/v1.0.0/http_api_reference)、[LICENSE](https://github.com/infiniflow/ragflow/blob/main/LICENSE) | 文档解析、上传、片段检索及删除接口 | 外部检索服务，锁定版本并通过适配层集成 |
| Counsel OS | [仓库](https://github.com/eigenlegal/counsel-os)、[LICENSE](https://github.com/eigenlegal/counsel-os/blob/main/LICENSE) | 案件上下文、记录版本引用、文书审阅；部分能力尚未完成 | 模块级审查后的代码候选，其余作为设计参考 |
| j-lawyer | [官方功能](https://www.j-lawyer.org/?page_id=22) | 案件表单、模板变量、文档与办案工作流 | 首期参考业务行为；具体源码按仓库和模块另核许可 |
| Docassemble | [仓库](https://github.com/jhpyle/docassemble)、[文书装配](https://docassemble.org/docs/documents.html)、[API](https://docassemble.org/docs/api.html) | 分支访谈、变量驱动 DOCX/PDF 装配、会话 API | 先增强既有字段和模板，复杂访谈后续服务化 |

### 当前项目状态对计划的影响

- Kosmos 默认源码分支为 `dev`。其[当前 AI 开发文档](https://kosmos.law/docs/dev/subsystems/ai/context/)说明，原生案件聊天引擎于 2026-10-29 退役，界面于次日退役，改由远程 MCP 对外提供案件访问。旧 README 或历史设计不能作为“完整聊天可直接迁入”的证明。
- Kosmos 的事实与高亮关系仍可参考。其某些材料处理路径会替换存储文件，本项目的设计要求保留原件，不能直接采用该行为。
- Counsel OS 官方仓库明确说明扫描 PDF OCR、全面原始法律研究等尚未完成；源代码运行路线仍需开发和测试验证。引用与文书模块只能作为审查候选，不能承诺复制即用。
- RAGFlow 1.0 的检索支持生成的知识汇总片段；首期适配拟将 `include_knowledge_compilation` 设为 `false`，以可追溯来源片段为基础。API 版本变更需要单独联调。

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
| RAGFlow | Apache-2.0 | 首选独立服务；分发或修改按许可保留必要信息 |
| Counsel OS、Docassemble | MIT | 可以评估代码复用，仍检查具体文件和依赖 |
| ANQI、Kosmos、Frappe CRM | AGPLv3 项目基础 | 默认独立实现所需业务行为；直接采用源码时按许可处理 |
| Paperless-ngx | GPLv3 项目基础 | 默认参考处理流程；实际分发、修改或集成另核边界 |
| Twenty | 主体 AGPL，指定包 MIT，标记文件商业许可 | 逐文件和包判断，不能统一按 MIT 或 AGPL 处理 |
| j-lawyer | 需按选中的具体仓库和模块核对 | 当前仅登记行为参考，不登记已采用源码 |

改变量名、翻译到另一种语言或稍作改写，不会自动将复制的实现变成独立实现。独立服务和 API 是工程边界，不能仅凭调用方式断言没有许可证义务。修改版 AGPL 的远程交互还需核对其第 13 条要求。[GNU AGPL 正文](https://www.gnu.org/licenses/agpl-3.0.html)

每次实际移植代码都补充以下记录：来源仓库与固定提交、具体文件或模块、许可、依赖、修改说明、保留通知、验证场景。源代码许可义务与客户数据处理分别审查，源码引用不会授权复制客户数据。

## 6. 数据与验证记录要求

- 默认初始化保留空白业务数据，只建立管理员和系统基础配置、规则及空白模板。
- 合成客户、案件、账务和文件仅由独立验收脚本生成，在独立验收环境使用，明确标注合成来源。
- 不提交密钥、运行数据库、私有附件、备份、模型原始请求响应或带身份信息的截图。
- 上游历史文档中的测试数量、安全审计结论或部署结果仅代表其对应时间和环境，不能转写为本分支已验证。
- 本次验证记录必须给出实际提交、环境、执行命令或交互场景、结果以及未覆盖范围。只完成源码阅读时，记录为源码核实。
