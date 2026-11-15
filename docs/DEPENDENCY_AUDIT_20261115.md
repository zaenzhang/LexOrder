# 首次 GitHub CI 依赖审计修复

日期：2026-11-15。触发证据：[首次 CI](https://github.com/zaenzhang/LexOrder/actions/runs/43727848956)，源码提交 `4f9d52f`。

## 问题与实施范围

首次上传已经完成，云内应用启动通过；GitHub CI 的 `npm audit` 报出 22 项依赖问题（2 low、13 moderate、6 high、1 critical），其后的构建和测试因此未执行。这是本次上传后观察到的新证据，不能以此前功能测试通过替代依赖审计。

本批只处理这项 CI 阻塞：优先升级当前主版本内的修复版本并更新锁文件；单独核实 Zod 与表单适配器的兼容性。保留原有审计门禁，不通过忽略漏洞、降低审计等级或降级认证框架消除失败。

重点包括 Next.js、Undici、Nodemailer、Zod、Sharp、Vitest/Vite，以及 ESLint 和文件解析链的间接依赖。涉及行为变化时只调整必要的兼容代码，保持业务权限、审计、数据库及已有数据语义。

## 验证要求

1. 安装锁文件与依赖审计通过。
2. 类型、lint、Prisma、生产构建通过。
3. 与依赖升级相关的功能回归、真实数据库客户维护和 HTTP 登录流程通过。
4. 推送后确认 GitHub CI；实际结果另行补记，不将计划标为通过。

## 实施结果

| 依赖 | 当前锁定版本 |
| --- | --- |
| Next.js / eslint-config-next | 16.4.6 |
| Undici | 7.30.2 |
| Nodemailer | 10.5.0 |
| Zod / React Hook Form resolver | 4.6.7 / 7.0.6 |
| Sharp | 0.35.5 |
| Vitest / Vite | 4.1.12 / 8.3.8 |
| typescript-estree 子树的 minimatch | 11.0.1 |

仅在 `@typescript-eslint/typescript-estree` 内定向覆盖 minimatch，其余旧 API 子树保留自身兼容版本。直接依赖与 Nodemailer override 同步提高修复下限，认证框架仍为 NextAuth 4。

Zod 直接使用修复后的 v4，没有转向未包含本次集合上限补丁的 `zod/v3` 兼容入口。为此同步修复了中文错误参数、字符串键记录、7 处表单输入／输出类型、自定义字段局部更新默认值，以及实际解析错误的中文 digest。受理日期支持表单字符串与已解析 Date 的服务端二次核验，缺省值仍不参与局部更新。

相关主源：[Zod 公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、[minimatch 公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)、[表单适配器 v7.0.6](https://github.com/react-hook-form/resolvers/tree/v7.0.6)。

## 实际验证（2026-11-15）

- `npm audit --json`：**0 项已知漏洞**；这是本次运行时的数据库结果，不是长期安全保证。
- 类型检查、Prisma 校验、lint 与生产构建通过；lint 保留一条既有内部导航写法 warning，没有错误。
- 独立 PostgreSQL 16.15：4 个迁移成功，模型无漂移。
- `node tools/cloud-dev/run.mjs verify`：**108 个文件、797 项测试全部通过**，含 10 项真实数据库客户维护测试。
- 生产应用的 HTTP 健康、登录／CSRF／会话、客户沟通与跟进、完成及下一项、跨用户权限隔离、22 份内置模板解密与校验值检查通过。
- 本批新增 5 项定向回归，覆盖局部更新保留设置、表单转换和中文错误，以及同步／异步校验错误通道。

本次没有修改数据库结构、CI 审计门禁或业务权限。真实浏览器和手机视觉、公网托管及供应商联调仍按原验证文档保留为未完成。维护提交推送后由 GitHub CI 再次执行独立环境检查，最新结果以仓库 Actions 为准。
