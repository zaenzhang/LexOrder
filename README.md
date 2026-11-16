# 律序 · LexOrder

面向个人律师和小团队、以法律事项为中心的工作台。让上下文可恢复、重要依据可核查、责任与交付可追踪。

**事有经纬，案有始终。**

项目仓库：[zaenzhang/LexOrder](https://github.com/zaenzhang/LexOrder)。代码基于 LawLink v2.0.1，保留原项目 MIT 许可及版权。

## 当前状态

现有源码包含客户与收案、案件与程序、材料与证据、期限与任务、财务、审批及归档业务。LexOrder 已增加客户沟通与跟进、客户合并，以及法规/案例服务适配、执行文书模板、传票首页解析和独立调度入口。实际采用与验证范围见[实施计划](docs/WORKBENCH_PLAN.md#8-交接完成范围证据与未覆盖项)。

**重构方向已经确定，个人安装包、两版 RAG 集成与新技能执行器仍待实现。** 当前源码运行方式对应已有部署系统，不能当作已发布的 Personal 或完整 Server RAG 发行包。

首条工作流程：目标与客户指示 → 材料 → 事实与争点 → 带来源草稿 → 律师确认 → 行动与客户跟进 → 实际交付与归档。

## 两种发行形态

| 项目 | Personal：本地个人版 | Server：部署版 |
| --- | --- | --- |
| 使用 | 安装后直接打开本地工作区 | 管理员部署，成员通过浏览器使用 |
| 用户认证 | 无注册、登录、账号或用户管理 | 保留团队认证、人员与业务权限 |
| 业务与存储 | 精简 Next/Node，共用 TS 业务；PGlite 为个人库优先方向 | Next.js / TypeScript / Prisma / PostgreSQL |
| RAG | 内置 RAG，LanceDB 为首个实现目标 | RAGFlow，纳入正式部署交付 |
| 模型 | 可连接独立模型 API，不默认捆绑生成大模型 | 同样可连接独立模型 API |
| 交付 | 个人安装包 | 应用镜像、配套 RAGFlow 与依赖配置、升级恢复说明 |

两版共用案件、材料版本、技能、引用与确认流程。每个正式 release 同时提供两种可用产物；个人独立与完全离线分别验收。**性能暂不作为门禁。** 界面以正文、材料、依据和下一步为主，减少装饰。

## 项目文档

`docs/` 只维护四份主文档与一个[导航页](docs/README.md)。开发、部署和恢复说明并入架构文档，历史结果并入实施计划；旧报告、旧图稿和过程版本从 Git 历史查阅。

| 主文档 | 内容 |
| --- | --- |
| [产品需求、技能与界面](docs/PRODUCT_REQUIREMENTS_ACCEPTANCE.md) | RQ01—RQ20、SK01—SK12、界面和场景验收 |
| [架构、发布与审查](docs/REFACTOR_DESKTOP_TEAM_RAG.md) | Personal/Server、RAG、模型 API、存储试验、开发部署与恢复 |
| [实施计划与交接](docs/WORKBENCH_PLAN.md) | 第一阶段 M0—M4、W01—W17 及子任务、16 组验收场景、当前证据与下一步 |
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

数据库与浏览器流程分别验证；未配置真实验收库时，部分集成套件会跳过。文档修改核对引用、当前事实和变更范围，不把历史测试数量作为新能力已通过的证明。

生产源码可用 `npm run start:with-cron` 联合启动 Web 与一个调度 worker；已有进程管理也可分别启动。数据库迁移不由该命令代办，同一实例只能有一个调度所有者。当前 Compose 尚未包含规划中的 RAGFlow 配套部署。

### 备份

备份必须同时覆盖业务数据库、原件、必要配置和独立保管的文件密钥，并在隔离环境恢复验证。`npm run backup:now` 依赖可用的 `pg_dump`；当前容器的 `backups` 命名卷不等于异地副本。升级、定时任务、外部检索/OCR 配置与备份恢复统一见[架构第 11 节](docs/REFACTOR_DESKTOP_TEAM_RAG.md#11-当前源码的开发部署与恢复)。

## 许可与数据

项目使用 [MIT LICENSE](LICENSE)，保留 LawLink 原作者版权和实际二开来源。参考项目的许可与采用方式见[研究依据](docs/RESEARCH_AND_DECISIONS.md#5-许可采用规则)。

公开仓库不携带真实案件、客户资料、业务数据库、附件、密钥或备份。模型生成形成待核对候选，专业判断、正式确认和实际交付由律师负责。系统管理、业务读取、材料处理、财务、审批与导出分别授权。

## 参考项目清单

以下列出代码来源、拟采用组件及设计参考；采用状态按本仓库实际实现记录，不将参考对象的全部功能视为已集成。

| 项目 | 参考或采用方向 | 当前关系 |
| --- | --- | --- |
| [LawLink](https://github.com/lawflow-boop/LawLink/tree/4736aa100515bb15f47443cdb6b0ae65745e5fff) | 客户、事项、材料、财务、审批与归档 | 实际代码基线：v2.0.1，固定提交 `4736aa1` |
| [appleoppa/LawLink](https://github.com/appleoppa/LawLink/tree/535a3531aa79edea1c1c6524fd6748d630170718) | 法规/案例适配、传票、执行模板与独立调度 | 通用二开已吸收，来源固定提交 `535a353` |
| [RAGFlow](https://github.com/infiniflow/ragflow/releases/tag/v1.0.0) | Server 解析、索引、检索与重排 | 已定后端，接入与验收待实施 |
| [LanceDB](https://lancedb.github.io/lancedb/js/) | Personal 内置检索组件 | 首个实现目标，待接入与验证 |
| [PGlite](https://pglite.dev/docs/about) | Personal 嵌入式业务库 | 优先方向；有界兼容试验通过，应用适配待完成 |
| [AnythingLLM](https://docs.anythingllm.com/installation-desktop/overview) / [Cherry Studio](https://github.com/CherryHQ/cherry-studio) | 双交付、组件托管、模型配置与召回检查 | 行为与工程参考 |
| [案齐 ANQI](https://github.com/zj-ai-lab/anqi) | 今日计划、程序事件、期限解释与人工保护 | 行为参考 |
| [Kosmos](https://github.com/Kosmos-Law/kosmos) / [诉讼可视化](https://github.com/MiaoQichuan/new-litigation-visualization) | 原文高亮、多来源事实、矛盾和时间线 | 行为与数据关系参考 |
| [Counsel OS](https://github.com/eigenlegal/counsel-os) | 案件上下文、来源锚点、覆盖与文书版本 | 行为与工程参考 |
| [Frappe CRM](https://github.com/frappe/crm) / [Twenty](https://github.com/twentyhq/twenty) | 客户活动、跟进和关联记录 | 行为参考 |
| [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) | 原件、派生处理、索引归档与失败恢复 | 行为与工程参考 |
| [j-lawyer](https://www.j-lawyer.org/?page_id=22) / [Docassemble](https://github.com/jhpyle/docassemble) | 案件表单、模板变量、条件访谈与文书装配 | 行为与工程参考 |
| [AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 界面、业务与持久层边界 | 工程参考 |
| [Clio](https://www.clio.com/features/case-management/) | 客户获取、案件办理与服务交付 | 商业产品，行为参考 |
| [元典](https://open.chineselaw.com/) / [北大法宝](https://mcp.pkulaw.com/) / [威科](https://mcp.wkinfo.com.cn/docs) | 获授权法律数据库与检索接口 | 商业数据服务；元典已有适配代码，真实权益/接口待联调，其余为接入候选 |

详细来源、固定版本、许可和采用边界见[研究与决策依据](docs/RESEARCH_AND_DECISIONS.md)。
