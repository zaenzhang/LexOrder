# LexOrder 程序、任务与日程｜页面形态及业务真实性审查

基准：`zaenzhang/LexOrder@95eabf3f`，结合已交付上一版双案交互预览。仅审查和独立原型，不改正式仓库。证据口径：源码表示固定提交核对；原型表示合成数据交互方案（不是业务服务联调）；待验表示需进一步业务核实或原生桌面验证。

## 结论

**新建任务采用完整内容页面；点击卡片进入任务详情内容页面；看板与表格只是同一对象的两个列表投影。** 右侧抽屉仅承担不影响长期上下文的快速辅助信息，如筛选提示和轻量历史预览。任务新建涉及案、程序、环节、时刻、责任和草稿恢复；任务详情涉及等待、依赖、办结、取消、重开和操作历史，均不宜压缩进抽屉。页面使用现有 Chronicle 容器、卡片、数据表、导航和 Base UI 封装；不切换视觉底座。

## 参考 UI / 开源项目

- 本地 `desktop/personal-chronicle/features/tasks/task-board.tsx` 和 `task-table.tsx`：可复用卡片、表格、筛选及密度，但**不能**直接继承拖动至 Done 的写入逻辑。源码的拖放调用 `tasks.move`，属于模板数据模型。
- [OpenProject 工作包视图](https://www.openproject.org/docs/user-guide/work-packages/work-package-views/)：同一工作包提供 Table / Board / Details；支持完整详情页，可借鉴多视图共用 ID、返回原列表的行为。LexOrder 建议仅保留完整详情，不必引入其复杂分屏。
- [shadcn 官方 Dashboard Blocks](https://ui.shadcn.com/blocks/dashboard)：可参考导航、DataTable、标题/操作区域，不复制整套后台业务逻辑。
- [Base UI Dialog](https://base-ui.com/react/components/dialog)：官方对焦点转移、弹层的定位适合确认类短操作；复杂业务记录优先完整路由页面。

## 业务事实核对矩阵

| 主题 | 固定基线源码事实 | 设计要求 / 风险 |
|---|---|---|
| MatterProcedure | 同一 Matter 可有多条程序，无“必须先终结一审才允许筹备二审”的通用门禁；状态 PENDING / IN_PROGRESS / CONCLUDED，历史 INFORMATIONAL 可缺实际终结日 | 允许并行律师准备；法院受理和实际终结须记录事实，不能从准备任务或庭期推导 |
| MatterStage / Task | Task 绑定 Matter，stageId 可以为空。真实环节通过其 procedureId 归属程序，创建核同案及环节有效性 | 顶部全案/程序/环节过滤；环节内新建默认选中真实 stageId；程序筛选时不能猜默认环节 |
| WorkResponsibility | OPEN / DONE / CANCELLED；完成前检查等待及前置；按版本、本人和权限确认写入，写原因和审计 | 看板不支持拖拽办结；详情页显示前置与等待，区分已取消和已办结；旧历史可追溯 |
| Deadline | Deadline 独立于 Task。DATE 以 Asia/Shanghai 自然日边界处理，DATETIME 为绝对时刻；有计算依据和人工确认语义 | 任务时间或办结不更新 Deadline。显示精度、来源和人工核对；不能凭同日推断任务-期限关联 |
| Hearing | Hearing 独立于 Task 和程序实际受理日；基线新增庭期守卫与期限不完全一致 | 拟定的程序已终结后是否允许补录历史庭期待归档组裁定；不能把普通任务当作法庭庭期 |
| 终结程序 | 实际终结由 archive 的 finish-procedure 等原入口负责；归档阻断包括未终结受托程序、开放责任、保全和财务等 | 程序页显示实际受理、实际终结、结果、日期与历史；不得因个别任务 DONE 自动终结整个程序 |
| 收案急务 | 未转为 Matter 的 IntakeUrgentItem 没有对应 MatterProcedure 和 Deadline；既有入口返回收案 | 月历急务跳原收案，不能创建虚假“案内法律期限” |

## 关于“一审与二审并行”应更加严谨

可以**并行筹备二审上诉的律师工作**，不能因此自动宣称二审程序已受理。是否确有二审程序应以起诉、送达、上诉状提交、法院立案/受理等实际事件为准；如仍只是假设性准备，应将任务归当前案件的“上诉准备”工作范围，保留其未受理性质。

中国大陆民诉法 2023 年修正版本第 171 条规定，对一审判决的上诉一般从判决书送达日起十五日，对一审裁定一般十日。具体案件需核对裁判种类、送达事实、当事人情况及特别程序，不应依据任务完成日期自动起算，也不应默认把本案示例的“举证期限”视为所有案件的统一期限。外部依据：https://www.gzhzcourt.gov.cn/upload/editor/file/2025/08/04/6388989731436328121054632.pdf

## 推荐页面映射

- 案内 `/matters/:id/tasks`：Board / Table，顶部全案、程序、环节；有“新建任务”按钮。
- 新建 `/matters/:id/tasks/new?stage=:stageId`：完整页面、字段表单、业务警示、脏表单保护；提交成功返回原范围。
- 详情 `/matters/:id/tasks/:taskId`：完整页面，原任务、前置、等待、历史和带原因操作，支持跨案入口返回。
- `/matters/:id/procedures/:procedureId`：程序实际办理事实和独立庭期、期限及工作任务。终结动作仍定位正式归档能力。
- `/practice/schedule`：跨案日历和责任列表共用原任务、庭期、期限 ID；不独立创造另一套状态。

## 原型及剩余验证

本轮另交付单文件独立交互原型 `LexOrder_程序任务日程_页面式交互预览.html`，不复用正式业务接口。原型包含两案同名任务、独立 Deadline/Hearing、先准备二审、等待与前置阻塞、办结/取消/重开、终结程序拦截、月历、原收案急务及固定文档 V1/V2 提示。浏览器沙箱禁止页面导航，无法宣称完整端到端浏览器实点；已进行 JS 语法检查。正式重构需补原应用 Next 路由历史深链、浏览器返回、焦点、脏表单、权限和同案校验联调，并用真实 Windows Tauri WebView 复验。
