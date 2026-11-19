# LexOrder 个人版｜Chronicle 案件迁移

Chronicle v3 是个人版新基线。按网页原流程逐项迁移、文件夹设计与权限处置见 [详细迁移工作计划](lexorder-desktop-migration-plan.md)。案内分区沿用模板的内容区、主题变量、字号、间距和菜单。桌面用单个 Tauri WebView。Chronicle 开发服务器只监听回环地址，访问隔离的 LexOrder 个人运行时。

## Base UI 组件选择

界面、导航与动画变更遵守 [个人版界面约束](../AGENTS.md)。

官方 Quick start 提供组件结构和行为，项目沿用 Chronicle 仓库已经封装的 Base UI 与 shadcn 组件。用 `render` 把按钮样式附在链接上时设置 `nativeButton={false}`。不同业务 URL 由链接和 `aria-current` 表达，同一页面的选择和弹窗由 Base UI 组件负责。

| 位置 | 选用实现 | 业务判断 |
| --- | --- | --- |
| 左上工作空间 | Chronicle 侧栏控件与 Base UI DropdownMenu | 打开时读授权案件第一页。完整列表与搜索从「案件总览」进入。 |
| 案件列表 | Chronicle `DataTable`、Input、Button | 搜索与分页调用现有案件服务。行内链接支持键盘进入案卷。 |
| 案内分区 | Chronicle `NavMain`、PageHeader、Card 与 Badge | 六个主入口追加在原 Workspace 的 Users、Tasks 之后，覆盖八个案内页面。概览仍可由首次选案和案件列表进入。当前 URL 决定工作空间及高亮分区。 |
| 原文出处 | Chronicle Card、Button 和现有同源 PDF 预览 | 固定键包含要点 ID、修订号及出处 ID，重新打开先经过原服务校验。 |
| 人工核对 | Chronicle AlertDialog | 明示本版修订，调用 `confirmEvidenceItem`，保留原并发检查及审计。 |
| 办理记录 | Chronicle NativeSelect、Textarea、Button | 调用原记录的新增和修改动作，保留事务审计和并发检查。 |

