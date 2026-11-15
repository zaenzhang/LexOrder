# 律序 · LexOrder 云开发环境搭建与复现

LexOrder 基于 LawLink v2.0.1。源码仓库为 [zaenzhang/LexOrder](https://github.com/zaenzhang/LexOrder)。应用沿用 Next.js、Prisma 和 PostgreSQL；当前云环境没有 Docker，因此另提供原生 PostgreSQL 开发运行器。它用于开发和验收，正式服务器部署仍参考 [上游云服务器指南](CLOUD-SERVER-INSTALLATION-GUIDE.md)。

## 1. 环境和安装

需要 Node.js 22 或更新版本、npm、Git。原生数据库工具固定为 `embedded-postgres@16.15.0-beta.19`，实测启动 PostgreSQL 16.15。数据库为真实 PostgreSQL，Prisma 迁移、外键、枚举、触发器、行锁和事务均实际执行。

```bash
git clone https://github.com/zaenzhang/LexOrder.git
cd LexOrder
npm ci
npm ci --prefix tools/cloud-dev
cp .env.example .env
```

仅在不存在 `.env` 的新环境复制模板。编辑 `.env`：

- `DATABASE_URL`：专用于这个开发环境，例如 `postgresql://lexorder:替换为随机强密码@127.0.0.1:55432/lexorder?schema=public`。运行器只接受 loopback 地址、显式端口和至少 16 字符的数据库密码。
- `NEXTAUTH_URL=http://127.0.0.1:3000`。
- `NEXTAUTH_SECRET`：独立随机值。
- `STORAGE_ENCRYPTION_KEY`：独立生成的 base64 编码 32 字节密钥；保管好它，已有密文不能随意更换密钥。
- `SEED_ADMIN_EMAIL`、`SEED_ADMIN_NAME`、`SEED_ADMIN_PASSWORD`：初始管理员与至少 16 字符随机密码。seed 不会覆盖已有账号的密码。
- `APP_STORAGE_DIR=./storage`。

可分别运行 `openssl rand -base64 32` 生成随机值，在本地安全保存。不要把真实值放进仓库、截图或工单。`.env` 权限建议设为 `0600`。

```bash
chmod 600 .env
npm run prisma:generate
npm run prisma:validate
npm run typecheck
npm run lint
npm run build
```

## 2. 启动应用

```bash
node tools/cloud-dev/run.mjs serve
```

运行器按顺序完成：

1. 在 `.runtime/cloud/pgdata` 创建或复用原生数据库，默认仅监听 `127.0.0.1`，启用 SCRAM 密码认证。
2. 创建独立的开发库及 `<开发库名>_acceptance_test` 验收库；存在时不重建。
3. 对开发库运行 `prisma migrate deploy`，不使用 `db push`。
4. 执行原有 `prisma/seed.ts`，仅初始化管理员、字典、规则、配置和内置模板。
5. 启动 `.next-build` 生产构建并检查 `/api/health`。

应用与数据库在同一个父进程内运行。终端保持运行，按 Ctrl+C 正常停止。数据库文件在 `.runtime`，原始文档在 `APP_STORAGE_DIR`；两者均不提交 Git。

本运行器固定关闭 cron 和自动备份。原生包没有 `pg_dump`；不能把它视为生产备份方案。客户待跟进只展示到期／逾期状态，当前没有邮件、短信或其他自动提醒送达。

若发现 `postmaster.pid`，运行器拒绝另起数据库；先在原有会话正常停止。不要自动删除 PID 文件，不要让两个隔离会话同时使用同一个数据目录。

## 3. 当前云环境的访问边界

本次观察到不同执行会话拥有隔离的 localhost 和 PID 空间。因此数据库、迁移、应用及自动化浏览器检查必须由同一个运行器派生。另开终端执行 `curl localhost` 的失败不能直接说明应用已停止。

本次环境没有提供可调用的公网预览或端口转发工具。`http://127.0.0.1:3000` 是运行会话内部地址，不是用户电脑可直接打开的公网地址。云内启动和验收不等于长期公网托管；正式上线需固定服务器、域名、HTTPS、数据库和文件持久卷，以及经过恢复演练的备份。

## 4. 验证

普通单测：

```bash
npm run test:run
```

未设置 `WORKBENCH_TEST_DATABASE_URL` 时，真实 PostgreSQL 集成套件明确跳过；单测使用随机临时加密密钥，不依赖部署密钥。

真实数据库验收：

```bash
node tools/cloud-dev/run.mjs test
```

运行器迁移独立 `_acceptance_test` 数据库，再执行全部测试。验收文件使用 `.runtime/cloud/acceptance-storage`，专用加密密钥持久保存在 `.runtime/cloud/acceptance-storage.key`（0600）；不会与开发文件和密钥混用。测试包括真实事务回滚、重复提交、并发完成、撤权、客户归属、跨客户 ID、取消和合并。测试账号使用合成标识，结束时停用；合成客户软删除，审计记录保留，不关闭审计保护。

UI 验收可使用同一执行会话下的 Playwright；本次环境中 Chromium 因 Unix socket `EPERM` 无法启动，故真实浏览器和手机视觉验收尚未完成。以下是具备浏览器运行条件后的入口，可通过 `WORKBENCH_QA_SCRIPT` 提供本地验收脚本：

```bash
WORKBENCH_QA_SCRIPT=/absolute/path/to/check.cjs node tools/cloud-dev/run.mjs verify
```

`verify` 先完成数据库、结构漂移检查和单测，随后只在 `_acceptance_test` 数据库运行 seed、应用和真实 HTTP 登录／客户页面验收，再执行可选的浏览器脚本，结束后停止服务。内置检查直接调用业务服务创建和完成记录，再用真实 HTTP 会话检查服务端渲染页面；另检查持久模板的解密与校验值。它不覆盖浏览器点击、表单提交 Server Action 或视觉布局。

## 5. 外部服务与上线

AI、元典等沿用 LawLink 的管理后台配置和加密设置机制。此次没有用户提供的 API 权益和密钥，因此没有验证真实模型调用或收费法律数据库查询。后续 RAGFlow 接口、材料解析链、引用和法律版本信息按 [实施计划](WORKBENCH_PLAN.md) 分批接入。

正式上线前应按上游安装指南使用受支持的 PostgreSQL 服务和完整客户端工具；当前开发包装器及本地云会话不提供持久托管、自动备份或高可用承诺。

参考：[embedded-postgres 官方项目](https://github.com/leinelissen/embedded-postgres)、[tsx 官方 Node CLI 文档](https://github.com/privatenumber/tsx/blob/master/docs/dev-api/node-cli.md)。

## 6. 产品命名与兼容性

本分支使用「律序 · LexOrder」，原始版权与上游来源保持不变。部署示例中的用户名和数据库名可自定，现有环境无需为改名重建数据库。加密域、日历事件 UID、历史迁移、已配置的律所名称和已有验证器绑定保持兼容；新绑定验证器显示 LexOrder。已配置钉钉关键词校验的部署，请把提醒关键词同步设置为 `LexOrder`。生成文书前须核对实际律所名称；未配置时显示「【请配置律所名称】」，应补全并复核后再使用。侧栏品牌名称与文书机构信息目前分别保存，产品名不作为律所名称。
