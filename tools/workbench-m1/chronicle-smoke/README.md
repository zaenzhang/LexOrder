# Chronicle 个人工作流定向验收

这些脚本只对隔离运行时中的合成案件写入。它们使用与 Tauri 宿主相同的个人服务、已登记物理目录、工作稿监听与业务事务。原生 WebView 键盘操作、Word 和 Windows 文件关联另行实机验收。

## 准备

1. 按根仓库和 `tools/workbench-m1` 的锁文件安装依赖，生成 Prisma 客户端，再在 `tools/workbench-m1` 用 Bun 1.4.5 执行 `bun run build:personal`。使用独立空目录作为 `M1_WORKSPACE`。先启动一次 `tools/workbench-m1/personal-runtime.mjs` 完成建库，再正常停止，让它释放 `.owner`。
2. 保留同一个 `M1_WORKSPACE`，在仓库根目录运行下面的命令。种子脚本验证 manifest 与数据库的工作区、操作者一致后新建两个合成案件，写入 `chronicle-smoke-cases.json`。它可在运行时退出后使用内嵌数据库，也支持已迁移并由同一 manifest 引导的隔离 PostgreSQL 实例，通过 `DATABASE_URL` 指定本地连接。

```sh
suite=tools/workbench-m1/chronicle-smoke
node "$suite/seed.mjs"
node "$suite/prepare-editor.mjs"
```

3. Linux 编辑器验收使用宿主的 `xdg-open`、`gio`、Vim 的 `ex` 和 `update-desktop-database`。启动运行时的终端使用下列环境。XDG 配置只影响本次启动的进程。准备脚本为 TXT 注册 Vim Ex，打开测试工作稿时会写入一行并保存。

```sh
export M1_READY_FILE="$M1_WORKSPACE/ready.json"
export XDG_CONFIG_HOME="$M1_WORKSPACE/smoke-editor/config"
export XDG_DATA_HOME="$M1_WORKSPACE/smoke-editor/data"
export XDG_CURRENT_DESKTOP=GNOME
node tools/workbench-m1/personal-runtime.mjs
```

4. 在另一个终端使用同一 `M1_WORKSPACE`、`M1_READY_FILE` 依次执行。就绪文件包含本地临时通道凭据，只在测试进程读取。采用独立 PostgreSQL 启动 Next 的测试宿主可生成同格式的私有就绪文件，字段为本机 `origin` 与 `token`。

```sh
suite=tools/workbench-m1/chronicle-smoke
node "$suite/practice.mjs"
node "$suite/resources.mjs"
node "$suite/material-batch.mjs"
node "$suite/material-review.mjs"
node "$suite/skill-commission.mjs"
node "$suite/volumes.mjs"
node "$suite/editor.mjs"
node "$suite/finance.mjs"
node "$suite/contracts.mjs"
node "$suite/operations.mjs"
node "$suite/court-inbox.mjs"
node "$suite/matter-workflows.mjs"
node "$suite/matter-management.mjs"
node "$suite/templates-seal.mjs"
node "$suite/archive.mjs"
node "$suite/document-review.mjs"
```

V8 借贷同案校验覆盖真实入卷、解析、结构化记载落库、旧修订、幂等、跨案和错值拒绝。校验接收固定技能目录及原版脚本独立生成的 `.base.json`。原始样例保持在来源目录，由脚本读入 `examples/demo/materials`。使用同一个隔离工作区设置运行以下命令。

```sh
node --import tsx tools/workbench-m1/chronicle-smoke/fact-chronology.mjs "/path/to/mqc-fact-chronology-master" "/path/to/原版.base.json"
```

代表性图谱规模检查在同一隔离运行时新建一个合成案卷。通过正常转案、入卷和解析入口生成 120 条事项及 12 份原件。回读 5 次案级投影，检查固定原文和两个无庭期程序，记录响应字节和耗时。重复运行会在隔离工作区生成一套新样本。

