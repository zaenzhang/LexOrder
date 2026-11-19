# LexOrder 个人版界面约束

## 改动前先看

- 每次改界面、导航、样式或动画，先阅读本文件和 [Base UI Quick start](https://base-ui.com/react/overview/quick-start)，再看本次所用组件的官方文档。涉及 `render`、链接、弹层或过渡时，查 [Composition](https://base-ui.com/react/handbook/composition)、[Styling](https://base-ui.com/react/handbook/styling) 和 [Animation](https://base-ui.com/react/handbook/animation) 中对应章节。
- 先查看 [Chronicle 在线示范](https://demo.shadcnstore.com/chronicle/) 和本地最相近的示例源码，确认哪些布局、组件和交互能沿用。使用现有 `components/ui` 和 `kit` 封装，业务数据与写入规则从 LexOrder 原有服务接入。复用依据放到 [个人版迁移计划](docs/lexorder-personal-migration.md)。

## 样式和导航

- Chronicle 是个人版视觉基线。沿用 `components.json` 的 `base-nova`、`config/theme.ts` 与 `app/globals.css` 的主题、字体、色值、圆角、阴影和间距。使用模板的 PageHeader、Card、DataTable、Sheet、Badge 和表单控件，使浅色、深色和密度设置一起生效。切换视觉基线、全局配色或默认布局须先确认。
- 保留 Chronicle 原有菜单、分组和示范页。案内入口直接加在原 Workspace 下。切换案件只更新当前上下文、目标链接和选中态。案内分区使用独立 URL。顶部切案保留焦点和键盘操作，长侧栏可独立滚动，固定入口持续可达，正文沿用原模板的页面滚动。
- 复用 Base UI 的原生语义、焦点和键盘管理。通过 `render` 渲染为链接的 Base UI Button 或菜单项按组件文档设置 `nativeButton={false}`。弹层使用模板现有 Portal、层级和滚动设置。

## 页面切换和动效

- 普通导航用现有 Next.js 路由和持久的 Chronicle 布局，切页时侧栏、顶栏与工具条保持稳定。路由切换沿用模板默认行为，新增数据等待和空状态沿用模板组件。主题预览的 View Transition 继续由 `kit/customizer/cross-fade.ts` 管理。
- 菜单、折叠、弹窗、抽屉沿用现有动效。桌面菜单约 100 ms，Sheet 遮罩 150 ms、面板 200 ms，侧栏展开箭头 250 ms。新动效从最相近的模板组件复用时长、缓动和 Base UI 状态属性。新增过渡要支持 `prefers-reduced-motion`，快速打开后取消或连续切换时内容、焦点和滚动都能正常恢复。
- 改壳或导航后，检查连续切页、前进／返回、点开后立即关闭弹层、长正文和长侧栏滚动。至少覆盖受影响的新业务页和原模板长页。用浏览器开发者工具检查实际滚动元素、尺寸和计算样式，涉及 WebView 独有行为时用桌面预览复验。
