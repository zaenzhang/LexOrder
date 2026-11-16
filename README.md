# 律序 · LexOrder

面向个人律师和小团队、以法律事项为中心的工作台。让上下文可恢复、重要依据可核查、责任与交付可追踪。

**事有经纬，案有始终。**

项目仓库：[zaenzhang/LexOrder](https://github.com/zaenzhang/LexOrder)。代码基于 LawLink v2.0.1，保留原项目 MIT 许可及版权。

## 当前状态

现有源码包含客户与收案、案件与程序、材料与证据、期限与任务、财务、审批及归档业务。LexOrder 已增加客户沟通与跟进、客户合并，以及法规/案例服务适配、执行文书模板、传票首页解析和独立调度入口。实际采用与验证范围见[实施计划](docs/WORKBENCH_PLAN.md#8-交接完成范围证据与未覆盖项)。

**当前唯一交付目标是 Server 部署版，Personal 直接搁置且不作为门禁。M2 业务预览已完成。** 已实现持久原件摄入/恢复、后台解析与覆盖、多来源证据修订/核对、版本化事项上下文与授权 Brief、客户连续记录、事实日期时间线、本地材料读取检查及首次创建重试幂等。原七条条件的真实数据库、生产构建和页面业务证据见[实施计划 §8.9](docs/WORKBENCH_PLAN.md#89-m2-最终收口账本2026-11-16)。AI/OCR/RAGFlow/法律 MCP 独立可选，未配置不阻止普通业务；本地输入检查不调用模型。

首条工作流程：目标与客户指示 → 材料 → 事实与争点 → 带来源草稿 → 律师确认 → 行动与客户跟进 → 实际交付与归档。

## 当前交付：Server 部署版

在现有 Next.js / TypeScript / Prisma / PostgreSQL 与 LawLink 页面上开发，保留团队认证、材料权限、财务、审批和归档规则。Personal 设计、代码及试验记录保留，但不列为后续必做，也不影响 Server 发布。

| 范围 | 当前策略 |
| --- | --- |
| 核心运行 | Web、PostgreSQL、私有材料存储与唯一调度所有者 |
| 默认处理/搜索 | 内置解析，现有 PostgreSQL 正文检索；无外部账号仍可办理业务 |
| 可选服务 | RAGFlow、AI、OCR、嵌入/重排、法律数据库/MCP；默认按需启用 |
| 配置与失败 | 未配置、无权限、超时、限流及无结果分别显示；故障只影响所调用能力 |
| 法律 MCP | 官方机构预设与自定义接入；端点、认证和来源有登记，凭据服务端保存 |
| 交付 | Server 固定镜像/部署配置、安装升级与恢复说明；不等待个人安装包 |

部署版 M2 业务预览已收口。M3 当前保留研究、既有方案/指示、轻量模板/人工复核、轻量同案依赖/等待、人工简报和实际交付；M4 完成固定发行/升级/整套恢复。知识沉淀、结构化比较、深化期限重算、自动客户简报及通用访谈机制暂缓至最低优先级，不作为门禁、不自动安排恢复。参考依据及范围见[实施计划 §7.11](docs/WORKBENCH_PLAN.md#711-m3-详细执行计划与审查2026-11-16)。界面专项继续收口，性能只观察。

## 项目文档

`docs/` 只维护四份主文档与一个[导航页](docs/README.md)。开发、部署和恢复说明并入架构文档，历史结果并入实施计划；旧报告、旧图稿和过程版本从 Git 历史查阅。

| 主文档 | 内容 |
| --- | --- |
| [产品需求、技能与界面](docs/PRODUCT_REQUIREMENTS_ACCEPTANCE.md) | RQ01—RQ20、SK01—SK12、界面和场景验收 |
| [架构、发布与审查](docs/REFACTOR_DESKTOP_TEAM_RAG.md) | Server、可选服务、搁置设计、开发部署与恢复 |
| [实施计划与交接](docs/WORKBENCH_PLAN.md) | M0—M4 当前范围、W/子项/AC 编号追踪、暂缓清单、证据与下一步；编号保留不等于全部必做 |
| [研究与决策依据](docs/RESEARCH_AND_DECISIONS.md) | 项目来源、固定版本、采用边界及全球律所职业能力资料 |

协作入口：[AGENTS.md](AGENTS.md)、[贡献说明](CONTRIBUTING.md)、[变更记录](CHANGELOG.md)、[安全说明](SECURITY.md)、[社区准则](CODE_OF_CONDUCT.md)。

## 源码运行

以下用于全新、独立的开发或验收环境；当前页面仍使用 Server 登录。推荐与仓库 CI/容器一致的 Node.js 22、npm 和 PostgreSQL 16。命令适用于 Linux、macOS 或 WSL。

```bash
git clone https://github.com/zaenzhang/LexOrder.git
cd LexOrder
npm ci
```

仅在没有私有 `.env` 时从 `.env.example` 创建。设置自己的数据库连接、初始管理员及强密码；分别生成 `NEXTAUTH_SECRET` 和 `STORAGE_ENCRYPTION_KEY`。已有环境沿用原密钥。配置与准确操作边界见[架构第 11 节](docs/REFACTOR_DESKTOP_TEAM_RAG.md#11-当前源码的开发部署与恢复)。

已有独立 PostgreSQL 时：

```bash
npm run prisma:generate
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

若使用仓库的开发数据库容器，先将 `.env` 中 `DATABASE_URL` 与 `POSTGRES_*` 配置对应，再执行 `docker compose up -d db`。首次 seed 只建立管理员、字典、规则、配置及内置模板；已有实例更新使用迁移与 `npm run templates:sync`，不把重跑 seed 当作改密码或升级权限的办法。

没有 Docker 时，可使用隔离的云开发运行器：

```bash
npm ci --prefix tools/cloud-dev
npm run prisma:generate
npm run build
node tools/cloud-dev/run.mjs serve
```

该运行器管理开发数据库并执行迁移/初始化，要求专用 loopback 数据库地址、显式端口及强密码；默认关闭调度和自动备份。它是开发工具，详细配置及隔离验收见[架构第 11.2 节](docs/REFACTOR_DESKTOP_TEAM_RAG.md#112-无-docker-的云开发与隔离验收)。

## 验证与运行维护

业务代码变更按影响范围执行：

```bash
npm run lint
npm run typecheck
npm run prisma:validate
npm run test:run
npm run build
```

`tools/workbench-m1` 是独立的历史原型工具；需要检查其 TypeScript 时，先执行 `npm ci --prefix tools/workbench-m1`，再执行 `npm run typecheck --prefix tools/workbench-m1`。Server 的构建不需要安装该工具的依赖。

数据库与浏览器流程分别验证；未配置真实验收库时，部分集成套件会跳过。文档修改核对引用、当前事实和变更范围，不把历史测试数量作为新能力已通过的证明。

生产源码可用 `npm run start:with-cron` 联合启动 Web 与一个调度 worker；已有进程管理也可分别启动。数据库迁移不由该命令代办，同一实例只能有一个调度所有者。当前 Compose 尚未包含规划中的 RAGFlow 配套部署。

### 备份

备份必须同时覆盖业务数据库、原件、必要配置和独立保管的文件密钥，并在隔离环境恢复验证。`npm run backup:now` 依赖可用的 `pg_dump`；当前容器的 `backups` 命名卷不等于异地副本。升级、定时任务、外部检索/OCR 配置与备份恢复统一见[架构第 11 节](docs/REFACTOR_DESKTOP_TEAM_RAG.md#11-当前源码的开发部署与恢复)。

## 许可与数据

项目使用 [MIT LICENSE](LICENSE)，保留 LawLink 原作者版权和实际二开来源。参考项目的许可与采用方式见[研究依据](docs/RESEARCH_AND_DECISIONS.md#5-许可采用规则)。

公开仓库不携带真实案件、客户资料、业务数据库、附件、密钥或备份。模型生成形成待核对候选，专业判断、正式确认和实际交付由律师负责。系统管理、业务读取、材料处理、财务、审批与导出分别授权。

## 参考项目清单

采用登记与详细模块来源统一见[研究与决策依据](docs/RESEARCH_AND_DECISIONS.md) §3。下表明确区分源码合入、组件/服务接入及行为参考；引用项目不等于已具有其全部功能。

| 项目与固定来源 | 采用内容 | 当前关系 |
| --- | --- | --- |
| [LawLink v2.0.1](https://github.com/lawflow-boop/LawLink/tree/4736aa100515bb15f47443cdb6b0ae65745e5fff) | 客户、事项、材料、财务、审批、归档和原界面 | **实际源码基线**，`4736aa1` |
| [appleoppa/LawLink](https://github.com/appleoppa/LawLink/tree/535a3531aa79edea1c1c6524fd6748d630170718) | 法规/案例适配、传票、执行模板与独立调度 | **通用源码已吸收**，来源 `535a353` |
| [PGlite](https://pglite.dev/docs/about) | Personal 嵌入式业务库 | **0.5.16 历史 Linux 原型**；个人版搁置 |
| [LanceDB](https://github.com/lancedb/lancedb/tree/3936a8b3bcce8f8e073f3ec6a47e4ca4d3381b92/nodejs/lancedb) | 内置检索组件研究、词法/向量过滤 | **0.41.0 SDK/适配原型已有**，真实模型链路待验证 |
| [RAGFlow v1.0.0](https://github.com/infiniflow/ragflow/tree/db1cd5929a7885a3074547791f5ecc4d2f891739) | Server 解析、索引与检索服务 | **可选服务**，适配/部署准备已有；真实服务未验证 |
| [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm/tree/4d09fa5f730698d39f1d783e47316744b260a700) | 双形态、工作区、模型配置与内置组件 | 已研究的行为/工程参考，`4d09fa5` |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio/tree/6b408118141472ff472a1824f300b5a8cbdf968d) | 桌面资源、目标原生包、单实例及生命周期 | 已研究的工程参考，`6b40811`；随个人版搁置，保留既有研究 |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx/tree/4610171a94e5932e85a80e480032e397cdb6f309) | 原件、处理状态、逐件失败和恢复 | 已用于契约/验收设计的行为参考，`4610171` |
| [Kosmos](https://github.com/Kosmos-Law/kosmos/tree/c6454fd5488c0d231e2b4756846f690c679586ca) | 原文位置、事实关系及 OCR 覆盖 | 已用于来源/覆盖设计的行为参考，`c6454fd` |
| [Frappe CRM](https://github.com/frappe/crm/tree/3509bd4d762224aa7e8ca1bc74d9a0ed2e38e952) | 对象导航、列表/详情、客户活动与跟进 | 后续全局交互主参考，`3509bd4`；UI 改版后置 |
| [ERPNext](https://github.com/frappe/erpnext/tree/19964b09a0045c014bb2f9ab66cd8703eb3722df/erpnext/projects/doctype/task) | 轻量任务前置关系、环/完成检查与详情选择 | 本轮固定源码研究，采用业务设计；不引入 ERP/自动排程平台 |
| [Twenty](https://github.com/twentyhq/twenty/tree/26fa97ebc8a5773e842ba0d2f01e0b24bed6e7d0) | 关联记录与筛选 | 已比较的辅助参考，`26fa97e` |
| [案齐 ANQI](https://github.com/zj-ai-lab/anqi) | 今日计划、程序事件、期限解释与人工保护 | 后续行为参考，尚未合入 |
| [诉讼可视化](https://github.com/MiaoQichuan/new-litigation-visualization) | 多来源事实、矛盾和时间线 | 后续行为/数据关系参考，尚未合入 |
| [Counsel OS](https://github.com/eigenlegal/counsel-os) | 案件上下文、覆盖、版本引用与文书复核 | 后续行为/工程参考，尚未合入 |
| [Docassemble](https://github.com/jhpyle/docassemble) / [j-lawyer](https://www.j-lawyer.org/?page_id=22) | 条件字段、模板变量、文书装配 | 后续业务参考，尚未合入 |
| [Clio](https://www.clio.com/features/case-management/) | 客户获取、案件办理与服务交付 | 商业产品行为参考 |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 界面、业务与持久层边界 | 架构参考，不引入 Rust 重写 |
| [元典](https://open.chineselaw.com/mcp-config/) / [北大法宝](https://mcp.pkulaw.com/docs) / [威科](https://mcp.wkinfo.com.cn/docs) / [聚法](https://www.jufaai.com/agent/guide) | 官方法律 MCP 目录、自定义远程接入及原元典 API | 四项 MCP 预设、加密配置和管理员手动只读检索已有；全部默认关闭，真实提供商/权益未验证 |
