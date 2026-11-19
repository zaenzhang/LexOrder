# 网页案件工作区与 Chronicle 案卷

基线为 PR #27 的 `5d26be5`。从 [案件列表](../../../src/app/(app)/matters/page.tsx) 及 [案件详情](../../../src/app/(app)/matters/[id]/page.tsx) 追到案内 53 个页面、组件与类型文件，并按实际调用核对材料、证据、研究、任务、交付、审批、财务、收案及归档服务。仓库内的需求依据是[产品需求 §3、§9、§13](../../../docs/PRODUCT_REQUIREMENTS_ACCEPTANCE.md) 与[实施清单](../../../docs/WORKBENCH_PLAN.md)。本表按用户恢复的个人版工作范围标出入口和仍缺的操作。

## 案内入口与办理结果

| 网页来源及原操作 | Chronicle 落点 | 已接入与仍缺的动作 |
| --- | --- | --- |
| `/matters` 的案件/收案列表、动态案号、案由与当事人选择，`/matters/[id]` 的概览、档案、近期指示和待办。RQ01/02 | 案件总览、切案器、概览 | 保留按案号/名称检索、分页、独立案内 URL、事项摘要和待办。概览按原更新时间修改案名、案由文本、标的及我方地位；既有标准案由在此原样保留。原系统编号、Matter.id 与材料 ID 持续标识同案。目标、约束、指示、方案与决定可附同案来源、另存修订、核对该版和回看历史。方案明确采用指定目标/指示修订。个人客户与收案入口承担客户建档、收案冲突决定及转案。 |
| 案内材料、批量收件、材料工具、审批、模板与解析状态。RQ03/04/11 | 材料 | 已接单件及批量入卷、逐件回执与同键重试、原件/工作稿身份、当前/历史版本、固定 PDF 页签、版本下载、默认编辑器及回传。文书与交付页可导入 DOCX 模板，选择本案适用模板、具体当事人和程序，核对来源值、按允许字段修改并产生可入卷的 Word 工作稿。模板制作、正式送审和用印分别留痕。卷宗工具可新建、更名、归卷与移出卷宗并保留原文件字节。成果送审、逐项复核与正式决定见文书交付。解析详情与重试仍须分别覆盖。 |
| 五类要点、来源关系、版本与争点核对。RQ04/05 | 事实与争点 › 事实与要点 / 争点证据对照 | 五类要点沿原领域值保存。可记录明确日期、区间或未明日期，修订内容、选择指定材料版本、添加支持/反驳/背景、撤回来源。服务校验同案和旧修订，关系变化保存历史并清除旧核对。争点对照继续按原修订读出处、固定原件和确认。完整历史修订浏览、解析片段选择与全时间线仍有差距。 |
| 研究记录、争点输入、查询读本、法源及审核出稿。RQ06–08/11 | 研究 | 手工新建研究，在 Sheet 读该修订的研究范围、结论、查询情况、来源、待核实项；核对该版、用该修订生成 Word 工作稿。服务保留来源和文稿的精确对应。网页的带来源修订编辑、替换争点输入、检索供应商及历史浏览仍需对应界面。 |
| 全案/程序/环节、任务新建、责任、等待、依赖、期限、庭期。RQ09/10 | 程序与任务 › 任务 / 程序、期限与庭期 | 可建立事项级或环节任务，按环节/未归属筛选，编辑、办结、包含已结束；等待、阻塞和缺少责任记录可辨。新建与重复提交复用原请求键；编辑和办结复核案 ID、责任修订、归档和状态。可新增承办或关联程序、按更新时间更正程序资料、新增环节、登记庭期和人工期限。日期型期限与明确截止时刻分别填写，庭期按北京时间录入。规则起算、实际改期、等待和依赖编辑仍须对应原操作。 |
| 指定版本的交付包、导出、实际送达、凭证、客户回复、更正、补发。RQ11/12/15 | 文书与交付 › 准备交付 / 查看清单 | 选择一份或多份明确版本，核实未知材料来源、对象、联系方式、披露、未决项并冻结。保存与重试共享原服务；拒绝未经审批的自制成果。可导出 ZIP、登记发送、收悉、回复、内容确认，附同案凭据；更正追加到明确原事件，补发另建关联清单。自制工作稿可按固定版本送审，提出问题、记录依据、回应和检查处理结果。批准前逐项核对文书版本、哈希与当时的问题修订；退回可重送。V2 须独立批准，旧清单继续固定 V1。 |
| 办理记录、现场、研判、法院、快递、进展。RQ01/02/12 | 办理记录 | 沟通新增/修改沿原作者和时间戳守卫，进展独立显示。独立的法院来件工作区负责粘贴去重、附件处置与归案，办案事务可登记快递、保全对象和财产、续期及核查历史。独立现场记录、研判修订与全类别检索尚待处理。 |
| 委托、合同、财务、更正、发票、审批用印。RQ12/14/15 | 财务、用印 | 案内财务与跨案共用个人财务组件。可用本地 PDF 发起本案用印，选择启用的章与用途；按本人实际权限撤销、批准或驳回，批准后另传实盖扫描件。服务保留申请人与执章权限、法人章资格、原稿与用印结果的独立材料 ID。正式送达继续走交付。 |
| 归档准备、缺项核准、锁定、导出、重开。RQ11/15 | 案件归档 | 办案事务承接缺项、收尾日期和财务安排。正式归档页可登记实际程序终结、结案、重新开放已结案或暂停案；从制度原文、逐项材料和人工确认生成送审快照，支持退回、缺项例外核准、手动批准锁卷与按归档编号下载 ZIP。已归档案保持锁定，具备独立补充权限时可补传并另立送审记录。 |
| 团队成员、主办交接、团队只读、批量 AI 复核/类案检索、全所知识治理。RQ06/08/14/16 | 已有个人能力按服务配置进入；团队入口归在线工作区 | 多人转派、独立复核和团队权限管理没有个人等价动作。知识沉淀 W09.3、结构化方案比较、自动客户简报、规则期限深化沿总清单原安排。 |