[Base UI Quick start](https://base-ui.com/react/overview/quick-start) · [Composition](https://base-ui.com/react/handbook/composition) · [Collapsible](https://base-ui.com/react/components/collapsible) · [Tabs](https://base-ui.com/react/components/tabs)

## 按总清单迁移

| 分区 | 复用入口与来源 | 当前范围 | 完成验收 |
| --- | --- | --- | --- |
| 案件与概览 | `listMatters`、`getMatterById`，W02 / RQ02 | 列表搜索、分页、案号、基本信息 | 案件创建和编辑、收案链路、关联人、案件状态、归档权限与并发。 |
| 材料 | `listAllDocuments`、现有下载接口，W04–W06 / RQ03–05 / AC04 | 材料表、名称及版本筛选、上传分类入卷、应用内 PDF 和下载 | 批量导入、卷宗树、默认编辑器、保存回传、解析和版本影响。 |
| 事实与研究 | `listEvidenceItems`、`resolveEvidenceSource`、`confirmEvidenceItem`、`getResearchList`，W06/W09.1 / RQ04–08 / AC04、AC07 | 支持、反证、背景、原文固定、确认修订、研究列表 | 创建和编辑要点、挂接和撤回出处、历史修订、研究编修、人工采用与出稿。 |
| 程序与任务 | `getMatterById` 的程序、期限、开庭和环节任务投影，W11 / RQ09–10 | 案件程序列表及环节任务只读视图 | 程序、环节、期限及任务读写、责任等待与接手，覆盖待办和终止守卫。 |
| 文书与交付 | `listDeliveryRecords`，W10.2 / RQ11 / AC08 | 交付列表和游标翻页 | 文书编修、审批、固定版本、交付明细、凭证及结果登记。 |
| 办理记录 | `listNotes`、案件时间线、`createNote`、`updateNote`，W11 / RQ09–10 | 页签内新增和编辑沟通记录、读取案件进展 | 撤回、研判、快递和不同来源筛选。 |
| 财务和用印 | `getMatterFinance`、`listSealRequests`，W10/W12 / RQ14–15 / AC10–12 | 财务总额与流水、已授权用印列表 | 合同、应收、票据、审批、用印和更正的原流程及权限。 |

所有 API 操作委托隔离个人运行时。Chronicle 仅转发固定案件接口和明确的材料 PDF/下载路径，原服务仍校验会话与对象访问。固定出处页签在当前窗口会话内按案保留。返回争点页时，先用当前案卷资料匹配争点修订和出处，再由原服务重新授权并加载原文。

## 案件工作空间与总览

- 左上案名按钮负责切案。同一窗口内，选择已访问案件回到该案最近一次访问的分区，初次进入打开概览。「事实与研究」和「财务与用印」合并为两个可展开分组，其余入口仍追加到原 Workspace 的 Users、Tasks 后。概览不占侧栏入口。无当前案时案内入口禁用；选案只更新链接和上下文。直达案页以 URL 确定具体案卷与分区。
- 左下固定区域已接真实「案件总览」。我的工作台、客户与收案、待办与日历，以及跨案材料通览，待对应业务查询和权限验收后接入。
- Chronicle 原模板页面和菜单分组常显。Production／Staging 示例切换器保留在原菜单下方。模板页面继续使用示例数据。长侧栏显示细滚动条，并与正文分别滚动。
- 切案、访问参考页面和返回案件总览时维持同一侧栏。最近案内分区和固定出处保存在当前窗口会话，刷新整页或重启会重置这部分状态。双案切换已用隔离运行时验收。多案并排窗口仍待验证。

## 模板示范与现有业务复用

| 顺序 | Chronicle 可沿用 | LexOrder 现有业务及接入约束 |
| --- | --- | --- |
| 1 | Users 的 DataTable、搜索和分页、ViewTabs、FacetedFilter、右侧 UserSheet | 案件总览已复用 DataTable。下一步用同一结构承接案件筛选，接原 `listMatters` 和 `getMatterTabCounts`。客户与收案可复用列表和详情预览布局，接 `listClients`、原客户详情、收案和权限。 |
| 2 | Tasks 的 List、状态筛选、空状态。Calendar 的 MonthGrid 和 Agenda | 用模板渲染现有任务与日程。工作台保留 `getDashboardWorkQueue` 和 `getDashboardSchedule` 的数据口径，完整日程继续按原 `schedule/page.tsx` 的权限及数据范围。进阶看板拖动须遵循现有任务状态、依赖和写入规则。日期、法定期限和开庭时间沿用上海时区及原有精度。 |
| 3 | Users 的列表与详情联动。Pricing 的分组和横向对照表可参考证据矩阵 | 材料列表和出处预览可沿用列表、选中、高亮和面板布局。事实时间线、冲突判断、材料版本和出处绑定复用原 `FactsWorkspace`、`EvidenceTimeline`、`ConflictReview` 的业务判断和服务。固定原文仍使用案内右栏。 |
| 4 | Analytics 的卡片、空状态及可筛选表格。Mail 的队列和详情布局可参考审批 | 保留现有财务汇总、审批队列 `listApprovalWorkspace`、用印及交付动作与权限。模板布局不映射为订阅指标或示例消息状态。 |

[Chronicle 官网示范](https://demo.shadcnstore.com/chronicle/) · [Base UI 组件文档](https://base-ui.com/react/overview/quick-start)

## tauri-ui 桌面工具

- 开发构建按 Ctrl+D 或 Cmd+D 切换调试面板。用 Chronicle Card 和 Base UI Tabs 显示环境、已脱敏的路由、尺寸、像素比、缩放、正文及侧栏滚动与错误计数。Chrome / Edge 的 DOM 检查使用原开发者工具。调试浮层打开时外部正文仍可操作。
- 桌面外链处理复用 Tauri opener。受信的当前应用来源在 WebView 内导航。外部 HTTP(S) 顶层导航或新窗口请求由系统默认浏览器打开；其他协议和非本应用回环地址拒绝。PDF 在材料页 Sheet 或争点出处栏内预览。
- Windows 实测 Ctrl+D 打开，Ctrl+- 后页面 1372 × 858 → 1524 × 954，设备像素比约 1.575 → 1.4175。正文偏移由 251 → 957 px。模板署名外链进入 Edge，桌面原页面保持。材料页 PDF 阅读器在本窗口加载完成。
- 首次实测发现 Tauri 默认禁用窗口缩放快捷键，调试构建显式启用 Ctrl+-／Ctrl+0。PDF 抽屉首版焦点被内嵌阅读器接收，现将初始焦点放在关闭按钮上。文件导入使用原资料摄入服务和同一请求标识，支持失败时留在表单继续处理。

## 本地启动

1. 在仓库根目录准备现有 LexOrder 隔离个人运行时。案卷 API 已接在根仓库的 `src/app/api/personal/`。
2. 在本项目设置 `LEXORDER_PERSONAL_ORIGIN` 为就绪文件的 origin，设置 `LEXORDER_CHRONICLE_ORIGIN=http://127.0.0.1:55313`，执行 `pnpm dev --hostname 127.0.0.1 --port 55313`。并行隔离验收可另设回环端口和 `NEXT_DIST_DIR=.next-personal-two-case`。
3. 运行 `cargo build --manifest-path desktop-preview/Cargo.toml --locked`。在启动桌面进程时用环境变量 `LEXORDER_PERSONAL_CHANNEL_TOKEN` 传入就绪文件中的 token。避免在命令参数、终端输出或文档中记录 token。
4. 从左上工作空间切换器选案，也可从左下「案件总览」搜索。切到 Workspace 下的「事实与争点」，点出处可打开和固定原文。

## 验收记录 2026-11-19

- Windows 原生开发构建通过，窗口中的案件列表已读取隔离工作区数据。
- Edge 用合成案跑通案件菜单、搜索与空结果、固定付款凭证 V1、反证切换、恢复和重开出处、读取 PDF，以及跨源请求被拒绝。
- 各案内分区打开并读取现有服务。材料列表读到付款凭证，新增沟通记录后刷新仍能回读。部分分区在合成案中为空，验收仅覆盖空状态。
- 工作空间导航在 Edge 通过合成案验证。覆盖下拉进案、九个侧栏分区、材料页刷新、争点页回到案件总览，以及浏览器返回。开发热更新曾在切换器文件写入前报告模块缺失，合并后复验通过。
- 固定侧栏冒烟用单一合成案通过案件总览、Chronicle Analytics 和返回原案。检查原 Production／Staging 示例可以打开、V1 固定出处可恢复、取消固定后不再恢复。冒烟等待浏览器内嵌 PDF 的响应事件超时，改用同一会话请求恢复后的 iframe URL，确认返回 PDF。
- 双案隔离冒烟通过。澄禾设备采购款争议返回材料，青岚仓储交付争议返回研究。重进事实与争点分别恢复付款凭证 V1 和仓储验收单 V1。两份 PDF 均返回成功，双向切换保持相同的侧栏结构，两案原文地址和页签独立。
- 滚动检查发现长侧栏原本隐藏滚动提示，Windows 桌面预览用滚轮能滚到 FAQs 和 Pricing。加入细滚动条及侧栏滚动边界后，用独立浏览器复验菜单和长正文。Windows 桌面窗口由用户继续操作，正文滚轮验证以浏览器结果为准。
- 测试准备发现临时目录通过跨盘 junction 引用 Next.js 依赖会解析失败。改用同一源码目录、独立回环端口和独立 `NEXT_DIST_DIR`，复验通过。无当前案的禁用入口曾因 Tooltip 包装显示为可点击，移除该包装后验收正确。
- 冒烟修正 Base UI 链接按钮的原生语义和面包屑里显示的内部 ID。Playwright 的 HTTP 测试改用绝对 URL。Chronicle 与隔离运行时各自做 TypeScript 验证，运行时路由源码只在其目标环境检查。

- 本轮从原网页实际打开案内八个分区和全局 24 个入口。先前的脚本在路由切换时读到旧可见面板，复验改按分区可访问名称等待。初次直接访问隔离运行时返回 403，加载个人会话后正常。带团队权限的正式实例及每项业务写入仍待分批验收。
- Chronicle 浏览器复验通过历史 V1 PDF、无文件禁止提交、非法扩展名拒绝、有效 PDF 入卷刷新回读、事实与用印分组。
- 办理记录页签复验中，上传会产生真实案件进展，因此用当前可访问页签断言替代空数据假设。沟通草稿在两页签来回切换后原样保留。
