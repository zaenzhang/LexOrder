# LexOrder 程序、任务与日程预览｜统一 Chronicle 侧栏

基线：`zaenzhang/LexOrder main@95eabf3f`  
来源预览：上一版可交互的程序、任务、责任板与日程 HTML。  
本轮范围：只更新本组隔离 HTML 预览；未修改 LexOrder 正式业务代码、共享应用壳或迁移文档；未创建 Git 分支。

## 1. 本轮对齐内容

- 全站只保留一套 Chronicle 侧栏，不再在各业务页自行创建菜单。
- 左上工作区切换器是唯一切案入口。全局状态显示「全局工作区」；选案后显示案名和案号。
- 中间滚动区按固定顺序显示「当前案件」和「工作区」。全局状态下，当前案件组使用 `inert`、`aria-disabled` 和灰化样式；选案后在原位置启用。
- 左下固定「案件、通知、设置」和原用户区。
- 案内与全局二级菜单按本轮统一名称和顺序展示。直接打开二级路由时，父组自动展开，当前入口高亮。
- 切回案件时恢复该案上次打开的分区；回到全局时重新禁用当前案件组。
- 程序、任务、责任板和日程的业务控件仍留在内容区。程序管理继续使用左侧程序序列、右侧程序明细。
- 任务的全案／程序／环节筛选、未归属环节、Board/Table、待办／已办结／已取消分类均保留初版逻辑。没有改成按任务类型分类，也没有加入拖拽改法律状态。
- 任务卡片继续进入独立任务详情内容页；没有恢复右侧详情抽屉。
- 其他业务入口显示明确的归属提示，不伪造该组的数据和操作；没有增加 AI 中心菜单或模拟 AI 功能。

## 2. 统一侧栏入口映射

### 当前案件

| 左栏短名 | 页面完整标题 | 已核实路由 |
|---|---|---|
| 概览 | 案件概览 | `/matters/[matterId]/overview` |
| 程序 | 程序与任务 | `/matters/[matterId]/tasks` |
| 材料 | 案件材料 | `/matters/[matterId]/materials` |
| 事实 → 争点 | 事实与争点 | `/matters/[matterId]/evidence` |
| 事实 → 研究 | 法律研究 | `/matters/[matterId]/research` |
| 文书 → 文书台 | 文书台 | `/matters/[matterId]/delivery` |
| 文书 → 用印 | 用印工作区 | `/matters/[matterId]/seal` |
| 记录 | 办理记录 | `/matters/[matterId]/records` |
| 财务 | 案件财务 | `/matters/[matterId]/finance` |
| 归档 | 案件归档 | `/practice/archive?matter=[matterId]` |

### 工作区

| 左栏短名 | 页面完整标题 | 已核实路由 |
|---|---|---|
| 今日 | 今日工作台 | `/practice/today` |
| 客户 → 名册 | 客户名册 | `/practice/clients` |
| 客户 → 收案 | 收案管理 | `/practice/intakes` |
| 客户 → 联系人 | 联系人 | `/practice/contacts` |
| 客户 → 冲突预检 | 利益冲突预检 | `/practice/conflicts` |
| 日程 | 跨案日程 | `/practice/schedule` |
| 事务 → 按案办理 | 办案事务 | `/practice/operations` |
| 事务 → 法院来件 | 法院来件 | `/practice/operations/court-inbox` |
| 财务 | 财务工作台 | `/practice/finance` |
| 资料 → 资料库 | 资料库 | `/practice/resources` |
| 资料 → 模板 | 文书模板 | `/practice/templates` |
| 资料 → 报表 | 业务报表 | `/practice/reports` |
| 资料 → 执业资料 | 执业资料 | `/practice/profile` |
| 资料 → 操作记录 | 操作记录 | `/practice/audit` |

### 左下固定入口

| 左栏短名 | 路由 |
|---|---|
| 案件 | `/matters/list` |
| 通知 | `/practice/notifications` |
| 设置 | `/settings` |

路由核对依据：`desktop/personal-chronicle/config/nav.ts`、`features/matters/sections.ts`、`app/(shell)/matters/[matterId]/[section]/page.tsx`、`app/(shell)/matters/[matterId]/evidence/page.tsx`、`app/(shell)/practice/[view]/page.tsx`、`app/(shell)/practice/operations/page.tsx`、`app/(shell)/practice/operations/court-inbox/page.tsx`、`app/(shell)/practice/archive/page.tsx`。

## 3. Chronicle 与开源 Blocks 参考

优先沿用项目本身的 Chronicle 导航实现，而不是每个业务组重新设计侧栏：

