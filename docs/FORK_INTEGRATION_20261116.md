# LawLink 二开吸收记录

日期：2026-11-16。通用功能已移植到 LexOrder；验证范围与部署边界见下文。

## 来源与基线

- 目标：`zaenzhang/LexOrder`，起点 `3a800b8b1b6d26110afad34bfdded1a852341fa9`。
- 原版：`lawflow-boop/LawLink`，`4736aa100515bb15f47443cdb6b0ae65745e5fff`。
- 二开：`appleoppa/LawLink`，`535a3531aa79edea1c1c6524fd6748d630170718`。
- [用户指定比较](https://github.com/lawflow-boop/LawLink/compare/4736aa100515bb15f47443cdb6b0ae65745e5fff...appleoppa:535a3531aa79edea1c1c6524fd6748d630170718)：23 个提交，最终差异 49 个文件。
- 保留 MIT 许可与原始版权；二开贡献者 appleoppa 的来源在本文及 `UPSTREAM_SOURCES.md` 记录。

LexOrder 以源码快照初始化，Git 历史与 LawLink 不共享祖先；本次按固定两端的最终差异做三方移植，不合并无关历史，不覆盖现有源码快照上的增强。

## 实施范围与适配决定

| 能力 | 处理 |
| --- | --- |
| 元典法规检索 | 接入案件检索面板；补服务端输入及案件权限校验，沿用安全出站请求和审计 |
| 自建裁判文书检索 | 吸收适配器；服务地址显式配置，默认关闭，不硬编码作者本机地址、磁盘名或语料数量 |
| 执行文书模板 | 增加执行类别与三类模板；补上传校验、模板字段填写与渲染链路 |
| 传票本地解析 | 吸收文本 PDF / 图片本地解析及模型回退，沿用人工确认与材料权限 |
| 程序表单类型 | 按 LexOrder 已有 Zod 4 和表单输入类型适配，保留日期验证修复 |
| 独立调度与启动补扫 | 吸收调度模块和独立入口，保证 Web/worker 明确分工、避免重复注册 |
| 周报推送幂等 | 吸收重复推送保护并验证真实调用路径 |
| 独立备份入口 | 共用既有备份服务；CLI 可由部署方系统调度调用，清理数据库连接 |
| 开发域名配置 | 合并为一个可配置的 allowedDevOrigins，保留 loopback 默认值 |

以下差异逐项保留来源说明，但不纳入 LexOrder 的运行代码：

- `prisma/upgrade/pgg_fork_chain_to_v2_0_1.sql`：仅修复作者 PGG 历史库的旧迁移链，LexOrder 现有四个迁移无需该补偿脚本。
- 四个 PGG 目录提取/导入/同步脚本和 `pgg-casework-gate` 及其测试：绑定作者目录格式、特定角色回执和直接数据库导入流程，未接入 LexOrder 的客户归属、权限、审计与服务层。
- `matter-preservation-panel.tsx`：二开中没有调用入口，现有保全工作流已经存在；不加入未接线组件。
- `preservation-three-layer-migration.test.ts`：断言已被归档的旧迁移文件，当前迁移基线已有相同结构；以真实新库迁移和模型无漂移验证替代。
- 审批按钮 `onPointerDown` 补丁及源码字符串点击测试：与已有 `onClick` 同时触发可能重复打开，不复制该变通；保留实际点击入口。
- 自动生成的 `next-env.d.ts`、冗余缓存类型目录、作者运行脚本路径、PGG README 和忽略项、删除 `storage/.gitkeep`：不覆盖 LexOrder 当前配置。独立运行脚本另按可移植方式适配。

## 数据变更

仅新增 `TemplateCategory.EXECUTION` 枚举值，不变更案件/客户/财务数据。迁移按 LexOrder 当前时间顺序放入新目录，SQL 为：

```sql
ALTER TYPE "TemplateCategory" ADD VALUE IF NOT EXISTS 'EXECUTION';
```

生产使用时先备份并通过常规 `prisma migrate deploy` 应用；本次仅在全新隔离库执行，保留既有 CRM 迁移和数据库守卫。首次安装随 seed 注册新模板；已有实例可单独执行 `npm run templates:sync`，只调用模板增补逻辑，不重跑律所／用章等其他初始化设置，不覆盖已有同名内置模板或其启用状态。

## 升级与配置

已有 LexOrder 实例使用正常备份和维护窗口，更新源码及私有配置后执行：

```bash
npm ci
npm run prisma:generate
npx prisma migrate deploy
npm run templates:sync
npm run build
```

随后按部署方进程管理方式重启。首次安装仍按现有安装文档执行完整初始化。本次没有操作任何生产数据库或部署服务器。

### 检索服务

元典法规检索复用管理后台已有元典 API 配置，使用 `rh_fg_search`。可按内容关键词、法规名称、效力级别、时效性筛选，展示摘要片段和原文链接；实际权限、费用、可用字段和返回内容由供应商接口决定。未配置时对应入口禁用。

自建裁判文书检索通过环境配置接入兼容 cncases HTML 搜索协议的服务：

| 变量 | 含义 |
| --- | --- |
| `CNCASES_BASE_URL` | 服务端根地址，例如 `https://judgments.example.com/`；不支持路径前缀、账号、查询串或片段 |
| `CNCASES_PUBLIC_URL` | 浏览器可访问的文书入口，可含反向代理路径前缀；未配置时不向浏览器暴露内部链接 |
| `CNCASES_ALLOW_PRIVATE` | 默认 `false`；部署方确需访问 loopback／内网服务时显式设 `true` |

标准 Compose 已转发上述三项。适配器只访问部署配置的服务，不接受客户端指定目标地址；限制超时和 2 MiB 正文，拒绝重定向，并只展示同源文书链接。服务未配置、不可达、返回错误或超限时显示不可用，不当作成功的零命中。单独配置自建服务时即可使用，不要求元典账号。

项目不附带任何语料，也不承诺某个文书数量。此轮供应商协议使用合成响应／本地 HTTP 夹具验证，没有连接真实元典账号或真实裁判文书库。

### 执行文书与传票

新增三份模板位于“执行文书”类别。生成时优先取已委托的执行／执行异议程序，而不是误取排在前面的一审程序。执行依据、文号、执行案号和法院补填仅进入本次上下文，不写回案件程序；切换模板或取消后清除临时值。既有客户／对方的证件、住址、电话补全保持原有保存行为。DOCX 渲染支持点分路径，未填值输出空白，并保留缺失提示。

传票支持图片和 PDF，PDF 仅处理首页。文本 PDF 先读取文字；本地图片／扫描件 OCR 需要部署环境提供 Tesseract、`chi_sim` 与 `eng` 语言包，扫描 PDF 另需 `pdftoppm`。可通过 `SUMMONS_TESSERACT_BIN`、`SUMMONS_PDFTOPPM_BIN` 指定程序。默认 Docker 镜像没有安装这组可选 OCR 程序。模型回退会先把 PDF 首页转为 PNG，使用已配置视觉模型。没有可信日期／时间时保留人工输入路径，不从制发日期推断开庭日，不补造默认开庭时间。

### 调度与备份

| 命令 | 用途 |
| --- | --- |
| `npm run start` | 保留既有应用内调度方式 |
| `npm run cron:worker` | 独立、单实例调度进程；同一部署的 Web 应设置 `DISABLE_CRON=1` |
| `npm run start:with-cron` | 同时监督 Web 和一个 worker，自动关闭 Web 内置调度；子进程异常时停止另一进程 |
| `npm run backup:now` | 显式调用既有数据库＋文件备份流程，不受 `BACKUP_CRON_ENABLED=false` 的自动调度开关影响 |
| `npm run templates:sync` | 只增补缺失内置文书，供已有实例升级使用 |

联合启动默认监听 `127.0.0.1:3000`，可设 `PORT` 和 `LEXORDER_HOST`；Compose 已设监听 `0.0.0.0`。`tsx` 已纳入生产依赖，Docker runner 增补源码和别名配置以支持独立入口；默认容器启动方式不变。

启动漏跑检查仅覆盖计划时刻后的 15 分钟窗口，并核对对应完成审计；周报只有 `failed=0` 才视为完整成功。周报通知以用户＋周生成确定性主键，数据库冲突忽略保证手动调用与 worker 并发时不重复。其他作业仍要求单实例 worker；进程内防重入不等于分布式锁。收到停止信号后停止计时器并等待已追踪任务，worker 最多等待 30 秒，监督器 31 秒后强制终止，不能保证长备份在退出前完成。

手动备份共用 `BACKUP_DIR`、`BACKUP_KEEP` 等已有配置，仍要求匹配数据库版本的 `pg_dump`、可写持久目录以及独立恢复演练。CLI 会返回失败退出码并写失败审计。本环境缺少 `pg_dump`，本次验证了失败分支，不声明完成过真实备份与恢复。

## 验证计划

1. Prisma 生成/校验、TypeScript、lint、生产构建。
2. 针对新增检索的权限/配置/网络边界、执行模板渲染、传票解析、调度和备份入口运行回归测试。
3. 新建 PostgreSQL 16 验收库执行完整迁移，检查模型无漂移和空白业务初始化。
4. 运行现有 CRM 真库并发/授权/合并回归、真实 HTTP 登录及页面/模板检查。
5. 条件具备时在独立验收环境验证新增界面；外部元典账号和自建文书服务没有配置时如实显示未配置，不把模拟响应算作真实供应商联调。

## 实际结果

环境：Node.js 24.22.1、npm 11.9.0、原生 PostgreSQL 16.15；使用全新 `.runtime/appleoppa-final-20261116` 集群及独立 `lexorder_fork_acceptance_test` 数据库。凭据、数据库、存储和验收夹具不入 Git。

| 检查 | 结果 |
| --- | --- |
| `npm run prisma:generate` / `prisma:validate` | 通过 |
| `npm run typecheck` | 通过，未跳过错误 |
| `npm run lint` | 0 错误；保留既有 `intakes-table.tsx` 内部导航方式的 1 条 warning |
| `npm audit --json` | 当前 0 项已知漏洞；未变更本轮已锁定的依赖版本 |
| `npm run build` | 生产构建通过，45 个静态生成步骤完成 |
| 完整测试 | **117 个文件、837 项通过**，比当前依赖维护基线新增 40 项回归；包含 10 项既有 CRM 真库测试 |
| 全新数据库 | 按序执行全部 5 个迁移；迁移结果与 Prisma 模型无漂移 |
| 初始化模板 | 25 份内置模板（其中执行模板 3 份）持久化解密及 SHA-256 校验通过 |
| 实际 HTTP 流程 | Credentials 登录、CSRF、会话、客户沟通与跟进、完成后生成下一项、其他用户与匿名隔离通过 |
| 真实并发周报 | 同时运行手动／cron 推送，PostgreSQL 中同一人同一周只有 1 条通知 |
| CLI／进程验收 | 模板重复同步不改已有文件／启用状态／系统设置；独立 worker 启停；联合 Web＋worker 健康检查与信号停止；备份前置失败退出码和失败审计均通过 |
| 新增组件交互 | 自建服务单独配置可检索；未配置的元典入口禁用；法规筛选及原文链接；切换／取消模板清除临时值，持久字段保留，提交载荷正确 |
| 浏览器观察 | 共享云浏览器实际打开并查看登录页；本轮未完成已登录页面点击或手机视觉验收 |

完整真库和运行入口验收命令：

```bash
LEXORDER_RUNTIME_DIR=.runtime/appleoppa-final-20261116 \
WORKBENCH_QA_SCRIPT=tools/cloud-dev/fork-runtime-smoke.mjs \
node tools/cloud-dev/run.mjs verify
```

检索边界测试包括无配置、私网显式许可、真实 loopback HTTP 夹具、非成功响应、重定向、2 MiB 超限、非法链接、案件无权访问、严格审计失败及不持久化检索原文。DOCX 测试实际解包生成文件，核对全部声明变量被替换，不只检查源码字符串。传票回归覆盖下午时刻、闰日、不可能的日期／时间以及“开庭待定＋制发日期”的反例。

实际供应商、真实客户材料、本地 OCR 准确率、Docker 镜像运行、成功备份与恢复演练均未完成。浏览器安全登录流程要求用户提供凭据，本轮没有发起此额外交互，已登录功能的证据来自真库／HTTP 与组件交互；不将其写作完整浏览器验收。运行器、worker 和临时预览均已按正常停止流程结束。

推送前发现主分支新增 `97867e2eaec6aa5595de6a1957806f517efcb04e`（个人安装版／团队版／内置 RAG 决策文档）。本次同步保留该文档更新；它没有改变本次验证的应用代码。内置 RAG、个人安装包和 Rust 重构仍按该决策后续实施。