```sh
node tools/workbench-m1/chronicle-smoke/chronology-scale.mjs
```

## Windows 后台 Chrome 定向验收 · 2026-11-20

- 法院来件日期确认沿用 Chronicle 邮件的列表与阅读区思路，三处日期选择复用仓库内 Base UI Select 和 Field。开工前对照 [Chronicle 邮件示例](../../../desktop/personal-chronicle/features/mail/mail-app.tsx)、[Base UI Select](https://base-ui.com/react/components/select) 和 [shadcn Field](https://ui.shadcn.com/docs/components/base/field)。
- 在热更新页面使用浏览器合成候选验证 1440 px 与 390 px、键盘打开、Esc 归焦、无匹配事项、切换程序清空旧选择，以及核对原件前禁用提交。检查送达登记请求的程序、日期和时刻。隔离运行时另跑 `court-inbox.mjs`，验证附件去重、归案后原文回读与跨案限制。
- **冒烟问题 · 已复验。** 首次浏览器脚本读取了下拉列表节点的样式属性，实际样式标签在外层弹窗。Esc 回焦发生在收起过渡之后。改为确认外层节点并等待真实焦点，复验通过。
- **冒烟问题 · 已复验。** Node Fetch 会调整部分请求头，无法用来确认错误 Host 和跨站请求。用 Node HTTP 发送原始请求头后，错误 Host、外部 Origin 和跨站请求均获拒绝，同源已登录请求正常回读。

## WebView2 后台验收

在 Windows 本机完成下文的统一桌面构建。在同一工作树用锁文件安装 `tools/workbench-m1` 的依赖。 `$repo` 设为本机工作树绝对路径， `$qaTarget` 设为独立 Cargo 构建目录， `$fixture` 指向已生成双案和事实样本的本机合成工作区。

```powershell
$env:CARGO_TARGET_DIR = $qaTarget
Set-Location (Join-Path $repo 'tools/workbench-m1')
bun run desktop --build-only
$env:M1_WORKSPACE = $fixture
node (Join-Path $repo 'tools/workbench-m1/chronicle-smoke/webview2.mjs') (Join-Path $qaTarget 'debug/lexorder-chronicle-preview.exe')
```

脚本启动隐藏的 Tauri 测试窗口和它自己的 Sidecar。Playwright 通过 WebView2 的本机调试端口检查双案和图谱。退出后等待合成工作区解锁。

规模验收使用同一隐藏原生窗口和标准合成案生成器。将 `M1_WORKSPACE` 指向可写的隔离合成工作区，将 `M1_CHRONOLOGY_CASEBOOK_ROOT` 指向该工作区外可写的合成案卷目录。传入 `--scale` 后新建一套 12 份 TXT 和 120 条事件的合成案卷，并检查聚合、拖动、分轨、回放、原文回读和窄窗。此模式不依赖预置双案。若从已有 Windows 隔离包运行，`LEXORDER_DESKTOP_ROOT` 可指向包含同步过的 Sidecar 业务产物的绝对目录。

```powershell
$env:M1_CHRONOLOGY_CASEBOOK_ROOT = $casebookRoot
node (Join-Path $repo 'tools/workbench-m1/chronicle-smoke/webview2.mjs') (Join-Path $qaTarget 'debug/lexorder-chronicle-preview.exe') --scale
```


外部编辑验收复用同一隔离运行时和案卷目录，改用 `--editor`。Windows 应已将 TXT 关联到 Microsoft Store 版记事本。脚本从真实材料页打开合成工作稿，使用 Windows UI Automation 定向保存测试标签页，退出案内页面后等待宿主自行回传。无需占用物理鼠标、发送全局按键或改文件关联。

```powershell
node (Join-Path $repo 'tools/workbench-m1/chronicle-smoke/webview2.mjs') (Join-Path $qaTarget 'debug/lexorder-chronicle-preview.exe') --editor
```

从 WSL 检出通过 UNC 路径运行时，`RemoteSigned` 可能拒绝直接执行 PowerShell 帮助脚本。将仓库内已核验的 `windows-editor/save-notepad.ps1` 发布到现有 Windows 合成验收目录，再将 `M1_WINDOWS_EDITOR_SCRIPT` 指向该本地绝对路径。无需修改执行策略。

```powershell
$env:M1_WINDOWS_EDITOR_SCRIPT = Join-Path $casebookRoot 'save-notepad.ps1'
Copy-Item -LiteralPath (Join-Path $repo 'tools/workbench-m1/chronicle-smoke/windows-editor/save-notepad.ps1') -Destination $env:M1_WINDOWS_EDITOR_SCRIPT
```

案卷整理验收使用相同的合成工作区和案卷根目录，传入 --materials。脚本检查历史版本离开当页后的归类约束、跨两页批选、取消和保存后的焦点、固定原件字节，以及窄窗卷宗排序、过时基线拒绝和刷新后顺序回读。

```powershell
node (Join-Path $repo 'tools/workbench-m1/chronicle-smoke/webview2.mjs') (Join-Path $qaTarget 'debug/lexorder-chronicle-preview.exe') --materials
```

需要跨案出处复验时，在脚本命令末尾加 `--cross-case`。该路径使用已装载 V8 案情定位和借贷样本的合成验收甲，检查按事实换读材料、同一 PDF 的不同页锚点、分别定位三份文本及未关联出处的状态。核对表单的触发器与下拉选项字号，以及固定原文面板的宽窄布局，属于常规验收。

**本轮冒烟记录**

- **已修复 · 材料记录验收定位。** 新增分组菜单后，旧脚本按名称前缀会同时找到分组按钮和菜单按钮。改为按「材料记录 · N 份材料」定位，复验通过。已覆盖展开材料、打开固定原文、返回后保留材料展开状态。

- **已修复 · 热更新启动器。** Next.js 16.4.6 Turbopack 在客户端切路由后可能缺少该路由的 HMR 订阅。独立 Tauri 复现中，先点链接再改组件，调试连接建立但前台和恢复后都收不到模块更新。完整加载同一路由后再次编辑，模块更新立即到达。改为 Next.js 的 Webpack 开发模式后，独立窗口在最小化期间修改、恢复后看到新内容，且保持同一文档。启动器的打包器变更在下次启动或 `restart-chronicle` 生效。[Next.js 复现](https://github.com/vercel/next.js/issues/98699)
- **已修复 · 测试窗口状态。** 此 WebView2 实例在 Windows 已最小化时仍报告 `document.hidden === false`，依赖该属性的检查会超时。最小化及恢复用 Tauri 的 `isMinimized()` 确认。隔离 Webpack 实例首次编译超过原有 15 秒页面等待，验收应给冷编译预留时间。
- **已修复 · 脚本。** 侧栏链接与面包屑同名，测试限定到主导航。窄窗自动定位详情后有时已经滚到页底，滚轮改为从详情向上验证页面滚动。
- **已修复 · 折叠验收。** 详情压缩后原 900 px 高窗口的正文无需滚动，旧脚本的溢出断言失败。现用 680 px 高的宽窗验收展开后的独立滚动，同时保留 950 px、390 px 宽的窄窗检查。
- **已记录 · Next.js 开发模式。** Windows WebView2 接入 WSL 热更新时，Turbopack 和 Webpack 均观察到 React Server Components 首屏性能计时警告 `cannot have a negative time stamp`。验收脚本只将匹配该消息和对应 React 开发计时堆栈的异常记录为警告。其他页面异常会使验收失败。独立冷启动另外记录过一次服务端流写入异常，随后的案件列表、概览和图谱请求返回 200。

## 检查内容

- 工作稿用两个案件的同名 TXT 核对归属、原件限制、受控签出、Linux 默认编辑器保存、替换写、V1 至 V3 字节及重复事件。脚本只轮询材料详情，等待宿主监听主动回传。随后还原一份旧基线工作稿登记，确认冲突及两份内容保留。200 毫秒安静期用于合并同一次保存的多个文件事件，间隔短于窗口的多次改写可能合并。工作台重新打开时检查已登记工作稿并恢复监听。
- 财务验证以原请求键重试收支登记、本人实际到账确认、错案拒绝、退回和读回。已退回登记的原键再试不能重新生成流水。
- 办案事务验证快递登记和案件边界、保全对象与财产同笔登记、续期历史、归档阻断和收尾安排修订。快递样本使用合成运单，无外部物流服务依赖。
- 法院来件验证重复粘贴与附件去重、待入卷文件处置说明、确认归案后按固定材料 ID 读取原件、分案读取、过期跨案绑定和已处理记录。
- 结构化委托验证从当前争点原子创建研究与委托、固定解析片段、跨案拒绝、错误引用、重复回传、律师采用和过时基线。同时验证同一争点分页、从采用后的研究回查、引用片段按需读取和跨案拒绝，核对重开前后应用模型回执仍为空。脚本默认使用固定的合成候选。隔离工作区未配置 AI 时，可加 `--native-ai-disabled` 校验配置状态和提交前的派发阻断。加 `--follow-up` 验证 A-118 合成补件、固定解析复用、句段替换、独立人工取舍保留、过时和被人工改写的复核基线。加 `--material-impact` 验证材料族更新只提示实际引用该族的核对项，独立文件的同文不会被认作同一版本。用独立一次 `--linked-supplement` 演练关联两份补件、确认为新研究基线、过时与跨案拒绝、逐项采用及续办。
- 材料核对验证无庭期程序、环节入卷与跨案限制、指定两件按原顺序返回、固定原件下载、重复选件，以及今日办理的三个视图。等待单机队列完成解析后核验预检与零供模回执。任务核对意见覆盖 PDF 第二页与另一份原件、全案范围选材、并发重复保存、空白与重复来源、跨案与超页、过时任务修订、已办结拒绝、历史与办理记录回查。

验收完成后正常停止运行时。每次重跑只在已准备的合成工作区生成新的样本。

设置 `M1_CHRONICLE_ORIGIN` 时应指向提供案卷 API 的统一回环服务。客户/收案脚本覆盖补正版本冲突、撤回重提与转案；资料脚本检验新版列表、两版原始字节、版本链和 Excel。

## Tauri Sidecar 启停与案卷回读

在目标系统安装 Rust、Tauri 系统依赖、Bun 1.4.5 和工作区锁定的 pnpm。执行仓库根目录的 `npm ci`、`npm run prisma:generate`、`npm ci --prefix tools/workbench-m1`，以及 Chronicle 的 `pnpm install --frozen-lockfile`。

1. 在 `tools/workbench-m1` 运行 `bun run build:desktop`。生成一个提供 Chronicle 和案卷 API 的 standalone 服务。
2. 在仓库根目录运行 `bun --no-env-file --no-install tools/workbench-m1/chronicle-smoke/sidecar.mjs <新合成工作区绝对路径>`。该脚本验证静态深链接、鉴权、重复占用、建案、恢复、旧会话拒绝和 EOF。
3. 在 `tools/workbench-m1` 运行 `bun run desktop <合成工作区绝对路径>`。打开合成案卷，退出，重启，再打开同一案卷。按需要在双案间切换，核对固定版本材料下载。
4. 使用 `bun run desktop --package` 生成目标系统安装包。按相同步骤从安装的应用启动，不指定工作副本根目录。
5. 在桌面本地数据目录安装一个[清单示例](../../../desktop/personal-chronicle/docs/lexorder-personal-migration.md#插件清单-v1)，确认案卷命令面板可进入当前案卷的指定分区。未知分区或非法清单应显示为无效。

`NEXT_DIST_DIR` 可显式指定工作区根目录下以 `.next-personal` 开头的构建目录。三端自动化见 [Actions](../../../.github/workflows/chronicle-sidecar.yml)。