- [`kit/shell/app-sidebar.tsx`](https://github.com/zaenzhang/LexOrder/blob/95eabf3f/desktop/personal-chronicle/kit/shell/app-sidebar.tsx)：侧栏顶部工作区切换器、滚动区、固定底部入口和用户区。
- [`kit/shell/nav-main.tsx`](https://github.com/zaenzhang/LexOrder/blob/95eabf3f/desktop/personal-chronicle/kit/shell/nav-main.tsx)：分组、二级菜单、`expandOnly`、路由激活和折叠状态下的入口行为。
- [`kit/shell/app-shell.tsx`](https://github.com/zaenzhang/LexOrder/blob/95eabf3f/desktop/personal-chronicle/kit/shell/app-shell.tsx)：全局壳、顶栏、面包屑与内容区。
- [`kit/shell/types.ts`](https://github.com/zaenzhang/LexOrder/blob/95eabf3f/desktop/personal-chronicle/kit/shell/types.ts)：统一菜单模型。

外部 Blocks 只作内容布局参考，不另建第二套应用壳：

- [ShadcnStore · Application App Shells](https://shadcnstore.com/blocks/application/app-shells)
- [ShadcnStore · Application Apps](https://shadcnstore.com/blocks/application/apps)
- [ShadcnStore · Datatables](https://shadcnstore.com/blocks/application/datatables)
- [ShadcnStore · Calendars](https://shadcnstore.com/blocks/application/calendar)
- [Chronicle 在线示范](https://demo.shadcnstore.com/chronicle/)

## 4. 与原业务实现的边界

已沿用的程序／任务行为：`features/matters/task-workspace.tsx` 的 Task 对象、责任状态、等待与前置条件；`features/matters/sections.ts` 的案内分区；`features/practice/daily-work.tsx` 的月度日程和跨案责任板视图。

本轮没有改变以下业务函数：`visibleTasks`、`scopeControl`、`taskBoard`、`renderTaskCard`、`procedureSequence`、`renderProcedureDetail`、`renderTaskDetail`、`taskCreateSubmit`、`taskActionSubmit`。与初版逐函数比较，内容相同。程序序列仍按登记顺序显示，但不表示程序之间存在法律前置关系。

需要明确的路由差异：

1. 任务详情 `?task=[taskId]` 已由现有 `TaskWorkspace` 读取，可作为可刷新定位入口。
2. 新建任务 `?newTask=1` 是本轮页面式交互预览提出的路由状态；当前源码的 `TaskEditor` 仍使用 Sheet，尚未实现该独立页面路由。
3. 程序选择 `?procedure=[procedureId]`、庭期／期限详情 `?event=[eventId]`、新建程序 `?newProcedure=1`、新建日程 `?newEvent=1` 和材料查看 `?file=[fileId]` 在本预览中可定位，但不是已核实的现有页面查询契约，正式实施前需由相应业务组确认。
4. `/practice/operations` 当前实际默认显示快递收寄，并含财产保全、归档检查分区。本轮将其作为用户指定的「按案办理」短入口，完整页面标题保留「办案事务」；如统筹认为该短名会误导，应统一调整菜单文案而不是各组自行改路由。
5. 案件归档沿用 `/practice/archive?matter=...`，不伪造一个不存在的案内 `/archive` 页面。
6. 其他业务入口仅展示归属说明，不代表这些业务页已完成视觉或交互验收。

## 5. 验证记录

| 检查 | 结果 |
|---|---|
| JavaScript 语法检查（`node --check`） | 通过 |
| HTML 结构解析、重复 ID | 通过；1 个侧栏、ID 唯一 |
| 统一菜单名称和顺序 | 通过；当前案件 8 个一级入口、工作区 6 个一级入口，二级入口与固定底栏顺序一致 |
| 切案入口去重 | 通过；只有左上 `workspacePicker`，无旧页面内 `matterPicker` |
| 路由映射测试 | 通过；27 个菜单入口映射及任务详情、新建任务、日程记录等预览路由 |
| 二级深链解析 | 通过；研究页解析为 `case-research`，模板页解析为 `workspace-templates` |
| 当前案件组启停 | DOM 逻辑测试通过；全局态 `inert=true`、`aria-disabled=true`，选案后恢复启用 |
| 二级菜单展开和高亮 | DOM 逻辑测试通过；直接进入研究页时「事实」展开且「研究」高亮 |
| 切案恢复 | 状态函数测试通过；A 案程序 P2 → 全局模板 → B 案 → 全局 → A 案，恢复 A 案程序 P2 |
| 任务分类和程序序列业务逻辑 | 与初版对应函数逐项比较，未改变 |

**实际浏览器点击与视觉验收尚未完成。** 当前执行环境的 Chromium／Playwright 导航被 `ERR_BLOCKED_BY_ADMINISTRATOR` 拦截。因此本轮提供的是可交互 HTML 文件和脚本／DOM 逻辑验证，不把它表述为已完成真实浏览器点击验收。还需在可用浏览器中检查键盘 Tab 顺序、折叠态二级入口、滚动、焦点返回和窗口尺寸。

## 6. 等待统筹确认

- 统一壳由统筹维护；其他业务组预览应复用本轮侧栏结构和路由映射，不再新增独立菜单。
- 任务详情已有 `?task=` 查询读取；新建任务改为完整页面需要相应页面状态与路由实现。
- 程序选择、庭期／期限详情和新建日程的可刷新路由尚需确认是否进入共享路由契约。
- 本轮没有写入正式业务页、共享壳或迁移文档；正式代码等跨包评审后再改。