## 源码索引

下表以 `src/app/(app)/matters` 为根。除列表行外，简称均指 `[id]/_components` 下的同名文件。原页面呈现依赖相邻业务模块，例如 `src/components/deliveries`，桌面经 `src/app/api/personal/matter-workspace` 复用这些页面原先调用的服务。Chronicle 沿用已有 PageHeader、Card、Tabs、Sheet、表格及表单控件。

| 职责 | 文件 |
| --- | --- |
| 案件列表、收案与筛选 | `page`、`_components/{matters-view-v4,matters-table,intakes-table,cause-combobox,cause-ai-manual-dialog,party-card}` |
| 详情路由、恢复与摘要 | `[id]/page`、`matter-detail-tabs`、`matter-list-back`、`matter-brief-section`、`matter-context-section`、`matter-signal-strip`、`matter-archive`、`info-panel`、`info-extras` |
| 事项身份、委托、关联与团队 | `matter-basic-editor`、`matter-editor-types`、`team-editor-dialog`、`matter-team-editor`、`team-matter-overview`、`custom-fields-panel`、`related-matters-field`、`engagement-panel`、`conflict-review` |
| 材料/文书及来源工具 | `folder-types`、`doc-actions-context`、`material-tools-sheet`、`material-upload-dialog`、`pending-material-uploads`、`material-processing-status`、`input-coverage-section`、`document-review-dialog`、`template-picker-dialog`、`batch-review-button`、`review-summary-card` |
| 事实与检索 | `facts-workspace`、`evidence-panel`、`evidence-timeline`、`case-search-panel` |
| 程序、环节与进展 | `procedure-workflow-panel`、`procedure-content`、`procedure-forms`、`procedure-info-editor`、`procedure-status-actions`、`progress-dialog` |
| 财务、用印、归档、重开 | `finance-panel`、`finance-forms`、`invoice-request-sheet`、`approvals-panel`、`archive-status-banner`、`archive-wizard`、`lifecycle-actions` |

## 复验

隔离宿主使用两个合成案件、真实 PostgreSQL、已绑定案目录及同一组个人业务服务。可复跑命令和种子准备见[定向验收](../../../tools/workbench-m1/chronicle-smoke/README.md)。本表记录当前运行时/API 断言，桌面窗口、系统默认编辑器的证据见[迁移计划](lexorder-desktop-migration-plan.md)。

| 脚本 | 实际检查 |
| --- | --- |
| [matter-workflows.mjs](../../../tools/workbench-m1/chronicle-smoke/matter-workflows.mjs) | 任务新建重试、编辑、办结、错案和旧修订拒绝；研究的新建、核对及固定修订生成的真实 Word；证据明确日期、固定来源增撤和旧版拒绝；交付 ZIP 解包逐字节核对、未审批自制稿阻断、实际发送/收悉/更正及幂等；B 案八个分区可重读。 |
| [templates-seal.mjs](../../../tools/workbench-m1/chronicle-smoke/templates-seal.mjs) | DOCX 导入、模板字段变更拒绝、重开实际生成文件并校验正文案名、重复生成沿用版本；用印申请、本人按权限确认、实盖扫描件、撤销和驳回；错案和法人章资格均有拒绝。 |
| [matter-management.mjs](../../../tools/workbench-m1/chronicle-smoke/matter-management.mjs) | 改案名后核对原案号、物理目录和同一材料 ID，再还原；程序、环节、日期型期限和上海时区庭期；目标/方案的固定采用、旧修订拒绝、历史和同案来源。 |
| [archive.mjs](../../../tools/workbench-m1/chronicle-smoke/archive.mjs) | 独立合成收案转案后终结程序、结案重开、收尾登记、引用真实制度、原件逐项入卷；拒绝漏核和未核准例外，退回重送后批准、锁定。导出 ZIP 解包校验原件、封皮、目录，拒绝错案及锁卷后重开。补充归档单独核验，后到的凭据仅进入新包。 |
| [document-review.mjs](../../../tools/workbench-m1/chronicle-smoke/document-review.mjs) | 提出问题、回应、逐项复核、驳回与重送、旧快照和漏核拒绝、本人批准、实际固定 V1 交付。V2 未批准时拒绝交付，复核新版后同时重读两版原始字节和原交付清单。 |

材料卷宗在本案材料页支持新建、重命名、指定版本分卷与移出。材料清单按稳定游标分页、每页最多 100 个候选版本，名称、卷宗与当前/历史版本筛选由业务服务在分页前执行，并逐条检查读取权限。双案验收见 [volumes.mjs](../../../tools/workbench-m1/chronicle-smoke/volumes.mjs)。
