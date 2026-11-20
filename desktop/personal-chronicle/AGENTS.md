# LexOrder 个人版界面约束

## 改动前先看

改界面、导航、样式或动画前，先用已确认的用户路径和验收稿核对问题，再查同类组件或完整区块的源码与可交互示例。按以下顺序选型，记录复用组件、应用范围和需要补齐的行为。

1. **优先 Chronicle。** 先看本地最相近的示例源码与 [Chronicle 在线示范](https://demo.shadcnstore.com/chronicle/)。同类界面直接使用现有的组件组合、交互和样式，优先复用 `components/ui` 与 `kit`。字体、字号、间距、圆角、选中态和动效沿用模板及主题变量。业务数据和写入规则继续接入 LexOrder 服务。
2. **Chronicle 缺少所需交互时用 Base UI。** 查看 [Base UI Quick start](https://base-ui.com/react/overview/quick-start) 和对应组件文档。涉及组合、样式、过渡时按需查 [Composition](https://base-ui.com/react/handbook/composition)、[Styling](https://base-ui.com/react/handbook/styling) 和 [Animation](https://base-ui.com/react/handbook/animation)。用 Chronicle 的控件与主题变量呈现。
3. **需要额外的设计参考时查 21st.dev。** 在 [21st.dev 社区组件](https://21st.dev/community/components) 或 [ShadcnStore Blocks](https://shadcnstore.com/blocks/application/datatables) 查类似页面或交互。采用的结构、状态和动效统一套用 Chronicle 样式，有现成组件时直接组合复用。复用依据放到 [个人版迁移计划](docs/lexorder-personal-migration.md)。

## 本地预览与验收

- 个人版使用 `bun run build:desktop` 和 `bun run desktop`。WSL 合成工作区可用 `tools/workbench-m1/chronicle-harness.sh` 的 `build/start/dev/status/stop`。界面与 API 由同一个本地服务提供。
- 日常界面联调使用 [Vite 热更新](README.md#开发与热更新) 和现有合成业务运行时。原生能力验收使用 Tauri WebView。
- 原生 QA 使用该构建的 Tauri 窗口。记录窗口实际状态、案卷回读和失败行为。业务端改动重新构建后，在隔离案卷验证。

## 样式和导航

- Chronicle 是个人版视觉基线。沿用 `components.json` 的 `base-nova`、`config/theme.ts` 与 `app/globals.css` 的主题、字体、色值、圆角、阴影和间距。使用模板的 PageHeader、Card、DataTable、Sheet、Badge 和表单控件，使浅色、深色和密度设置一起生效。切换视觉基线、全局配色或默认布局须先确认。
- 保留 Chronicle 原有组件、示范菜单和示范页，从设计参考进入。个人办案界面按确认的 LexOrder 预览组织「当前案件」「工作区」和固定入口。案件概览和程序入口保持一级，稳定业务分区至多两级，页内状态和概览图表切换用小页签。切换案件更新当前上下文、目标链接和选中态。主操作放在页首右侧。窗口顶栏保留 Chronicle 的搜索、通知、浅深切换、外观与设计参考入口。顶部切案保留焦点和键盘操作，长侧栏可独立滚动，固定入口持续可达，正文沿用模板的页面滚动。
- 复用 Base UI 的原生语义、焦点和键盘管理。通过 `render` 渲染为链接的 Base UI Button 或菜单项按组件文档设置 `nativeButton={false}`。弹层使用模板现有 Portal、层级和滚动设置。

## 已确认的样式参考

页面布局按 [Chronicle 逐页设计对照](http://127.0.0.1:18759/chronicle-review.html) 核对。案情图谱的时间片、分轨、回放和材料联动，对照 Windows 本地 `D:/Projects/Lexorder/.local/v8-plan-review/reference.html`。组件外观以 Chronicle 为准。

| 界面 | 参考与约束 |
| --- | --- |
| 侧栏菜单树 | 对照 Chronicle 示例的「Auth pages」，复用 [NavMain](kit/shell/nav-main.tsx) 和 [Sidebar](components/ui/sidebar.tsx)。沿用模板字号、行高、图标、二级缩进线和焦点框。分组整行展开，一级分组和当前子页同时高亮，当前页的 `aria-current` 只标在对应入口。 |
| 图谱下拉框 | 统一复用 [图谱 Select](features/matters/chronology-select.tsx) 和 [Chronicle Select](components/ui/select.tsx)。触发器与展开面板都使用主题样式。核对选中勾、选项回显、键盘选择、Esc 收起与焦点回到触发器。 |
| 图谱时间轴和事实表 | 复用 [Card](components/ui/card.tsx) 与 [Table](components/ui/table.tsx)。保留 V8 的日期刻度、区间、按类别区分的标记和图例。图例与时间轴共用点、区间、冲突角标和斜纹的绘制样式。轴上的事件保留类别颜色，图例使用中性色示意形状。明确起止用圆点加细线，约定区间用虚线，仅知月份用浅底条。图例按核对与分歧、日期表达、事项性质、事件等级分组。重要加外圈，关键另加小星，聚合圆点提示组内最高等级。事实表对照 [Emporium Orders](https://demo.shadcnstore.com/emporium/orders) 的表头、行距、主次文字和状态点，沿用 Chronicle 主题。事项和来源用正文色，鼠标悬停时显示下划线。 |
| 图谱右侧详情 | 对照已确认的 StackTrace 折叠样式，沿用 [ChronologyTrace](features/matters/chronology-trace.tsx) 的标题、状态和材料记录。事实详情固定标题和简明状态。正文按事实内容、材料记录、核对与标注、材料指向、变更记录排列。材料列表默认展开。字号按事实标题、分组标题、材料名、辅助信息递减。收起的材料行显示名称，多条记载时显示数量。材料展开态以结构化记载和查看原文为主。来源版本和定位随固定原文展示，关联用途和出现时点收进材料设置。记载的日期和金额分别采用。材料展开后显示逐字引文，同段字段在段内高亮，原件按固定版本定位，从事实表出处进入时展开对应记载。分组操作与折叠触发器分开，核对字段使用 Chronicle Field 和小号 Select。记载分歧收在材料记录顶部，只在有字段分歧时显示。材料行收起时用简短状态标明采用字段。分歧来源用正文色和悬停下划线，点击后打开固定原文并高亮对应字段。核对表单、材料指向和历史默认收起并可独立展开。普通保存保留同一事实的展开状态。程序记录默认收起。 |

### 图谱滚动

- 同轨点事件与首条起止区间共用基线。区间用起点圆点和细线表示，线止于结束日。重叠区间保留可独立选中的绘制空间。
- 时间轴、事实表和矩阵随页面主滚动，表格横向溢出只滚表格区域。时间轴滚轮缩放限定在日期绘图区，轴外滚轮交还页面。
- 案情图谱按正文容器宽度切换布局。正文达到 62rem 时并排，右侧详情固定在顶栏下方，超出可用高度时只滚详情正文。正文较窄时详情顺排，主动选择事实后滚入视口并接收键盘焦点。回放步骤保留页面位置。确需独立滚动的详情区沿用 Chronicle [ScrollArea](components/ui/scroll-area.tsx) 的样式和键盘行为。
- 改动图谱后，用实际 Tauri WebView2 对照检查侧栏高亮、展开后的下拉框、右侧详情和鼠标滚轮。验收时核对滚动到底及缩窄窗口后操作入口仍可达。
- WebView2 内的点击、滚轮和宽窄布局，优先使用 [独立 Tauri 验收脚本](../../tools/workbench-m1/chronicle-smoke/README.md#webview2-后台验收)。脚本向测试实例发送浏览器输入事件，验收时可继续使用日常工作台。Windows 文件选择器、外部编辑器和系统窗口行为需另行实机核验。

## Dashboard Kit

- `kit.lock.json` 的 `files` 记录上游快照，`local` 单独记录 LexOrder 已审阅的框架适配、导航外壳、主题、通知、查询和加载组件。用 `pnpm run kit:check` 核对两层的实际文件。升级上游时先审查差异并重新应用这些定制。

## 页面切换和动效

- 普通导航用现有 React Router 路由和持久的 Chronicle 布局，切页时侧栏、顶栏与工具条保持稳定。普通切页使用个人工作区共用的等待层。短等待显示窗口顶边进度线，等待超过 500 ms 时复用 Base UI Dialog 与 Chronicle Spinner 覆盖窗口，包含侧栏和工具条。路由与首屏数据分别申报等待，数据就绪或失败即解除遮罩。可继续使用当前页的补充读取沿用局部反馈。正文路由过渡为 100 ms 轻淡入。主题预览的 View Transition 继续由 `kit/customizer/cross-fade.ts` 管理。
- 菜单、折叠、弹窗、抽屉沿用现有动效。桌面菜单约 100 ms，Sheet 遮罩 150 ms、面板 200 ms，侧栏展开箭头 250 ms。新动效从最相近的模板组件复用时长、缓动和 Base UI 状态属性。新增过渡要支持 `prefers-reduced-motion`，快速打开后取消或连续切换时内容、焦点和滚动都能正常恢复。
- 改壳或导航后，检查连续切页、前进／返回、点开后立即关闭弹层、长正文和长侧栏滚动。至少覆盖受影响的新业务页和原模板长页。用浏览器开发者工具检查实际滚动元素、尺寸和计算样式，涉及 WebView 独有行为时用桌面预览复验。
