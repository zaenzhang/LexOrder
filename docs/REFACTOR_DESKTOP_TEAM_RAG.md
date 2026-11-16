# LexOrder 架构、双版本发布与审查方案

更新与核验日期：2026-11-16。

**决策：共用 TypeScript 业务能力；Personal 优先精简 Next/Node + PGlite，直接打开工作区，不设用户认证体系，使用内置 RAG；Server 保留 Next.js / Prisma / PostgreSQL 与团队认证，使用 RAGFlow。正式 release 同时提供两种可选产物，两版都可连接独立模型 API。性能暂不作为门禁，界面按内容优先原则收敛。Rust 不作全面迁移目标。**

前批已完成研究、固定版本存储试验、文档归并与第一阶段计划细化。当前 M1 从 `b313adf8` 接续，已增加共享根应用的 Personal 接线、LanceDB/抽取原型、RAGFlow HTTP 适配和部署准备脚本；完整材料/技能业务集成、Windows 产物及真实 RAGFlow/模型联调仍未完成。实现边界见 §6.6，历史及当前证据分列于[实施计划 §8.3](WORKBENCH_PLAN.md#83-m1-当前验证与交接2026-11-16)。

**当前验收分工（2026-11-16 用户最新指令）：开发侧仅验证 Server，Personal 留给用户后续测试，停止新增或运行个人版及 Windows 验证。UI 改版后置，保持 LawLink 原有样式。** 个人版未验收不记为通过，历史构建或数据库原型不替代实际可运行证明。

用户最新要求覆盖此前“两版共用内置引擎、RAGFlow 仅为备选”的路线，两个必要适配都进入首发。此前提出的 500 MiB、1/2 GiB、5 秒和 CPU 阈值已全部撤下，不再用于选型、阶段退出或发布判定；个人登录也不是前置。更多历史决策保留于 Git，不继续维护并列的现行方案。

## 1. 已确认的产品目标

用户补充的[产品需求与验收基线](PRODUCT_REQUIREMENTS_ACCEPTANCE.md)是工程决策的依据：

- **恢复上下文**：目标、指示、事实、风险、最新决定、等待与下一步。
- **核查依据**：材料、法律来源、版本、反向证据与人工判断可以追溯。
- **落实责任与结果**：期限、任务、客户决定、复核、实际交付及费用相互关联。

首发聚焦中国大陆个人律师和小团队的民商事诉讼、仲裁，同时保留合同审查、顾问等既有事项类型。核心仍是 Matter，不因产品使用“法律事项”而更换数据身份。

首条完整验收流程：

**目标与指示 → 材料入库 → 事实与争点 → 带来源草稿 → 律师确认 → 行动与客户跟进 → 交付归档。**

全球律所招聘研究用于把研究、判断、表达、协作与交付能力内化为[专业技能](PRODUCT_REQUIREMENTS_ACCEPTANCE.md#10-技能是什么)。技能共用上述数据链，不能把产品简化成多个彼此独立的聊天助手。

| 目标 | 本轮决策 |
| --- | --- |
| 个人独立 | 最小化安装包，本地核心流程无需团队服务器或用户认证；应用管理运行时、存储与生命周期 |
| 部署与协作 | 可自行部署或代管独立实例，服务端集中鉴权与处理，普通成员只需浏览器 |
| 正式 release | 同版本提供 Personal 安装包和 Server 部署产物；两个产物分别验收 |
| RAG 与模型 | Personal 内置 RAG，Server 使用 RAGFlow；两版均可连接独立模型 API，本地推理服务可选 |
| 保留业务 | 继续使用客户、收案、事项、权限、期限、财务、审批、文书和归档 |
| 技术主线 | 共用 TS 业务与编排；Server 保留现栈，Personal 优先精简 Next/Node + PGlite，兼容性按明确范围验证 |
| 界面与性能 | 正文、材料和下一步优先；性能只观察、无硬阈值，不据此阻断发布 |
| 法域扩展 | 共用工作结构，分离语言、准据法、程序法域、机构、时区与处理地区；逐法域验收 |

个人独立与完全离线分别验收。完整离线还要求 OCR、嵌入、必要重排、生成模型与运行时均已准备好。跨设备双向离线同步、共享 SaaS 和多国规则同时上线不在首发范围。

## 2. 推荐的交付方式

### 2.1 同一业务核心，两种发行产物

| 层 | Personal：最小化个人运行版 | Server：服务部署版 |
| --- | --- | --- |
| 使用 | 安装后直接建立/打开本地工作区 | 管理员部署独立实例，成员浏览器使用 |
| 用户认证 | 无注册、登录、密码、TOTP、账号切换、退出登录或用户管理 | 保留 NextAuth、人员、角色、会话撤销与团队审批 |
| 操作者 | 工作区内稳定的本机操作者，姓名/联系方式为可选资料 | 经认证并实时检查资格的成员 |
| 交付物 | 首个目标 Windows x64 安装包，其他平台逐项实测加入 | LexOrder 固定镜像 + 配套 RAGFlow 及依赖的锁定部署配置 + 安装、升级、恢复说明 |
| 用户前置 | 不另装/维护 Node、Docker、数据库或 RAGFlow | 管理员统一部署业务服务与 RAGFlow、持久存储和配置；普通成员只需浏览器 |
| Web 与业务 | 首条实现采用精简生产 Next/Node，共用 TS 领域服务 | 保留现有 Next/Node 业务入口 |
| 业务库 | PGlite 为优先实现候选；本轮已验证部分兼容性，应用独占生命周期 | PostgreSQL，保留现有事务、守卫和迁移 |
| 材料 | 本机私有工作区，用户数据与程序分开 | 持久卷或已有 StorageProvider 支持的存储 |
| 后台执行 | 一个业务运行时、唯一调度及数据库连接所有者；重任务按需启动 | TS worker 管理业务任务与 RAGFlow 作业映射；RAGFlow 执行自己的解析/索引任务 |
| 检索 | 内置 RAG，以 LanceDB 为首个实现目标，由应用管理索引 | RAGFlow 负责解析、索引与检索；LexOrder 服务端限定授权范围、映射引用 |
| 独立模型 API | 可连公网、自建内网或本机独立模型服务 | 同样可连独立 API，模型无需运行在业务服务器上 |
| 生成模型 | 默认不捆绑、不常驻；可选连接本地推理服务 | 默认不要求部署本地生成模型 |
| 恢复 | 应用管理一致备份、更新与恢复 | 管理员恢复业务库、原件、配置及 RAGFlow 必需状态，核对绑定后重建或开放索引 |

两版共用版本号、数据/技能契约和业务规则，通过运行适配区分身份、存储、任务与生命周期，不复制维护两套业务系统。现有事项身份、文档版本、金额、明确确认和审计语义继续保留；个人无需团队管理界面，也无需为继续使用而创建第二个账号。

每个正式 release 必须同时有两类可用产物。远程浏览器、PWA 或连接团队服务器的桌面壳是 Server 的访问入口，不能代替本地独立 Personal；GitHub 自动源码包不能代替部署产物。只有一种完成时，可发布明确范围的 prerelease。

Next.js 支持 Node、Docker 或托管平台，部署版也可由服务方代管独立实例；不是只能让最终用户自行运维。暂不建设共享 SaaS 多租户。[N3]

### 2.2 精简本地服务：先保留 Next，降低改造面

现有页面依赖 RSC、Server Actions、服务端读取、`next/cache` 与导航，事项详情还直接聚合 Prisma 查询。现在先改 React/Vite + 新 API/IPC，会同时重做数据读取、动作协议、刷新和运行上下文。采用现有生产 Next/Node，先抽取确需共享的领域服务；Personal 认证分离是本轮要求，不能因保留 Next 而保留登录流程。[B9]

具体实现顺序：

1. 为 Personal 构建 `output: "standalone"`，由打包运行时启动生成的 `server.js`；收集当前 `.next-build` 下静态资源、`public`、Prisma 引擎、迁移、模板与原生依赖。本批增加通过 `LEXORDER_STANDALONE=1` 构建共享根应用的入口，输出 `.next-personal/standalone`。它减少部署文件范围，不代表已证明内存下降；也不追加一层自定义 Express/Fastify server。[N1][N2][N4]
2. Personal 使用一个业务 Node 入口。现有 `run-with-cron.mjs` 会启动 Web 与独立 `tsx` worker，个人模式先复用 `instrumentation.ts` 的进程内调度，补启动、停机、休眠恢复和防重复；Server 保留现有分进程入口。不能让两条调度路径同时运行。[B8][B9]
3. 文本抽取中的 `mammoth`/`unpdf` 可移至格式分支按需加载；预览和 S3 已有部分按需加载，避免重复改造。重解析/OCR必要时使用按任务启动的子进程，不让子进程另开个人业务库。[B2]
4. 模板引擎拆分确有需要的边界：读取上下文、经确认写回、纯渲染。`applyOverrides` 有业务写入，不能整体当作纯前端工具。[B9]

M1 工程装配方向选为便携托管 Node + 共享 Next 根应用 + 系统浏览器 ZIP，不引入新 UI 外壳；Windows 原生依赖闭包、ACL、启动/关闭与实际产物尚未完成，当前没有 Windows ZIP 或安装包。正式安装按 M4 接续，个人版后续由用户验收。Electron 与 Tauri/系统 WebView 保留为此前研究的包装选项，未据此采用或证明平台可用。[E1][E2][T1]

### 2.3 嵌入式存储已开展验证：PGlite 优先

现有 schema 静态盘点：86 个模型、88 个枚举、20 个标量数组字段、26 个 Decimal、23 个 Json；五个迁移还包含 PL/pgSQL、触发器、CHECK、部分唯一索引。原始 SQL 使用行锁、advisory lock、JSONB 和 PostgreSQL 系统目录。它们涉及数据正确性，不能只改 `provider`。[B1][B5][B7]

| 方案 | 本轮实际判断 | 后续动作 |
| --- | --- | --- |
| PGlite + Prisma 5.22 | 保留 `postgresql` provider 和原迁移的有界试验已通过，优先进入个人适配 | 收口单连接所有权、私有通道、实际服务调用、异常恢复及目标平台发行 |
| SQLite + 当前 Prisma | 仅替换 provider/文件 URL 后，Prisma 5.22 校验产生 167 项错误；没有实施 SQLite 迁移 | 保留为备选，不并行重写数组/类型、锁、PL/pgSQL、金额和迁移。不能将 ORM 限制说成 SQLite 本身不支持 JSON/触发器 |
| 原生 PostgreSQL | 现有 Server 与兼容对照继续使用 | 若嵌入式正确性出现实质阻塞，再比较应用托管 PG；不要求个人用户手动维护数据库 |

**历史有界运行证据（2026-11-16）**：Linux x64、Node `24.22.1`；固定 `@electric-sql/pglite 0.5.16`、`pglite-socket 0.2.19`、`pglite-tools 0.4.16`、`prisma/@prisma/client 5.22.0`。实际 `version()` 返回 PostgreSQL `18.6 (PGlite 0.5.16)`。应用 CI/容器 Node 22、Windows 目标平台不能由此替代；本节保留当时试验，不是最新个人版运行结果。[P2][P3]

| 已执行检查 | 结果与证明范围 |
| --- | --- |
| 原样五迁移经 Prisma `migrate deploy` | 顺序完成，迁移表记录齐全；二次执行无待迁移。没有关闭 advisory lock，没有 `db push`、`reset` 或更改迁移 |
| 数据库守卫目录 | 5 个 PL/pgSQL 函数、10 个业务触发器、25 个 CHECK、8 个部分唯一索引均建立 |
| Prisma 读写与数据类型 | 合成 User/Client/Matter、数组、JSON、枚举及 `123456789012.34` Decimal 往返通过 |
| 事务与锁 | 显式提交、主动异常回滚、advisory lock SQL 执行通过；不是多会话隔离证明 |
| 责任与审计 | Task 自动创建责任、完成联动；直接改责任人和删除 AuditLog 被拒，SQL 预期错误后连接继续可用 |
| 约束与金额 | 部分唯一冲突、软删后重建、CHECK、外键、超额分配拦截通过；未跑完整付款/退款业务链 |
| 队列与请求排队 | 使用源码中现有领取 SQL（含 `SKIP LOCKED`）；一份 PrismaClient/一个连接下 12 个并发请求返回正确 |
| 持久化 | 正常关闭并重新打开目录后，数据和守卫仍在 |
| 停写逻辑导出/恢复 | `pg_dump` 导出至新 PGlite 目录，重建连接后金额、迁移记录和守卫可还原；仅数据库、同版本、停写场景 |
| SQLite 对照 | 直接换 provider 的不兼容被明确识别；不意味着已测出 SQLite 性能差或不可实现 |

复现入口为 [verify.mjs](../tools/personal-storage-spike/verify.mjs)，使用隔离依赖与临时合成库，不读应用 `.env`、不连接已有数据库；固定版本与完整性在该目录锁文件。共 **15 项检查：14 项 PGlite/Prisma 行为检查、1 项 SQLite 预期拒绝检查**。数据库目录和原始日志不入库。

```bash
npm ci --prefix tools/personal-storage-spike
npm run verify --prefix tools/personal-storage-spike
```

试验保留原 schema 语义，仅为生成客户端改临时 `output`；原 schema SHA-256 为 `0db9f98a63cf90d0fb060b41fb35af367f836f5d53869c731fa84c9f2f8b2efb`。脚本每次记录迁移哈希，未来 schema 改变后必须按新结果解释。没有测量应用性能，也没有运行无认证 UI、完整业务服务或 Windows 安装。

### 2.4 PGlite 必须收口的正确性边界

PGlite 只有单数据库会话，socket 的多连接是复用，不等同普通 PostgreSQL 多会话。固定发布包仍包含公开问题 #1046/#1094 描述的消息交错及内部异常后队列停滞代码形态；本轮读取源码与 issue，**没有复现内部异常故障，也没有证明该故障已经解决**。[P2][P4][P5]

- Personal 由一个运行时拥有数据库目录与 PrismaClient，`maxConnections=1`、`connection_limit=1`。迁移、运行、备份分阶段独占。后台执行通过该所有者，不能每个 worker 各建“一个连接”的池。进程内事务只用传入的 `tx`，不占着唯一连接再等待全局 client。
- §2.3 的早期兼容试验使用 loopback socket、关闭 SSL 和语句缓存；URL 中的 `postgres` 占位值不构成访问保护。M1 已改为 §6.6 的随机凭据私有 PG 通道，不开放额外无认证端口；Windows 通道与正式产物未实现，不能由 Linux 局部试验推定可用。
- 历史 M1 私有通道 8 项反例通过，含认证前拒绝、分包、单会话、断连事务回滚和普通 SQL 错误后续用；引擎异常是注入反例，只证明该路径停止服务，不证明上游 WASM 故障已复现或解决。完整取消、异常退出、重启与恢复仍待个人版后续验收。
- `pg_dump` 会改变会话状态并清理预处理语句，备份前停写、断开业务客户端；恢复完成后重建连接。试验只移除导出中 `psql` 专用的 restrict/unrestrict 行，再用 SQL 导入，未改业务 SQL。不能复用现有原生 PG custom-format 脚本冒充 PGlite 备份。[P6]
- 单版数据库恢复不等于数据库+原件+配置+密钥的一致恢复，也不等于强制断电恢复。Personal→Server 需明确映射操作者、版本和文件哈希，并验证目标 PG 版本；不得共享数据库目录或假定 PGlite 18 的物理/SQL 导出可直接用于 Server PG 16。

这些是功能和数据正确性工作，不是性能门禁。当前证据足以选择一个优先方向，仍不足以宣称全部 PostgreSQL 行为或整个个人产品已兼容。

### 2.5 Personal 不建立用户认证体系

Personal 的首开流程是建立/打开工作区，可选填写姓名与联系方式，按需配置模型 API。没有登录、注册、密码、验证码、TOTP、退出登录、人员管理或账号切换。操作系统当前用户的工作区是使用边界；本机操作者仅用于作者、负责人、本人确认与审计，不承担登录功能。

| 改造点 | Personal 行为 | Server 行为 |
| --- | --- | --- |
| `src/lib/auth/session.ts` | 统一 actor resolver 从工作区取得稳定操作者；不读/签 NextAuth 会话 | 沿用认证会话及启用、权限、sessionVersion 检查 |
| `src/proxy.ts`、认证路由/页面 | 无登录重定向，认证/账号 actions 禁用，检查本地调用来源 | 保留现有登录和访问控制 |
| 下载/预览/导出 | 所有直接 `getServerSession` 的路径也改用 resolver | 仍按认证成员和资料资格授权 |
| Providers、导航、资料页 | 共享 actor context，不挂账号 SessionProvider；移除登录/退出/密码/用户管理 UI | 会话桥接同一 context，保留成员设置 |
| 业务确认 | 明确单人策略，真实记录本人复核/到账确认/交付，不伪造独立审核人 | 保留团队角色、审批路由与适用的自审批限制 |

运行模式只由可信发行配置及工作区类型确定；请求参数、Header、浏览器开关不能把 Server 切成 Personal。Personal 只监听回环地址，Host/Origin、写请求来源、Server Actions 与必要的应用通道校验仍保留；这不是让用户登录。密钥、文件与数据库操作留在本地服务。[B9]

保留现有 User 主键和业务关联：五迁移中有 67 条指向 User 的外键，责任触发器也读取有效操作者。首期兼容记录可保留**不可用于登录**的内部 email/passwordHash 占位值，不创建可登录管理员，也不让用户填写密码。明确本机能力策略，不靠 `SUPER_ADMIN` 放行所有业务。显示姓名变化不改作者 ID；迁往 Server 时保留原作者与本人确认性质，另建立真实成员认证。[B1][B9]

#### Personal 的逐项业务确认策略

W01.2 先形成下表的服务动作清单，W17.1/W17.2 实施；策略来自运行模式与工作区能力，不是可登录角色或请求中的开关。每条路径仍校验输入、对象/版本、状态、幂等和审计。

| 动作 | Personal 必需行为 | 保留的业务条件 |
| --- | --- | --- |
| 收案及转正式事项 | 同一操作者提交并明确作本人确认，实际记录冲突核查与选择 | 主体/范围、冲突结论、必要资料与转化幂等，不造第二审批人 |
| 文书复核 | 对确切版本执行本人确认，保留待确认/已确认及修订记录 | 新版本不沿用旧确认，引用/缺项核查与原件版本保持 |
| 到账与相关财务确认 | 登记仍进入待确认，再由本人显式确认；作者和确认动作分别留痕 | 金额精度、核销/退款/结算和数据库守卫不变；不因个人模式自动认定到账 |
| 结项与归档 | 本人确认本地归档规则/版本、完整性与归档快照，再执行适用动作 | 未完成工作/待确认款/材料缺项等原有条件继续检查，归档旧包不改写 |
| 必要配置 | 工作区设置可维护模型、备份、模板及归档规则，采用明确的本机配置能力 | 不要求账号、岗位或管理员初始化；不借用 SUPER_ADMIN 放行所有业务 |
| 团队专属流程 | 不显示或执行人员管理、多人责任移交及确需他人资格的流程 | Server 独立资格/审批/用章规则不被个人例外修改，不伪造其他人的批准 |

此表细化已定单人策略；实现时将现有服务逐项映射并验证，不能只移除登录页。个人→部署迁入如以后实施，原本人确认性质必须保留。

### 2.6 安装、生命周期与恢复

首个目标为干净 Windows x64 普通用户环境；macOS/Linux 只在实际机器与架构完成后列入支持。目标用户不预装开发工具，安装包包含必要运行时或由安装器明确托管。M1 的 W03.2 就生成最小 Windows 托管包，验证运行时/Prisma/PGlite/LanceDB 加载、中文路径、单实例、本地通道与重开；M4 再对最终安装包执行完整流程及更新恢复，不能把目标平台风险全部后移。

- 验证中文/空格目录、数据与程序分离、重复启动、原生模块和 Prisma/OpenSSL 兼容；Linux 试验不能代表 Windows 包已可用。[E2]
- 桌面外壳最小权限，远程团队页面不能取得个人工作区文件/数据库能力；Electron 使用 context isolation/sandbox，关闭渲染器 Node integration。[E1]
- 迁移独占、失败回滚/恢复副本、更新和卸载保留数据；嵌入式库升级与应用版本分开管理。Server PostgreSQL 大版本按既有升级流程处理。[P1][P7]
- 本机关闭/休眠时作业暂停；唤醒补扫、恢复和去重。现有启动补扫仅在计划时刻后 15 分钟内，不能当作完整离线恢复。[B8]
- 备份覆盖数据库、原件、配置与可恢复密钥，形成一致恢复点。恢复后先重建正确的工作区/访问边界，再开放检索。持久性错误不能因取消性能门禁被忽略。

开发运行器 `tools/cloud-dev/run.mjs` 和现有 Web/worker 监督器只作已有基础，不直接当个人安装器。[B6][B8]

### 2.7 性能仅作观察

不设最低内存、启动秒数、CPU 或吞吐通过阈值，也不据此改变 release 状态；尚无测量数据也不阻断功能开发或发布。发现问题可继续优化，是否进入正式性能门禁由后续明确决策决定。

如进行观察，记录真实设备/系统、发布构建、完整进程树、工作包规模、模型位置与配置。区分基础业务、材料处理、可选本地模型；记录启动、内存、CPU、耗时与磁盘占用，不用开发服务器或 Node heap 代替完整应用结果。硬件与模型占用不能混成普通客户端的最低配置承诺。本轮没有性能实测结论。

### 2.8 Release 证据与命名

命名示意：`LexOrder-Personal-<version>-windows-x64-setup.exe`、`LexOrder-Server-<version>.tar.gz`（固定镜像/摘要及部署配置）、`release-manifest.json`。这是交付契约，目前没有对应安装包、镜像下载或流水线完成声明。

发布清单记录版本、平台、校验值、镜像摘要、数据格式/迁移版本、安装/升级/恢复说明和已知限制；Server 还记录 RAGFlow 版本、依赖镜像摘要、部署拓扑、模型/解析配置及兼容验证结果。已测的性能数据可附记录，未测则如实标明。必须有的功能证据：

1. 两个同版本产物可运行；Personal 无开发工具、无团队服务器、无登录即可完成本地核心流程；Server 完成部署、认证、协作和持久化。
2. Personal 内置 RAG 与 Server RAGFlow 分别在至少一组真实可用的独立模型 API 配置下完成同一材料与引用验收；Server 实测配套服务的部署、解析、检索、撤权及恢复。不能以搜索框、模型设置页或假回答替代；能力降级与外发范围明确。
3. 同一专业工作包中的材料、来源、本人确认/团队审批、实际交付与数据版本可还原；安装更新、备份恢复有证据。个人→部署导入列明实际支持范围。
4. 尚缺产物或关键功能时标明 prerelease；性能数字不阻断，不能将数据库试验标成整个个人版已发布。

## 3. RAG 架构：Personal 内置，Server 使用 RAGFlow

### 3.1 共用业务契约，按发行形态接入两个后端

这是已确定的架构分工，不再以性能比较或“内置引擎先遇到瓶颈”为采用 RAGFlow 的前提。Personal 完成独立使用所需的内置能力；Server 复用 RAGFlow 的解析与检索服务。两种实现均待接入，不将引擎的官方功能清单当作 LexOrder 已实现的能力。

共用材料处理任务、`RetrievalProvider` 检索、来源与引用契约；由运行模式固定选择 Personal 内置适配或 Server RAGFlow 适配。输入包含服务端确定的材料范围、版本、代次与查询；输出包含来源片段、原文锚点、处理覆盖及能力状态。业务、技能、人工确认和用户界面只维护一套，不把 RAGFlow 的完整管理平台复制进个人版，也不要求两版具备相同的高级功能菜单。

| 职责 | Personal | Server |
| --- | --- | --- |
| 原件、材料资格与版本 | LexOrder 本地工作区管理 | LexOrder 业务库及私有材料存储管理 |
| 解析/OCR 与分块 | 应用托管的解析组件，可连接独立 OCR/视觉 API | RAGFlow 执行选定解析管线，LexOrder 接收状态与来源映射 |
| 词法/向量检索与重排 | 内置 LanceDB 适配及按需重排调用 | RAGFlow HTTP API，按当前授权文档范围检索 |
| 生成与专业技能 | 共用 TS 技能层连接独立生成 API | 同一 TS 技能层连接独立生成 API |
| 引用、确认与正式写入 | LexOrder 按本机操作者与单人确认策略处理 | LexOrder 按认证成员、业务权限和团队审批处理 |

**Personal 的首个实现目标为 LanceDB。**

LanceDB 官方 JS SDK 可连接本地路径，并下载目标平台原生库。TS 可以组织授权、任务、分块、模型调用与引用，而检索由成熟底层执行；没有必要为使用原生搜索内核重写整套业务。[L1]

在固定 SDK 版本上验证全文/向量混合检索、过滤、中文效果和目标平台打包；文档或 main 的新功能不自动等于选定稳定版可用。LanceDB 是检索组件，通用材料解析、覆盖管理与律师工作流程仍须实现。

中文姓名、简称、完整/局部案号、条款编号、金额、日期、同义表达和中英混排单独评测。默认 simple 分词按空白与标点切分，不能直接宣称具备合格中文分词；按版本验证 ICU 或预分词策略。[L2]

Personal 明确一个索引所有者负责写入与代次切换，Web 经受控内部边界调用。多进程读写、共享网络磁盘、多服务节点和高可用须另行验证，不将 Embedded 当作分布式服务。Server 不运行并列的 LanceDB 索引，其 RAGFlow 作业边界见第 3.5 节。

### 3.2 共用来源契约，三类资料

| 范围 | 业务意义 | 首发要求 |
| --- | --- | --- |
| 当前事项材料 | 支持事实、陈述与证据分析 | 具体 Document 版本、锚点、覆盖与材料/AI 权限 |
| 获授权法律资料 | 支持法律规则与分析 | 法域、来源类型、效力角色、相关日期、有效期间、检索时间、原始 ID/链接与实际权益 |
| 个人/律所经验 | 支持方法与模板复用 | 显式选入、脱敏、审核、适用条件、受众、版本和失效状态 |

可以共同检索，但输出须说明来源性质。经验库不自动吞入所有历史案卷；同一律所不等于全部成员有权访问全部案件。

首家法库从现有元典能力或一个明确有权益的提供商扩展；提供商不支持、未授权、限流、超时和无结果分别表达。W09.1 可用获授权材料验证研究流程并供 W10—W12 开发，W09.2 单列真实提供商联调；未具备账号/权益不阻塞其他研发，但正式 release 前仍须通过，不能用资料包或 mock 关闭该项。

### 3.3 处理、检索、回答是不同阶段

原件保存 → 页/段/表格解析与 OCR → 分块 → 词法/向量索引 → 权限内召回 → 引用与覆盖快照 → 生成候选 → 律师复核。

上述是两版共同的业务阶段，不要求底层采用同一解析器。Personal 由本地适配执行；Server 将获准材料交给 RAGFlow，映射其任务、片段和位置结果。首发使用 RAGFlow 的解析与检索接口，取回并复核片段后由共用 TS 技能层生成；不直接把其 Chat/Agent 回复登记为经核实事实或批准成果。

既有业务入口的文本提取覆盖文本 PDF、DOCX 和文本，扫描 PDF 仍可能进入 SKIP；短信 OCR 与传票首页解析保持各自范围。M1 新增的逐单元抽取/OCR 原型见 §6.6，尚未接入完整材料管线；不能把局部 OCR 或模拟 provider 测试写成真实通用 OCR 已完成。[B2][B8]

现有 AI 文书审查有分段、截断和数量限制，仍包含请求内执行；新增工作要补真实阅读覆盖和可恢复作业。检索到若干片段不等于读完全部案卷。[B3]

### 3.4 两版共同连接独立模型 API

模型服务与应用运行位置分开配置。Personal 与 Server 共用能力、模型身份与调用记录契约；两版均支持独立公网 API、受信内网服务及本机独立推理服务，不要求业务程序捆绑权重、安装 GPU 运行环境或启动生成模型。模型 API 的 key 是供应商凭据，不是 Personal 的用户登录。

| 能力 | 配置与判断 |
| --- | --- |
| 生成 | endpoint、协议适配、模型 ID、凭据、上下文限制、超时/取消、流式/结构化能力；不能假定任意 API 完全兼容 |
| 嵌入 | 可选另一 provider/模型；记录维度及完整模型/预处理指纹，改变后建新索引代次 |
| 重排 | 按需配置，明确未启用/降级状态，不强制依赖某家服务 |
| OCR/视觉 | 单独声明图像/文件输入能力，原图与文本的外发范围分别提示 |
| 配置验证 | 按实际能力分别连通测试；401/403、超时、限流、不支持与无检索结果分开；不暴露明文 key 到浏览器或日志 |

**Server 分开管理 RAGFlow 服务连接与模型连接。** RAGFlow endpoint/API key 用于调用检索服务，不是生成模型 API。首发生成调用归 LexOrder；Server 的摄入/查询嵌入、解析所需模型及启用的重排归 RAGFlow 配置，记录其实际生效的 provider、模型与参数。两边不假定自动共享设置或密钥：管理员分别验证，LexOrder 保存非秘密的配置指纹及验证结果；解析/嵌入配置与索引指纹不符时停止使用该代次并提示重建。相同模型服务可供两边使用，但不要求同一供应商或同一个 key。只变更生成模型时记录新的 AiRun/模型版本，不笼统重建向量；影响解析、分块、嵌入输入或模型身份的变化才重建对应代次。[R2][R4]

公网 URL 校验保持现有防护；自建内网/localhost 采用独立受信端点策略，限定配置地址/端口和重定向，不全局放开 SSRF。需要 key 和可无 key 的本地服务按 provider 声明处理。Server 容器里的 `localhost` 指该容器，不是浏览器用户电脑，配置说明必须表达清楚。[B4]

| 运行档位 | 能力范围 |
| --- | --- |
| 基础本地工作 | 个人事项、材料、任务、模板与已有记录不依赖模型；模型断开保留普通业务及已验证关键词搜索 |
| RAG + 独立模型 API | Personal 内置检索或 Server RAGFlow 与所选模型协作；分别说明向 RAGFlow、OCR、嵌入、重排和生成服务发送的内容，不称完全离线 |
| 按需本地组件 | 用户另选本机嵌入/OCR/推理服务；组件未运行时明确不可用，不默认常驻或增加硬件门槛 |
| 全离线 AI | 指定并准备所有必要模型/运行时，在实际断网下验证后才声明；已有向量不代表查询嵌入已可离线 |

首发优先让独立 API 可配置可用，不以建设模型商店或下载器为前置。未来确需托管模型下载时，再补完整性、存储、停止/卸载和离线导入。AnythingLLM/Cherry 可作体验参考，不证明 LexOrder 已完成集成。[A1][A2][C1]

### 3.5 Server 的 RAGFlow 接入与运维边界

首个联调目标固定为正式版 **RAGFlow v1.0.0**（2026-11-06 发布，标签提交 `db1cd59`）；实际发行锁定镜像摘要及其依赖清单，不跟随 main、DEV 或 latest 自动升级。TS 经版本化 HTTP API 接入，同时检查 HTTP 状态和业务 `code`，区分内置解析与自定义 pipeline 的接口，不沿用已移除的旧别名；RAGFlow 的实现语言不改变业务主线。[R1][R2]

1. **部署与访问**：Server 配套提供 RAGFlow 和必要依赖的部署配置、持久卷、健康检查、升级与恢复步骤；也可连接管理员已有的兼容实例，须通过同一验收。RAGFlow 是 Server 必需组件，托管位置可选。普通成员只访问 LexOrder，不发放 RAGFlow 管理账号或服务 key；服务接口及管理入口限定在受控网络/运维访问范围。其内部数据与 LexOrder 的 PostgreSQL 业务库分别管理，不直接读写 RAGFlow 内部表。[R4]
2. **任务与身份映射**：LexOrder 保存 `Document.id + sha256`、后端/实例、dataset/document/chunk 映射、解析与嵌入指纹、代次、远端作业状态和覆盖。按事项/资料范围与配置代次组织数据集，材料级权限仍逐件计算。TS 队列负责可靠投递、状态核对和取消，投递前复核材料资格、版本及外发范围；RAGFlow 负责解析/索引执行。上传超时先核对远端结果，避免盲重试形成重复或孤立材料。W04.3 必须实测固定版本支持哪种查找/关联方式，并把本地操作意图与可核对标识交给 W05.3；不预设服务支持任意幂等键。无法确定远端是否已创建时进入待核对并给出运维核对出口，不盲目重传或宣称取消完成。只有当前代次通过来源映射和覆盖检查后才开放检索，不把已接收任务等同于已处理完整。
3. **检索前后授权**：LexOrder 计算当次允许用于 AI 处理的具体文档白名单并映射远端 ID；空白名单在本地返回空，绝不向 RAGFlow 发送可被解释为全库的空筛选。检索请求显式携带允许的 dataset/document 范围；返回片段在进入模型、界面、缓存与历史前再次检查资格、版本和代次。RAGFlow 的 Only me/Team 规则不替代事项与材料权限，普通成员不通过其原生共享入口绕过 LexOrder。[R2][R3]
4. **汇总与高级检索**：首发显式设置 `include_knowledge_compilation: false`，使用可追溯原始来源片段。1.0 的文档筛选不能证明某个数据集汇总的所有来源均获授权；未来启用必须检查全部来源。该版普通 retrieval API 的 `use_kg: true` 也不代表多跳图检索已启用。Knowledge Compilation、Agentic Chat 等只在来源、工具权限与技能验收完成后接入，不因部署平台就默认开放全部能力。[R1][R2]
5. **引用与材料状态**：远端 chunk ID 只作技术映射，引用始终回到 LexOrder 的具体原件版本与 SourceAnchor；无可靠页段位置时明确限制，不猜页码。RAGFlow 内的块编辑、重解析和分块变更形成新的派生代次，不改原件、不使旧引用漂移；首发通过受控管线维护派生结果，不向普通成员开放绕过版本记录的管理编辑。
6. **撤回、删除与失败**：成员撤权首先在 LexOrder 即时生效，进行中结果、缓存、历史与引用重新核验；不因某成员撤权而删除其他成员仍获准使用的材料。材料整体撤回/删除时，LexOrder 立即禁止新的提交、召回、结果展示及自身发起的外发，并可靠投递远端取消/删除。远端处于“取消待确认/删除待确认”时如实显示，确认前不得宣称远端处理或全部外发已停止；迟到结果不得发布，已外发内容不能承诺收回。RAGFlow 断连时保留普通业务和已有原文，明确显示解析/检索不可用及恢复入口，不悄悄切回另一索引或扩大查询范围。检索失败或解析未完成时，不以无材料生成冒充成功的材料分析。
7. **恢复与迁移**：备份包含业务库、原件、必要密钥/配置/绑定、RAGFlow 必需元数据与无法从原件重建的派生记录；可重建索引记录所需版本与配置。恢复后先核对当前权限及版本映射，再开放检索，不能只恢复 LexOrder PG 就宣称整套 Server 已恢复。Personal → Server 迁入原件、业务记录与稳定引用，按 Server 管线重新建索引；不直接复制 LanceDB 向量目录作为 RAGFlow 数据。导入范围与操作者映射另按实际支持验证。

### 3.6 首发能力与后续扩展

两版都必须完成事项材料的导入/处理状态、中文词法与语义检索、带来源草稿、版本回看、失败提示和恢复；按同一专业工作包分别验收，不能用 Server 的成功代替 Personal 验收。扫描件、表格、反证、长文、中文姓名/案号/金额、材料新版本及无依据问题均进入样本。算法、分块和召回结果可以不同，来源可靠性与业务确认规则保持一致。

RAGFlow 的通用解析、管线和高级检索能力可供 Server 逐步使用；个人版优先补齐上述完整工作流程，不以复刻其管理平台、连接器或 Agent 画布为目标。高级功能按实际能力显示，未处理的页或不支持的格式明确说明，不能给出虚假完整覆盖。质量验证用于修正两条已定实现，不重新设置性能选型门槛。

首发只维护 **Personal 内置适配 + Server RAGFlow 适配** 两个必要实现；每个产物不再并列增加其他后端或通用切换器。pgvector、SQLite FTS/向量扩展等留待具体功能需求再议；Personal 业务库的 PGlite/SQLite 取舍见第 2 节，与 RAG 后端分工分别决策。

## 4. 为什么 TypeScript 是当前主线

| 比较项 | 保留 TS / Next / Prisma | 全面 Rust 迁移 |
| --- | --- | --- |
| 业务规则 | 增强已存在服务与事务 | 重写并重新证明状态、金额、审批、权限行为 |
| Web 界面 | 保留 RSC、Server Actions、会话与页面 | 重划接口与鉴权边界，适配页面调用 |
| 文档生态 | 复用现有 DOCX、PDF、表格、模板工具 | 验证替代库或仍需辅助进程 |
| RAG | 共用 TS 编排；Personal 调用内置组件，Server 经 HTTP 调用 RAGFlow | 编排本身需重写，OCR/模型速度不因语言自动改善 |
| 交付成本 | 新增桌面托管与安装工程 | 同时承担语言、接口、数据库与交付变化 |
| 当前决定 | 作为持续业务主线 | 暂停整域迁移，按局部测量结果重新评估 |

这是针对当前仓库资产的成本/风险判断，尚无可据以报告的开发速度倍数或性能对照数据。

重构的重点是：从请求入口拆出可复用业务服务、统一材料处理和引用、补齐可恢复任务、接通工作链。按正在修改的功能逐步提取，不先全仓搬目录，不引入新的通用 ORM/工作流框架作为前置。

Server Actions/Route Handlers 通过统一 resolver 取得本机操作者或认证成员，保留输入校验和页面刷新；业务服务接收显式 actor/context，事务内按运行模式复核适用权限、状态与版本；worker 调用相同服务。Personal 移除账号认证，仍保留业务确认和工作区边界。

Rust 的后续使用条件：已知热点经 profiling 证明是本模块 CPU/内存问题，成熟原生库或任务拆分仍不能解决已确认的问题；或某项原生集成确有收益。性能当前不作阻断条件。以小接口替换该组件，再跑同一验收包。

## 5. 必须保留的现有资产与数据语义

| 现有事实 | 处理决定 |
| --- | --- |
| ClientActivity / ClientFollowUp 已实现 | 补聚合、指示与等待，不再列为从零新增 |
| EvidenceItem 已有五类要点、单来源/页码 | 加多来源、支持/反驳、发生时间与确认 |
| Document 一行一个版本，familyId 串联 | 引用绑定 Document.id + sha256，不造平行 DocumentVersion |
| 文书送审、批准、驳回和入卷已有 | 补引用复核与版本绑定交付，不新建替代审批系统 |
| Task / WorkResponsibility / 交接已有 | 补依赖、等待对象、检查日和计划日期 |
| 期限人工保护、正文搜索、提醒台账已有 | 增强来源和覆盖，保留原语义 |
| 财务、权限、归档使用 PG 事务与守卫 | 部署版保留 PG；个人存储适配必须证明相同业务约束和恢复行为 |
| 现有 AI、审查历史、外发日志 | 新 AiRun 与旧记录建立明确映射，逐步统一 |
| StorageProvider 已有 local/S3 抽象 | 复用文件契约；派生 OCR/索引/缓存也要纳入保护 |
| 元典法规/cncases 界面、执行模板、传票首页解析与独立调度已合入 | 复用并按实际权益、覆盖和恢复边界扩展，不重复列为从零建设 |

代码依据见 [B1]—[B8]。PG 耦合包含数组、JSONB、Decimal、行锁、advisory lock、部分唯一索引、函数、触发器及 CHECK；不能只改 Prisma provider 即完成 SQLite 迁移。PGlite 官方说明其 socket 多连接由单连接多路复用实现，不保证正常 PG 的所有用例，因此也不能当作现有 Prisma/并发队列的零改动替换。[P2]

现有 `JobQueue` 已有去重、租约与重试，但完成更新仅按 id + RUNNING，尚无领取所有权 token。长 OCR/嵌入前补 token、续租、按 token 条件提交、取消和检查点；旧 worker 迟到不能结束新的领取。领取批次和并发限制要匹配实际处理能力，避免任务在队列内等待时租约已经耗尽。[B5]

## 6. 统一业务与技能契约

### 6.1 最小增量

| 概念 | 设计边界 |
| --- | --- |
| 事项上下文记录 | 目标、客户指示、备选方案、决定/理由、来源与版本；复用现有范围和描述 |
| MatterBrief | 授权范围内聚合视图，不复制状态和责任人的权威值 |
| SourceAnchor / EvidenceSourceLink | 具体文档版本、页段/表格位置、多来源与关系 |
| Evidence 关系 | 支持、反驳、矛盾、待核实；首期用关系表/字段即可 |
| 任务等待/依赖 | 复用 Task 和责任链，外部等待仍需内部负责人 |
| 解析运行 / DocumentIndexBinding | 后端/实例、文档版本与 hash、解析/分块及完整嵌入指纹、索引代次/覆盖/状态；Server 另映射 RAGFlow dataset/document/chunk 与远端作业 |
| AiRun | 技能/模型/提示版本、实际材料版本与输入范围、工具调用、覆盖和引用 |
| 建议契约 | 结构化候选和目标版本；先适配 SmsSuggestion 等现有对象，不先建设通用流程引擎 |
| DeliveryRecord | 审核后的确切成果版本、对象、渠道、实际交付证据、客户确认与替代关系 |
| 法律与经验来源 | 各自的法域/时点/授权或脱敏/审核/适用条件，不另造事项主数据 |

名称为设计草案，具体表和迁移在相应实现任务中确定。保留主键和旧字段语义，按兼容增量实施。

### 6.2 权限、版本与确认

1. 全文、向量两路都使用服务端计算的授权范围；空范围直接结束。送入模型、输出、历史读取与打开引用时复核当前权限。
2. Server 的案件概况、材料全文、AI 处理、财务、审批和导出分别授权，团队汇总或系统管理员不替代业务资格。Personal 用本机工作区能力和单人确认策略，材料撤回、外发意愿、版本与正式写入确认仍有效。
3. 文档/权限撤回后，LexOrder 内立即阻断相关任务的后续投递及结果发布；后续外发、结果交付及缓存提交再次核对。Server 已投递至 RAGFlow 的任务按第 3.5 节确认取消/删除状态，不把本地失效视为远端已经停机；已经发送的内容不能承诺收回。
4. 引用绑定具体版本与锚点。新版本提示受影响的分析/文书，旧引用不静默改指最新版本。DOCX 用真实段落/字符或转换映射，无法定位时明确说明。
5. 索引代次绑定解析/分块版本，以及嵌入 provider、模型 ID/修订、影响嵌入结果的输入配置和维度组成的完整指纹。同维度不代表向量兼容；配置切换须建立新代次，完成后原子切换，不混查不兼容向量。删除、取消或旧代次迟到不得重新发布；验收覆盖模型切换及重建失败。备份权威数据及必要组件后，索引允许重建。
6. AI 输出是候选。通过类型与来源校验、人工复核，再由既有业务服务写入；事务内复核操作者、目标版本、幂等与状态。
7. 草稿生成、内部审核、正式提交/交付和客户确认分别记录。技能默认形成可审阅成果，不凭模型输出自动承诺、付款、发送或提交法院。
8. 知识发布必须显式选入并完成脱敏和审核；历史 AI 成果与缓存不能绕过当前访问资格。
9. 材料版本/处理代次变更与任务意图须同事务落库，或同事务写 outbox 再可靠投递，并有补扫。原件文件不与业务库共事务：先可靠暂存并校验 hash/大小，保存可恢复的摄入标识，再建立材料引用和任务意图；恢复时核对未完成摄入、缺失原件与孤立暂存。原件未就绪不得进入解析、召回或正式成果；不覆盖旧版本原件。W05.1 分别验证文件保存→DB 提交及 DB 提交→任务投递两个中断窗口。
10. 恢复协议在 W05/W17 开发：停止新投递，形成数据库/原件/必要配置与后端状态的一致恢复点，保存有效代次和待核对远端作业；恢复到隔离工作区/实例后先校验权限、版本与绑定，隔离旧会话/作业结果，再开放检索。Server 远端仍可能处理中的任务要核对，不以暂停 TS worker 代表 RAGFlow 已暂停。备份后的授权撤回不能被旧快照静默放大；无可验证当前授权状态时保持受限并由真实管理员核对。

### 6.3 技能如何进入 TS 架构

首期使用版本化技能定义 + Zod 输入/输出契约 + 明确工具清单 + AiRun，复用模型/provider/队列。每项技能具备需求编号、适用范围、输入前置、处理步骤、产物、引用规则、人工复核和评测。

工具由服务端注入已授权的资料读取、检索、模板和候选动作能力；权限范围不由提示词或模型传入的文档 ID 决定。技能定义及版本随代码审查，输出回到 EvidenceItem、研究记录、文书候选、Task/跟进候选或交付草稿。

先将首条工作流程中的技能接通，再根据质量证据增加复杂编排；不以通用 Agent 平台或多代理角色数量作为交付目标。具体规格见 [PRODUCT_REQUIREMENTS_ACCEPTANCE.md#10-技能是什么](PRODUCT_REQUIREMENTS_ACCEPTANCE.md#10-技能是什么)，招聘依据见 [RESEARCH_AND_DECISIONS.md#7-全球律所职业能力研究](RESEARCH_AND_DECISIONS.md#7-全球律所职业能力研究)。

### 6.4 原型前的契约与实际落库顺序

W01.2 先定义身份/权限及来源边界，W04.1 固定两个 RAG 适配器共用的设计契约：输入的服务端范围、Document/hash/来源类型、页段/表格锚点、实际覆盖、处理/嵌入指纹与代次、后端/实例和远端 ID 映射、明确错误和待核对状态。用同一工作包验证两个实现，不要求检索排序、分块或生成措辞相同。

W04 原型可用临时映射验证上述契约，不能提前宣称持久化/恢复完成；W05 落材料与任务/索引绑定，W06 落稳定锚点及事实关系，W08 落 AiRun/候选与采纳。模型输出是候选，服务端负责真实权限、来源身份与确认状态。Personal 的 W17.1 先供这些服务使用，W17.2 随业务集成，W17.3 收尾生命周期；Server 不等待个人全部完成才开发，但两个模式各自保留验收结果。

### 6.5 第一批可执行契约的实现边界

W01.2/W04.1 首批在 `src/lib/workbench/` 建立不依赖 Prisma/Next 请求上下文的 Zod 契约：运行模式与操作者描述、三类来源版本、真实定位、解析覆盖、索引代次/指纹、明确结果及错误。材料继续使用具体 `Document.id + sha256`，不增加平行版本表；法源核实/正文权益、经验审核/撤回独立于来源类型。

`src/server/rag/` 的共用检索边界只接受可信服务构造的范围。适配器只取得具体绑定清单；空范围不调用后端，返回内容必须重新对应当前授权、原件版本、有效代次和已处理范围。当前范围与稳定锚点由服务回调读取，后续 W05/W06 再接真实持久层；这批可验证纯校验与异步撤权反例，不声明现有页面已具备该保护。失败、不支持、未完成、待核对与成功无命中分开，未经核对的片段不进入界面或生成模型。

**历史引用与新结果分开**：新检索/发布核对有效索引代次；打开历史引用核对当前读取资格、原件 ID/hash、真实锚点及其内容，不强求旧锚点等于当前索引代次。索引重建不能使历史成果改指新版本，也不能成为撤权后继续读取的理由。

两类工作包由测试源码生成合成 UTF-8 字节、实际 hash 和可定位文字，并给出独立的支持/反证/矛盾/未知预期。生成原件及原始运行输出留在隔离验收环境，不进入默认 seed；测试生成器与断言随代码审阅。部分覆盖是明确构造的输入样例，不冒充真实 OCR/表格解析。专业标注、实际后端、Windows 和界面验收按对应任务接续。

### 6.6 M1 实施边界（2026-11-16）

以下登记已写入代码的边界，不代表个人版已可运行。共享根应用的生产 Personal 构建曾通过，后续变更未复验；新工作区初始化实跑报 `M1_INITIALIZATION_COMMAND_FAILED`，随后依用户指令停止 Personal 验证，创建/关闭/重开及业务流程留待用户测试。当前继续验证 Server；具体结果及缺项见计划 §8.3。

- 用户纠正后，个人启动器必须启动根应用的生产 standalone，复用 `src/app` 与 AppShell，而非独立材料原型页面。统一服务端操作者解析覆盖页面、动作、下载/预览/导出；客户端通过统一 actor context 读取，Personal 不挂 NextAuth SessionProvider、不发起登录会话轮询。Server 继续使用原有认证。模式由启动配置决定，不能由请求切换。
- 原型依赖及运行入口集中在 `tools/workbench-m1`，复用根项目模型、迁移、解析和检索契约；不创建另一套正式业务身份。个人原型使用独立工作区和稳定本机操作者，不调用 Server 登录链；Server 继续执行既有认证与权限规则。
- 个人存储由单一启动器持有 PGlite 生命周期；启动时独占迁移，随后交给单连接 Prisma。工作区清单和数据库身份须一致；不完整初始化/遗失清单不得自动生成新身份覆盖历史。当前云环境的 Unix socket 创建返回 EPERM，原型改用仅绑定 127.0.0.1 的随机凭据 PostgreSQL 协议入口，认证完成后才将协议帧交给 PGlite；无额外无认证端口。只允许一个认证会话，关闭旧会话并结束其事务后才能接入新会话；内部异常停止该运行。Windows 私有通道与实际托管包未完成，开发侧不继续其验证。
- 主应用工作区使用 Prisma 默认 CUID 创建真实 User，manifest/数据库版本为 2；不重写旧工程原型 UUID 或历史外键。文件密钥首次产生后持久化，缺失时拒绝启动，不生成替代密钥。原件使用工作区私有存储；生产 Personal 缓存唯一 PrismaClient，初始化 seed 不创建管理员，只给稳定操作者建立基础字典和模板。
- 本地入口用短生命周期随机通道值设置 HttpOnly/SameSite=Strict cookie 后跳回干净根地址；它不决定模式、操作者或业务授权。逐次复核 manifest、数据库元数据及有效操作者；写操作校验精确 Origin/Host。日历/桌面文件入口保留其专用令牌并加本机边界。账号/TOTP/组织管理在路由与动作两层禁用，业务配置按明确白名单开放。
- Personal 的财务、审批与归档采用显式本人能力并核对真实对象归属，不授予 ALL/管理员/财务岗位。登记保持待确认，发票确认和实际开具分开，法定代表人章与归档快照条件保留；事务 helper 复用传入连接，审计记录真实单人决定。当前 M1 关闭调度（`DISABLE_CRON=1`），调度生命周期按 W17.3 接续。
- 原始字节的 SHA-256 是来源校验依据；解析分别记录 PDF 页、DOCX 不可变抽取文本偏移（尚非原文件段落映射）、表格单元格/区域和图片位置。空文本扫描页、公式无缓存和失败页不变成已处理；OCR 使用显式 provider，原件不被改写。
- LanceDB 固定 0.41.0，M1 隔离工具运行时 Node >=22；词法使用 ICU，词法/向量两路均先按可信 binding/代次过滤，再合并。重新写入须验证来源、维度和配置指纹；索引不是引用原件仓库。
- RAGFlow v1.0.0 的 HTTP 适配以固定 Go 实现为准：生命周期请求与观察到的终态分开。上传响应丢失进入待核对；取消、删除未观察到结果不记完成。远端 xxh3-128 内容摘要不能代替本地 SHA-256。`prepare-ragflow.mjs` 固定上游提交、文件校验与镜像摘要，输出仍为 `PREPARED_NOT_DEPLOYED`，没有证明容器启动、健康、解析或持久化。
- 独立模型与 RAGFlow 服务分别配置凭据。公网沿用安全出站校验，受信本机/内网地址由进程启动配置精确允许，禁止重定向扩大范围；原始服务错误不写入用户输出或日志。模拟 HTTP 服务只证明协议与失败处理，不计真实模型/RAGFlow 验收。

## 7. 参考项目如何进入 LexOrder

沿用 [来源记录](RESEARCH_AND_DECISIONS.md)，按“观察行为 → 输入输出与规则 → LexOrder 设计 → 场景验收”吸收。实际复制代码另记固定提交、文件、依赖与来源；研究范围不按协议类型排除。

| 来源 | 采用方向 | 本轮落点 |
| --- | --- | --- |
| LawLink | 完整业务与授权基线 | 保留主系统，增强关系和使用闭环 |
| appleoppa/LawLink | 法规/本地案例检索、传票解析、执行模板、独立调度 | 已由 `2997b54` 合入；复用并保留其配置、权限、覆盖和未联调边界 |
| ANQI | 今日工作、可解释期限、人工保护 | 计划、等待、事件与期限区分 |
| Kosmos / 诉讼可视化 | 事实、多材料、高亮、时间线 | EvidenceItem 多来源和反证关系 |
| Paperless-ngx | 文档摄入与派生处理生命周期 | 原件保护、页级覆盖、失败恢复 |
| AnythingLLM / Cherry Studio | 双交付、内置组件与模型/召回管理 | 个人安装与团队 RAG 使用体验 |
| RAGFlow | 现成解析、索引与检索平台 | Server 已定后端，经 HTTP 接入；来源/权限/技能仍由 LexOrder 管理 |
| Counsel OS | 上下文、版本引用、文书审阅 | 覆盖快照、技能上下文与引用 |
| Docassemble / j-lawyer | 条件字段、访谈和文书工作流 | 现有模板链上的缺项驱动与专业模板 |
| Twenty / Frappe CRM / Clio | 客户关联、跟进与服务过程 | 已有客户模型上的聚合与进度简报 |
| AppFlowy | 模块/持久层边界 | 只参考工程组织，不据此选择 Rust |
| 全球律所官方招聘 | 研究、判断、表达、责任、协作与交付 | 可执行技能规格与工作质量验收 |

二开来源固定核对为 `535a3531aa79edea1c1c6524fd6748d630170718`。其 README 明确多角色复核门禁只有函数/测试，未接入界面或服务动作；LexOrder 已明确不迁入该门禁、PGG 专用导入/修库脚本及未接线组件。独立 worker 与 Web 调度已有分工，后续新增 RAG 作业继续保持唯一调度入口，不能把现有进程内防重入当成分布式锁。[F1][B8]

## 8. 后续实施顺序与验收

这是唯一现行阶段路线。产品第一阶段覆盖 M0—M4，以 M3 专业流程和 M4 双产物正式验收为终点；子任务、外部条件和证据矩阵统一在[实施计划](WORKBENCH_PLAN.md#3-工作项依赖与退出证据)，不新增并列计划。旧 R0—R5、B01—B12 和 12—16 周估算保留在历史提交中，不继续作为当前工期承诺。

| 阶段 | 实际交付 | 退出条件 |
| --- | --- | --- |
| M0 需求与基线 | RQ01—RQ20、技能/来源清单、当前能力与已合入二开边界、两类验收工作包、界面规格与性能观察项 | 需求到任务可追踪；锁定基线和行为/数据库守卫清单。文档与 W03 存储有界试验已完成，完整基线工作包接续准备 |
| M1 可行性原型 | PGlite/Prisma 有界兼容试验已完成；接续 Next standalone、无认证 actor、Personal 内置适配、Server RAGFlow 适配及独立模型 API | 两版各自完成解析→召回→引用原型、配置及远端能力核对；最小 Windows 托管包验证运行/原生依赖/通道。性能不设退出阈值 |
| M2 上下文与材料依据 | 目标/指示最小记录、通用材料管线、锚点、多来源事实、事项内 RAG | 分别登记网页与个人集成：导入→事实/争点要点→引用核对；反证、失败页、版本变化及权限可见；法律论证在 M3 接续 |
| M3 完整专业工作流程 | 法律研究、方案决定、带来源草稿、现有审核、等待/责任/期限、客户简报与交付；最小知识发布 | 首条完整流程在网页与桌面预览跑通，关键结果有依据、责任人与成果版本；W09.2 真实法库单列，不阻塞其他开发且不自动豁免首发 |
| M4 双产物正式发布 | 同版本 Personal 安装包、Server 含配套 RAGFlow 的固定镜像/部署配置、清单与更新/恢复说明 | 同一工作包两版通过；Personal 无认证与内置 RAG 独立可用，Server RAGFlow/协作/撤权可用；两版独立 API、UI、更新/完整恢复和 W09.2 真实法库通过，证据绑定产物；性能不阻断 |
| M5 持续使用优化 | 今日工作、交接复核、经营与顾问周期、知识复审、技能评测迭代 | 连续使用时上下文、等待、交付与资料保持完整，按真实返工和耗时改进 |
| M6 业务与法域扩展 | 更多模板/法库/司法接口/法域，必要规模与性能优化 | 每项有规则、权益、样本和验证记录；按具体需求评估额外后端或局部 Rust |

M1 已取得第 2 节和计划 §8.3 的局部证据；当前开发侧仅继续 Server 回归、运行与服务联调，Personal/Windows 留待用户后测，未验收项不改记通过。材料契约与原型可并行，M2 不以已发布安装包为前提，M4 才进行正式双形态验收。

W17.1 的共享页面、操作者、本地入口及必要本人确认接线已前置到本批；M2/M3 接续材料/技能和生命周期，M4 汇总用户的个人版验收及部署版验收。不得把局部测试或构建通过当作个人版开发完成。

执行工作项与依赖见 [WORKBENCH_PLAN.md](WORKBENCH_PLAN.md)。财务、审批、归档作为回归资产保留，不安排为语言迁移模块。

### 审查与发布门槛

- **产品**：按 RQ 编号检验上下文、依据、责任与交付；不是只验 API 或聊天。
- **权限/数据**：无权召回、缓存/历史泄漏、空授权扩大、引用漂移、旧代次发布、未经确认正式写入作为阻断问题。
- **作业/恢复**：并发领取、续租、中断、重试、取消、唤醒、备份及重建针对实际故障验收。
- **专业质量**：关键事实和反证遗漏、引用是否支持论断、法律来源/时点、草稿返工和客户简报准确性由律师对样本评定。
- **交付**：每个正式 release 同时具备个人安装包与部署产物；目标平台真实安装/更新/恢复，所选运行时、存储和守卫可用。
- **性能观察（非门禁）**：可以记录基础、材料和可选模型各档全进程资源、启动与处理时间，但无阈值、无阻断，未测也不推迟发布；不据此虚构最低配置。
- **审查节奏**：每批聚焦变更及既有回归；新发现分类进 backlog，阻断项先修，不扩成无限全仓重审。

前批源码研究、存储试验、计划审查和全仓测试按各自快照保留；本批 Server 的数据库、业务回归、生产构建与后续 HTTP/UI 结果分列于计划 §8.3。开发侧仅复验 Server 受影响路径，Personal 验收交由用户；未观察到实际页面操作时不记浏览器通过。

## 9. 已定、待证与延期

**已定**：共用 TS；Server 保留 PG/认证并使用 RAGFlow；Personal 优先精简 Next/Node + PGlite、无用户认证并使用内置 RAG，LanceDB 为首个实现目标；双 release、两版独立模型 API；内容优先界面；三类来源、真实确认/交付与技能版本化；性能不设门禁。

**已证与待证**：保留固定 PGlite 的五迁移/守卫/部分恢复、M1 私有通道 8 项及新增 Lance/OCR 26 项局部证据。最新 Server 已完成真实 PG 16.15 五迁移及结构无差异、客户关系 10 项、部署业务 11 文件 105 项、安全 2 文件 21 项、生产构建和既有 HTTP smoke 6 组；浏览器仅观察到原 LawLink 登录页，登录后操作未验。Personal 新工作区初始化失败后停止验证，未证明当前可运行，也无 Windows 产物。RAGFlow 仅完成准备，真实服务与模型未配置；服务联调及整套恢复仍未通过。详见计划 §8.3，性能不作为这些任务的前置。

**延期**：全面 Rust、替换部署版 PG、每种发行形态的额外检索后端/通用切换器、离线多人同步、多租户、通用工作流/Agent 平台、多法域同时发布。Personal 内置与 Server RAGFlow 两个适配、个人版必要的嵌入式存储适配均在首发实施范围，不因上述延期条目被排除，也不据此重写全系统。

## 10. 官方资料与代码依据

2026-11-16 本轮核查的技术资料列于下表。具体实现需固定版本；资料显示可行不等于本项目已实测。招聘与项目来源统一列在[研究依据](RESEARCH_AND_DECISIONS.md)，产品要求来自用户补充材料。

| 编号 | 来源 | 支持内容 |
| --- | --- | --- |
| B1 | [基线 schema](https://github.com/zaenzhang/LexOrder/blob/2997b54754565081271ca4b66139949d310e2fe0/prisma/schema.prisma) | 客户、事项、证据、文档版本、责任与任务现状 |
| B2 | [文本提取](../src/lib/documents/text-extraction.ts)、[OCR](../src/server/ocr/provider.ts) | 通用抽取与短信 OCR 边界 |
| B3 | [AI 审查](../src/server/ai/review-document.ts)、[材料资格](../src/server/ai/document-access.ts) | 截断、输入范围与 AI 授权 |
| B4 | [模型客户端](../src/lib/ai/client.ts)、[配置](../src/lib/ai/settings.ts)、[网络校验](../src/lib/net/safe-url.ts) | 本地模型连接需要独立策略 |
| B5 | [队列](../src/server/cron/queue.ts)、[worker](../src/server/cron/worker.ts) | 去重、领取、租约与完成条件 |
| B6 | [开发运行器](../tools/cloud-dev/run.mjs)、[Next 配置](../next.config.mjs) | 托管 PG 原型基础与动态/原生依赖 |
| B7 | [文书服务](../src/server/documents/actions.ts)、[PG 守卫](../prisma/migrations/20260921000005_restore_db_guards/migration.sql) | 复用审批和数据库约束 |
| B8 | [二开吸收与验证](https://github.com/zaenzhang/LexOrder/blob/690232270b46e1f1b105df11bdff167fe7afb80d/docs/FORK_INTEGRATION_20261116.md)、[传票首页解析](../src/server/ai/parse-summons-local.ts)、[独立调度](../src/server/cron/standalone.ts) | 已合入能力及局部解析、单实例、补扫/备份限制 |
| B9 | [session](../src/lib/auth/session.ts)、[proxy](../src/proxy.ts)、[providers](../src/components/providers.tsx)、[事项详情](../src/app/(app)/matters/[id]/page.tsx)、[模板引擎](../src/lib/template-engine.ts)、[instrumentation](../src/instrumentation.ts) | 页面与认证耦合、本机操作者切口、模板副作用及调度入口 |
| N1 | [Next 静态导出](https://nextjs.org/docs/app/guides/static-exports) | 动态能力限制 |
| N2 | [Next standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) | server.js、静态资源与 Windows 打包边界 |
| N3 | [Next 部署方式](https://nextjs.org/docs/app/getting-started/deploying) | 可直接 Node、Docker 或托管平台运行 |
| N4 | [Next custom server](https://nextjs.org/docs/app/guides/custom-server) | custom server 与 standalone 的限制 |
| E1 | [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security) | 进程隔离、IPC 与远程内容 |
| E2 | [Electron 原生模块](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules) | ABI/打包兼容 |
| E3 | [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model) | 全进程边界；没有据此测得 LexOrder 内存 |
| T1 | [Tauri Node sidecar](https://v2.tauri.app/learn/sidecar-nodejs/) | 保留 Node 的替代桌面路线 |
| L1 | [LanceDB JS SDK](https://lancedb.github.io/lancedb/js/) | 本地连接、原生库与平台 |
| L2 | [LanceDB FtsOptions](https://lancedb.github.io/lancedb/js/interfaces/FtsOptions/) | 分词选择与版本核验 |
| R1 | [RAGFlow v1.0.0 正式发布](https://github.com/infiniflow/ragflow/releases/tag/v1.0.0) | 固定首个联调版本；解析管线、Agentic Chat 与发布边界，非 LexOrder 已实测 |
| R2 | [RAGFlow 1.0 HTTP API](https://ragflow.io/docs/v1.0.0/http_api_reference) | 解析/检索、文档范围、模型配置及知识汇总语义；需实际适配验证 |
| R3 | [RAGFlow 1.0 共享与权限](https://ragflow.io/docs/v1.0.0/guides/team/resource_sharing/resource_sharing_and_permissions) | Only me/Team 与文档权限，不能替代 LexOrder 事项授权 |
| R4 | [RAGFlow 1.0 Quickstart](https://ragflow.io/docs/v1.0.0/) | 配套服务部署与模型配置，资源建议不作为本项目性能门禁 |
| P1 | [PostgreSQL 升级](https://www.postgresql.org/docs/current/upgrading.html) | 数据库大版本迁移 |
| P2 | [PGlite Socket](https://pglite.dev/docs/pglite-socket) | 单连接与多连接适配限制 |
| P3 | [PGlite 原理](https://pglite.dev/docs/about)、[官方 npm 元数据](https://registry.npmjs.org/@electric-sql%2fpglite/0.5.16)、[SQLite serverless](https://www.sqlite.org/serverless.html) | 嵌入式运行与固定版本，非 LexOrder 性能证明 |
| P4 | [socket 问题 #1046](https://github.com/electric-sql/electric-pglite/issues/1046) | 多连接消息交错及内部错误风险，核查时仍开放 |
| P5 | [修复提案 #1094](https://github.com/electric-sql/electric-pglite/pull/1094) | 内部异常队列恢复提案，核查时未合并；不视为已修复 |
| P6 | [PGlite tools](https://pglite.dev/docs/pglite-tools) | 逻辑导出与连接状态边界 |
| P7 | [PGlite upgrade](https://pglite.dev/docs/upgrade)、[文件系统](https://pglite.dev/docs/filesystems) | 目录持久化、逻辑迁移及版本边界 |
| V1 | [隔离兼容脚本](../tools/personal-storage-spike/verify.mjs)、[固定依赖](../tools/personal-storage-spike/package-lock.json) | 第 2.3 节实际运行的可复现检查；不属于应用依赖或生产运行器 |
| A1 | [AnythingLLM Desktop](https://docs.anythingllm.com/installation-desktop/overview) | 单人与团队交付区别 |
| A2 | [AnythingLLM LanceDB](https://docs.anythingllm.com/setup/vector-database-configuration/local/lancedb) | 内置向量组件 |
| C1 | [Cherry 本地模型](https://www.cherryai.com/docs/en/pre-basic/settings/local-models/) | 模型管理、离线与平台边界 |
| O1 | [Ollama FAQ](https://docs.ollama.com/faq) | 可选本地模型的加载/上下文/并发参考；非首发前置，未在本轮实测 |
| F1 | [appleoppa 固定 README](https://github.com/appleoppa/LawLink/blob/535a3531aa79edea1c1c6524fd6748d630170718/README.md) | 二开增强与未接线说明 |


## 11. 当前源码的开发、部署与恢复

本节归并原安装、云开发、二开接续及运维说明，适用于当前已有的 Server 源码。Personal 安装包与含 RAGFlow 的完整 Server 发行配置仍按 W13/W17 实施；本节命令不能替代双产物验收。当前脚本与配置以 [package.json](../package.json)、[环境模板](../.env.example)、[Dockerfile](../Dockerfile)、[Compose](../docker-compose.yml) 为准。

### 11.1 环境、初始化与凭据

使用与当前 CI/容器一致的 Node.js 22、npm、PostgreSQL 16；源码命令适用于 Linux、macOS 或 WSL。首次在独立开发环境安装依赖，并且仅在尚无私有 `.env` 时由模板创建；已有实例保留其连接、密钥和存储目录。

| 配置 | 要求 |
| --- | --- |
| `LEXORDER_RUNTIME_MODE` | Server 启动配置使用 `SERVER`；请求、cookie 或界面不能改变运行模式 |
| `DATABASE_URL` | 指向本次明确使用的库。Compose 的宿主访问 URL 与 `POSTGRES_DB/USER/PASSWORD/PORT` 对应；容器内部使用 `db:5432` |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | URL 对应实际 Server 入口；secret 独立随机生成，生产经 HTTPS 入口使用 |
| `STORAGE_ENCRYPTION_KEY` | 独立随机的 32 字节 base64 密钥；已有数据必须沿用原值，不能随部署重新生成 |
| `APP_STORAGE_DIR` | 应用、备份和恢复使用同一实际持久目录；不要只持久化数据库 |
| `SEED_ADMIN_EMAIL/NAME/PASSWORD` | 仅用于 Server 首次管理员初始化；自行设置强密码，不能使用模板或 seed 中的演示默认值 |

两个密钥分别生成，例如各运行一次 `openssl rand -base64 32`，存入私有配置并独立保管。云开发运行器要求数据库密码与首次管理员密码至少 16 个字符。

全新独立 PostgreSQL 环境的顺序见[根 README 源码运行](../README.md#源码运行)：`npm ci` → `npm run prisma:generate` → `npx prisma migrate deploy` → `npx prisma db seed` → `npm run dev`。数据库容器需先启动并就绪。首次 seed 只建立管理员、字典、规则、配置和内置模板；不写入演示案件。已有管理员不会因重跑 seed 自动改密码，已有实例更新用第 11.4 节。

上述账号初始化只属于现有 Server；Personal 的首次打开只建立/选择工作区、稳定本机操作者及空业务数据，不沿用 Server 账号/岗位初始化。

### 11.2 无 Docker 的云开发与隔离验收

[开发运行器](../tools/cloud-dev/run.mjs) 在 `.runtime/cloud/pgdata` 管理独立 PostgreSQL，依赖单独锁定于 `tools/cloud-dev`。它固定 `SERVER` 并显式拒绝非 Server 模式；使用私有 `.env` 中的 loopback 数据库地址，要求显式端口、库名和强密码，只新建不存在的开发/验收库，已有目录继续复用。根 `npm run dev` 仍是开发预览入口，不代替生产构建与 HTTP 验收。

```bash
npm ci
npm ci --prefix tools/cloud-dev
npm run prisma:generate
npm run build
node tools/cloud-dev/run.mjs serve
```

`serve` 执行开发库迁移与基础 seed，再启动 `.next-build` 生产构建；停止时在拥有该进程的会话使用正常终止信号。出现 `postmaster.pid` 时先确认并正常停止原进程，不删除锁文件强行复用数据目录。不同执行会话不一定共享 loopback 网络，应用与其数据库应由同一运行器管理。

| 模式 | 用途与隔离范围 |
| --- | --- |
| `serve` | 启动当前源码开发页面，仍使用 Server 登录；不会形成个人安装包 |
| `test` | 对 `<开发库名>_acceptance_test` 执行迁移、结构核对及测试，不在开发库执行测试清理 |
| `verify` | 在同一独立验收库执行测试、seed、生产服务及 HTTP 核查；可用 `WORKBENCH_QA_SCRIPT` 指向受审阅的绝对脚本路径 |

验收另用运行目录内的 `acceptance-storage` 和独立 `acceptance-storage.key`，与开发原件、密钥分离。运行器默认关闭 cron 和自动备份，内置 PG 包不自带 `pg_dump`；开发就绪不表示备份、独立 worker 或完整浏览器流程已通过。

托管预览仅在环境明确提供 `sites-preview` 与 `SITES_MANAGED_LINUX_CONTAINER=1` 时使用 [preview-server.mjs](../tools/cloud-dev/preview-server.mjs)，由预览管理器传入端口与入口地址，并使用独立的 `.runtime/managed-preview`。旧会话地址不是永久发布地址；预览停止使用管理器的生命周期，临时运行环境不承担生产数据保管。

### 11.3 部署、调度与可选服务

根 Compose 的 `full` profile 提供已有 Web 应用与 PostgreSQL，尚未包含 RAGFlow。M1 的 `tools/workbench-m1/prepare-ragflow.mjs` 已提供固定来源和镜像的配套准备入口，但状态为 `PREPARED_NOT_DEPLOYED`；当前无 Docker/Podman，未验证该配置的实际部署。现有业务镜像包含脚本所需源码、`tsx`、Bash、PostgreSQL 客户端和 Next 配置，不沿用旧指南临时挂载源码才能 seed 的假设。

本轮真实服务检查使用 `npm run verify:services --prefix tools/workbench-m1 -- --mode=server`，只检查 Server 生成 API 与 RAGFlow 合成材料链；默认 `all` 仅保留兼容，本轮不运行。当前两项均为 `NOT_CONFIGURED`、退出码 2，表示缺真实服务/模型配置，不是联调成功。RAGFlow 服务凭据与其嵌入模型配置、LexOrder 生成模型凭据分别提供，不能互相替代。

容器首次安装依次完成：构建 app 镜像、启动并等待数据库就绪、在一次性 app 容器运行 `npx prisma migrate deploy`、明确传入私有 `SEED_ADMIN_*` 后运行 `npx prisma db seed`、再启动正式 app。当前 Compose 没有转发 `SEED_ADMIN_*`，仅修改宿主 `.env` 不会自动注入；使用明确的私有 Compose override 或等效注入配置，不把初始密码写入仓库。已有实例不重复初始化管理员。

部署时核对实际转发的环境变量、持久卷及网络入口；默认端口映射不自动提供 HTTPS 或网络隔离。`dev` profile 的 Mailpit 仅为开发收件箱。不得把 Compose 中的历史容器名或包版本号当成新的 LexOrder 正式 release。

| 运行方式 | 调度约定 |
| --- | --- |
| `npm run start:with-cron` | 监督器启动 Web 与一个独立 worker；Web 设置 `DISABLE_CRON=1`，worker 单独启用调度，任一子进程退出时终止另一进程 |
| 分别管理 Web 与 `npm run cron:worker` | Web 显式关闭进程内 cron，worker 只运行一个实例；由进程管理器负责重启和退出 |
| 单独 `npm start` | 沿用已有进程内调度；不能同时再启动独立 worker |

监督器默认监听 `127.0.0.1:3000`，按部署设置 `LEXORDER_HOST/PORT`。数据库迁移由安装/更新流程执行，启动命令不代办。已有启动补扫覆盖最近 15 分钟漏跑的部分任务，周报按用户/周去重；不等于完整休眠恢复、跨实例去重或备份补跑。worker 关闭等待与监督器终止期限也不保证长备份必然完成。具体入口见 [run-with-cron.mjs](../scripts/run-with-cron.mjs)、[standalone.ts](../src/server/cron/standalone.ts)。

| 可选能力 | 配置与当前边界 |
| --- | --- |
| cncases 外部案例服务 | `CNCASES_BASE_URL` 为服务根地址，不含路径前缀、用户信息、查询或 fragment；浏览器跳转可另配 `CNCASES_PUBLIC_URL`，未配置时不泄漏内部地址。默认拒绝私网端点，仅受信本机/内网服务显式启用 `CNCASES_ALLOW_PRIVATE=true` |
| 元典法规检索 | 复用系统管理中的供应商配置及已有接口适配；需要真实账号权益和接口联调，不能把摘要当完整法规或无服务当零结果 |
| 传票首页解析 | PDF 先提取第一页文本；图片/扫描可选 Tesseract 的 `chi_sim+eng`，扫描 PDF 另需 `pdftoppm`。可配 `SUMMONS_TESSERACT_BIN` / `SUMMONS_PDFTOPPM_BIN`；当前默认镜像未安装这些 OCR 工具 |

cncases 保留服务端授权、超时、2 MiB 响应上限、禁重定向与同源链接检查，不内置裁判文书语料。传票识别仍仅处理首页；后备视觉 API 接收首页图像，缺时间不补造默认开庭时刻，也不把出具日期当开庭日期。外部服务失败、未配置和无结果分别呈现。这些已有模块不替代规划中的通用 OCR 或两版 RAG。

### 11.4 更新与旧版本边界

已有、迁移链明确的 LexOrder 实例先保留可恢复副本，停止对应写入和 worker，在目标代码版本执行：

```bash
npm ci
npm run prisma:generate
npx prisma migrate deploy
npm run templates:sync
npm run build
```

然后按既有进程管理方式启动，检查健康、实际登录和受影响业务。`templates:sync` 同步已有基础/执行模板；不是迁移数据的替代步骤。容器采用相应的新镜像和一次性迁移/模板同步任务；不得为了追赶 schema 使用 `db push`、reset 或删除现有迁移记录。

历史 LawLink 1.3.x 的基线转换有特定起始状态、增量 SQL 和 migration resolve 顺序，仅按[固定历史升级指南](https://github.com/zaenzhang/LexOrder/blob/690232270b46e1f1b105df11bdff167fe7afb80d/docs/RELEASE-GUIDE-v1.3.md)与 [prisma/upgrade](../prisma/upgrade/v1_3_x_to_v1_4_0.sql)识别适用范围，在副本演练；它不是任意旧版本到当前 LexOrder 的通用升级命令，也不代表本轮已验证升级。PostgreSQL 大版本升级另遵循第 10 节 [P1]。

旧财务试迁移与切换准备脚本属于历史演练工具，不进入安装/升级步骤。原 `docs/` SQL 与[归档迁移](../prisma/migrations-archive-20260921/20260919000002_business_workflow_repair/migration.sql)内容完全相同，两个脚本复用归档文件；模型 hash 与目标库预检保持原样。切换准备产物写入忽略提交的 `.runtime/workflow-cutover-20260919`；不将归档 SQL 放回当前迁移链，也不通过修改历史 schema 绕过预检。

### 11.5 备份、恢复与密钥

[备份任务](../src/server/cron/jobs/backup-database.ts)和 `npm run backup:now` 调用 [scripts/backup.sh](../scripts/backup.sh)，生成 PostgreSQL custom dump、存在的本地原件目录归档和 manifest。运行需要 Bash、与服务端兼容的 `pg_dump`、可写持久目录；`BACKUP_DIR` 和 `BACKUP_KEEP` 管理输出和保留数量。手动命令是显式备份请求，不受 `BACKUP_CRON_ENABLED=false` 的自动任务开关限制。

`BACKUP_PASSPHRASE` 可加密备份产物，未配置时产生未整体加密的备份；它与文件主密钥用途不同。脚本不自动打包 `STORAGE_ENCRYPTION_KEY`、完整私有配置或 S3 对象，需独立保存原密钥、必要配置和实际对象存储副本。Compose 的 `backups` 命名卷仍与主机同在，不能当作异地副本；原件目录缺失时脚本会跳过，不能仅凭退出成功判定备份完整。

恢复时以隔离实例核对版本、目标库、备份 manifest、原件路径及密钥，先验证数据/权限，再开放业务和检索。数据库和文件需要同一一致性时点，备份期间应停止相关写入或使用已验证的一致性方案。已有新写入后的回退另行处理数据，不能直接覆盖旧备份抹去新增事实。

当前 [restore.sh](../scripts/restore.sh) 仍使用旧 `STORAGE_PATH` 变量、只直接读取未加密的 dump/tar 文件，并会跳过缺失文件；使用前须核对实际 `APP_STORAGE_DIR` 与归档结构、处理解密，并在隔离目标验证。它尚不能作为完整的一键恢复保证。本轮只保留并核对说明，成功备份/恢复、对象存储恢复及将来的 RAGFlow 状态恢复仍需 W13 验收，不能用备份失败路径测试代替。

`STORAGE_ENCRYPTION_KEY` 同时关系到附件、证件号密文与盲索引；只换环境变量或派生域会破坏现有数据读取/检索。当前没有已完成的自动密钥轮换工具，轮换需要明确的旧数据解密/重加密、盲索引重建、恢复副本与一致性验证方案。未来两版 RAG 的恢复还须核对文档版本、解析/嵌入指纹、索引代次和服务端绑定；先恢复当前授权，索引按固定配置重建。
