# LexOrder 变更记录

此处维护 LexOrder 的实际变更摘要。源码提交、方案决定与正式发行分别记录；继承的包版本不代表已完成双版本重构发行。更早的 LawLink 变更见[固定上游记录](https://github.com/lawflow-boop/LawLink/blob/4736aa100515bb15f47443cdb6b0ae65745e5fff/CHANGELOG.md)。

## 2026-11-16：文档清理

- `docs/` 收敛为四份主文档和导航页；删除旧 PRD、模块方案、UI 图稿、Word 报告、历次审计、旧发布说明及重复运维文档。
- 必要运行与配置说明并入架构第 11 节；验证证据归入实施计划，以固定历史链接保留追溯。
- 根 README 改为当前 LexOrder 说明，最下方集中列出参考项目与采用状态；AGENTS、贡献说明及安全说明同步收敛。
- 历史财务演练脚本复用现有归档 SQL，生成输出移到 `.runtime/`；不改变迁移 SQL、数据库模型或业务规则。

## 2026-11-16：架构与主文档

- [1e1a646](https://github.com/zaenzhang/LexOrder/commit/1e1a6467c43667a36c6c23da82589a3329e6091b)：经三轮计划审查，将第一阶段 M0—M4 细化为 36 个子任务和 16 组验收场景；本次清理完整保留这批并行更新。
- [6902322](https://github.com/zaenzhang/LexOrder/commit/690232270b46e1f1b105df11bdff167fe7afb80d)：确定 Personal 内置 RAG、Server 使用 RAGFlow，更新需求、任务与发布验收；实际接入待实施。
- [5322a74](https://github.com/zaenzhang/LexOrder/commit/5322a74195eaf0f34fd78d3b4245326d72d0e155)：归并四份主文档与固定 PGlite/Prisma 隔离兼容试验；这项试验不代表个人应用或安装包已完成。
- 明确个人无用户认证、两版独立模型 API、内容优先界面，以及性能暂不作为门禁。

## 2026-11-16：吸收二开

[2997b54](https://github.com/zaenzhang/LexOrder/commit/2997b54754565081271ca4b66139949d310e2fe0) 吸收 appleoppa/LawLink 的法规与案例服务适配、执行模板、传票首页处理、独立 worker/监督器和备份入口，并补齐 LexOrder 权限、配置、模板与调度适配。真实供应商、通用 OCR、成功备份恢复与完整浏览器流程仍有待验范围。

## 2026-11-15：首次交付与维护

- 建立 LexOrder 用户仓库及云开发运行器；增加客户归属、沟通、跟进、合并及其事务、幂等和权限保护。
- 处理首次 CI 暴露的依赖问题，完成 Zod 4 兼容调整与定向回归。
- 历次测试和运行证据、准确环境及未覆盖项统一见[实施计划第 8 节](docs/WORKBENCH_PLAN.md#8-交接完成范围证据与未覆盖项)。
