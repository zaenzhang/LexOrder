> **上一轮 v1｜统一 Chronicle 侧栏 + 起草页信息结构**
>
> - 直接更新原有 `index.html` 和 `source/src/postprocess.js`；没有新建第二份 HTML，也没有改 LexOrder 正式业务代码。
> - 侧栏完全按统筹通知：当前案件八个一级入口「概览、程序、材料、事实、文书、记录、财务、归档」；「事实 → 争点、研究」「文书 → 文书台、用印」。全局六个一级入口「今日、客户、日程、事务、财务、资料」；客户、事务、资料的二级入口按通知顺序排列。左下固定「案件、通知、设置」与原用户区。
> - 文书与交付的内容区保留对象列表、正文详情和右侧 Inspector。模板起草是全屏内容页，模板选择为内容列表，不建立第二套左侧分类；主体/程序/引用材料/要点按分组表单排列，右侧显示本次起草检查，底部固定步骤操作。
> - 样式参考用户提供的 [Emporium 商品详情页](https://demo.shadcnstore.com/emporium/products/prod_016)：页面标题与面包屑、清楚的字段分组、细分隔线、右侧状态/信息检查栏；不搬用电商字段。沿用 Chronicle `base-nova`、主题 tokens、字体、边框和 Base UI 组件习惯，不加渐变、发光、装饰性 KPI 卡或大圆角卡片。
> - 参考 [shadcnstore Blocks](https://shadcnstore.com/blocks) 的 App Shell、Application Interface、Data Grid 与 Multi-Step Forms；不将模板分类做成左侧应用导航。用户提供的 Emporium 具体商品 URL 在本次浏览会话返回 Cache miss，因此本轮不宣称逐像素检查该页面；按其商品详情页方向做信息层级对照，并以可读取的官方 Blocks / Base UI 文档校准。Base UI 参考 [Field](https://base-ui.com/react/components/field)、[Forms](https://base-ui.com/react/handbook/forms)、[Select](https://base-ui.com/react/components/select)、[Input](https://base-ui.com/react/components/input)、[Dialog](https://base-ui.com/react/components/dialog)。短选项使用 Select；长候选列表再考虑 Combobox。
> - 已通过 Chromium DOM 点击验证：事实/文书二级深链激活、A→B→A 恢复分区、全局时当前案件整组 inert/disabled、重新选案后启用；模板全屏页三步、字段核对前禁止生成。原生 Tauri WebView 仍未验收。
>
> **统一侧栏路由映射**（预览使用内部 hash 表示合成案，以下为仓库已核实的正式路由）：
>
> | 侧栏入口 | 正式路由 |
> |---|---|
> | 概览 / 程序 / 材料 / 记录 / 财务 | `/matters/{matterId}/overview`、`/matters/{matterId}/tasks`、`/matters/{matterId}/materials`、`/matters/{matterId}/records`、`/matters/{matterId}/finance` |
> | 事实 → 争点 / 研究 | `/matters/{matterId}/evidence`、`/matters/{matterId}/research` |
> | 文书 → 文书台 / 用印 | `/matters/{matterId}/delivery`、`/matters/{matterId}/seal` |
> | 归档 | `/practice/archive?matter={matterId}` |
> | 今日 / 日程 / 全局财务 | `/practice/today`、`/practice/schedule`、`/practice/finance` |
> | 客户 → 名册 / 收案 / 联系人 / 冲突预检 | `/practice/clients`、`/practice/intakes`、`/practice/contacts`、`/practice/conflicts` |
> | 事务 → 按案办理 / 法院来件 | `/practice/operations`、`/practice/operations/court-inbox` |
> | 资料 → 资料库 / 模板 / 报表 / 执业资料 / 操作记录 | `/practice/resources`、`/practice/templates`、`/practice/reports`、`/practice/profile`、`/practice/audit` |
> | 固定底栏 | `/matters/list`、`/notifications`、`/settings` |
>
> **需要统筹确认的共享壳差异**：归档真实路由是 `/practice/archive?matter=...`，不是 `/matters/{id}/archive`。当前 `chronicle-shell.tsx` 的 `caseRoute(pathname)` 只识别 `/matters/{id}/{section}`，`MatterSection`、`recent-matter.tsx` 的 Visit.section 也只接受 `matterSections`；因此正式壳还需支持把 `/practice/archive?matter=` 识别为当前案件的 `archive` 分区，并将该分区写入/恢复最近访问。最小共享文件范围：`features/shell/chronicle-shell.tsx`、`features/matters/sections.ts`（新增独立侧栏/最近访问类型，不能让通用 `[section]` 路由误接 `/archive`）、`features/matters/matter-workspace-switcher.tsx`、`features/matters/recent-matter.tsx`。业务组不应自行改这些文件；本预览用内部 hash 表示归档，正式路由映射如上。

# 文书与交付 · 事实矩阵与交互评审

[打开两案预览](./index.html)　·　[从模板起草（步骤 1）](./index.html?template=1#/matters/A/review/A-D02)　·　[逐版复核](./index.html#/matters/A/review/A-D02)　·　[旧包签收事件](./index.html#/matters/A/delivery/A-P01/A-E03)　·　[用印申请](./index.html#/matters/A/seal/A-S01)　·　[下载事实矩阵](./review.md)

基线为 zaenzhang/LexOrder [main@95eabf3f](https://github.com/zaenzhang/LexOrder/commit/95eabf3f566a4409bd24ccd78da978ca6cc20085)。本轮核对远端时 HEAD 相同。[上一阶段 #29](https://github.com/zaenzhang/LexOrder/pull/29) 的 3711576 已是该提交的祖先。合入后，准备或补发会重新读取可交版本与权限，原件撤回导致清单不可读时仍可按原编号另建补发。固定版本作为输入；Editor 保存与回传属于材料包。成果仅为合成预览与评审，统筹跨包评审后再决定正式代码的改动。

## 证据口径

**源码**为固定提交的页面、服务与测试断言。**既有实跑**为仓库迁移文档登记的隔离结果，另有本对话 #29 的个人运行时、两案 PostgreSQL 实测。**上一版点击**为独立 React 预览的渲染 DOM、表单、历史和合成文件；各项在下面逐一标明。**暂缺**指本轮未连真实业务服务、宿主或相邻预览实跑的部分。预览只读本浏览器合成数据，已保存的模拟记录刷新后保留，重置仅清空本预览。

## 事实矩阵

| 旧入口（网页版 → 当前桌面） | 对象、权限与写入校验 | 状态与历史依据 | 新入口与证据 |
|---|---|---|---|
| 全局模板管理、程序区选择模板 → 文书与交付内“导入文书模板” | 新建工作区 DocumentTemplate 与模板源件需配置权限、有效 DOCX、不超过 10 MB。普通案件材料与模板分属不同对象 | 模板可启停；已生成文书保留使用时的模板和源件身份 | 文书与交付页头“导入文书模板”模拟选择专用 DOCX；“从模板起草”进入独立工作页。源码、既有实跑；设置完整 CRUD 暂缺。[模板服务][tm] |
| 程序区 TemplatePickerDialog → 从模板起草 | 选本案适用且启用的模板、主体和程序。主办/协办及 documents.write；重新计算可编辑值，主体/来源变化须重核，必填、人工核对及非归档检查 | 准备字段只读；临时填值不改案件主数据。render-template 的 requestKey 去重；创建 Document.id、familyId、V1、DRAFT，留程序、字段/主体与模板源件摘要快照 | 文书与交付→从模板起草全屏工作页→选择模板、主体/程序、字段核对→生成 V1 详情；上一版已有真实 DOCX 解包检验，本轮已对全屏起草三步、字段失焦、脏表单返回保护和生成门禁做 Chromium DOM 点击复验；真实多方选择校验仍据正式服务源码。[起草组件][draft] · [模板实跑][tsm] |
| 案件材料中的文书复核 Dialog → 桌面同一分区的逐版复核 | 案件关联、documents.read、材料逐件可读；只列团队成果或模板产物。本人上传的当前草稿加 documents.write 可送审，档案锁阻写。文书审批按 DOCUMENT_APPROVE | 同一 documentId 的 DRAFT→PENDING_REVIEW；附理由退回 DRAFT 后可重送。批准要求当前版；有资格时允许退回仍在待审的旧版。服务没有申请人撤回送审动作 | 从稿件送审→版本列表/详情；退回与重送各留一条记录。源码、既有实跑、上一版点击。[复核 API][rapi] · [文书状态][docactions] |
| 复核问题/回应/复查 → 固定版本 Sheet | 问题绑 documentId、issueId 与问题修订；提出、作者回应和审批人复查各有资格。回应分采纳/部分采纳/不采纳；采纳修订等适用场景需核对具体后继稿、位置或依据，服务以 canResolve 决定可否关闭 | OPEN→WAITING_CHECK→RESOLVED 或回 OPEN；历史问题留在原版。后继版可以点回旧问题 | 固定版详情→单项动作 Sheet；原问题按旧 ID 跳转。上一版点击完整一轮基础问题；审批角色拆分、具体修订附件等完整验证以原服务为准。[问题服务][issues] · [复核界面][rdesk] |
| 正式批准、登记新版 → 逐版复核/材料工作稿 | 明确核对固定版本与每个列出的问题，校验案、版本、更新时间、摘要和完整问题修订集合；有未结项时仍须逐项核对，不额外要求全解决。退回只核对版本并填原因 | APPROVED 固定原版；Editor 提供新 Document.id，同族 V2 从 DRAFT 独立审。变焦/重读不代替手工核对；旧交付保持原件 | V1 详情→核对批准→冻结。V2 的模拟入口注明 Editor。源码、两期实跑；本轮另验旧问题回跳、过期快照拒绝。[固定批准][fixed] · [版本烟测][reviewSmoke] |
| 网页用印/审批含旧别名 /seals → 桌面 /matters/{id}/seal | SealRequest(matterId, sealType, purposeConfigId, draftDocId)。seals.request、启用的印章×事项、用印事由、正数页数份数、待章 PDF。个人模式创建 PENDING。桌面当前收待章文件；网页服务另有 existingDraftDocId | PDF 与申请、申请人及时间固定；批准工作稿和申请用印是独立业务事实 | 用印列表→申请 Sheet，示范合成待章 PDF；实际导入与模板 DOCX 分开。源码、既有实跑、上一版点击。[用印服务][sealSvc] · [用印界面][sealUI] |
| 用印待办、决定、实盖回填 → 桌面用印行操作 | PENDING + canApprove 才能确认或附理由驳回；有 canCancel 的待审申请可撤销。APPROVED + canStamp 并提交实际章后 PDF 才能登记实盖 | PENDING→APPROVED→STAMPED；另有 REJECTED、CANCELLED。原申请及决定保留，draftDocId、stampedDocId 两个文件独立 | 用印详情只放当前步骤，次要选择进“更多操作”；可点回章前/章后原件。源码、既有实跑、上一版点击。真实盖章/读扫描仪暂缺。[用印服务][sealSvc] · [模板用印验收][tsm] |
| 从材料准备交付、案内交付列表 → /matters/{id}/delivery | DeliveryRecord 与有序 items。读要求 matters.read、documents.download 及逐件授权；写另需 matters.write、matters.export、非归档。1–30 个不同同案可导出版本，自制稿 APPROVED/FILED，外部来源和未声明另审；收件人/联系/目的/披露必填 | 冻结 documentId、version、sha256、position 和收件人快照，产生 PREPARED。新版不会替换；同一请求重试同记录 | 已批准版→冻结 Sheet；实际交付→准备交付可重新选。源码、既有实跑、本轮点单件冻结；30 件边界与外部类别未在预览重演。[交付服务][ds] · [输入契约][contract] |
| 固定包导出、登记实际送出 → 原清单内按钮 | 导出逐件读固定字节、核对摘要和体量，整包成功才追加 EXPORTED。SENT 需说明与渠道，同一清单只登记一次；可直接从已冻结清单登记，ZIP 为可选操作 | PREPARED→EXPORTED（仅导出）或 SENT。发生时间、登记时间、操作人各自保存；只记录已经发生的事 | 清单详情→导出 ZIP / 登记实际送出两个动作。源码、#29 真库实跑、本轮解开 ZIP 与内层 DOCX，比对 V1 原始字节。[导出][zip] · [历史事件][events] |
| 收悉、客户回复、内容确认、更正 → 交付事件 | 先有 SENT。说明必填；发生时间不可超过未来漂移窗，同案可读固定凭据可选。SEND_CORRECTION 限本清单 SENT 或已有发送更正，须渠道 | RECEIVED、REPLIED、CONTENT_CONFIRMED 各为追加事件，汇总仍 SENT。收悉保留客户决定原状态。事件保留 occurredAt、recordedAt、渠道、原义、actor 及 proofDocumentId。更正通过 correctsEventId 指回原登记 | 详情→登记收悉／更多操作→更正、回复或内容确认；事件可定位。源码、#29 独立实跑、本轮点收悉、更正、错案拒绝；回复/确认入口保留。[服务][events] · [真实烟测][reviewSmoke] |
| 历史清单/补发、材料撤回 → 桌面旧清单 | 补发新建同案 DeliveryRecord.supersedesId；重读材料和授权。材料撤回由材料服务校验 documents.write、归属、归档及待审归档锁。交付没有撤销已发生送出的事件 | 清单项撤回→UNAVAILABLE，隐藏目的与接收人，旧包禁开/导出，可另选可读件补发。仅凭据撤回→事件时间/类型等保留，隐藏依赖该证据的说明、凭据名及 ID | 详情→补发→原编号；验收场景分别模拟两种撤回结果。材料实际撤回在材料包执行。源码、上一版点击、既有服务回归。[材料撤回][withdraw] · [可见性][redact] · [补发回归][sup] |
| 原件/回单/章件的下载锚点、关联客户历史 → 桌面材料或案内交付 | 以 matterId 加固定 documentId 重验读取，PDF 可 inline，其他固定件基线多为 download；只有可编辑工作稿走 Editor.open | 同名和最新文件均不能代替原 ID；网页保留 document/reviewIssue 以及 delivery/deliveryEvent。基线桌面分区 URL 稳定，Sheet 选择原是局部状态 | 统一“固定原件”阅读/另存合成件；支持本页合成案号的三类老链接形状和历史回跳。真实系统打开任意历史 DOCX 属材料组待联调。[材料][mat] · [网页历史][old] |
| 全案归档专业历史 → 归档组冻结/导出 | 本次 selectedDocumentIds 须覆盖清单所有 items；引用以 deliveryId/eventId/proofDocumentId/correctsEventId/supersedesId 和版本摘要固定。完整导出再次核对归属、权限、状态、摘要 | role=DELIVERY_PROOF。额外凭据可只留引用；显式选入才有其实体。归档后发生的事实不回填旧快照，缺件/撤回可阻断整包 | 交付→归档引用→定位原事件；勾选实体演示区别。源码、既有归档回归、本轮点引用；独立两包没有互通的真实归档会话。[归档服务][arc] · [归档回归][arct] |

## 老入口、交互与跨包

桌面基线把 TemplateDrafts、DocumentReviewDesk、DeliveryWorkspace 顺排在同一个 delivery 分区。本预览采用统筹统一的八个案内一级入口；事实和文书各自拥有二级入口。“文书”父项下分“文书台”和“用印”。文书台内容区列表同时呈现文书版本和交付清单，以对象类型筛选；列表、正文、Inspector 三栏可拖动调整宽度，列表支持方向键/Home/End 选中；文书详情承载逐版复核，交付详情承载送出、收悉和补发。用印保留原 `/seal` 深链，只改变侧栏归属。起草是从文书列表发起的独立工作页，不是导航分类。程序与期限只读，不随交付或用印操作改变。完整 Chronicle 壳、全局审批和归档工作台维持原归属，原模板菜单在本轮隔离壳里未复制。[基线组合入口][section] · [案内审查][audit] · [迁移范围][plan]

| 现有入口或职责 | 预览中的等价定位与协作约定 |
|---|---|
| 案内 /delivery、/seal；起草成功回执、复核版本、用印列表行、原交付行 | 保留案内分区；详情新增可分享的合成 hash，按 matterId、documentId 或 deliveryId、eventId 定位。清单和用印详情分别链接材料对象，回到列表仍可选原行。案号或文书名不替代业务 ID。 |
| 网页材料/历史 query、从某个文书准备交付 | [原问题形状](./index.html#/matters/CH-2026-001?document=A-D01&reviewIssue=A-I00)、[原事件形状](./index.html#/matters/CH-2026-001?view=work&workPane=records&delivery=A-P01&deliveryEvent=A-E03)、[按原稿准备形状](./index.html#/matters/CH-2026-001?deliveryDocument=A-D01)。最后一种只预选，不自动冻结。正式路由尚待统筹。[网页材料入口][webm] · [交付面板][webd] |
| 材料组的导入与打开 | 已对照材料预览的 CH-2026-001／QL-2026-002 两案、程序、期限、导入用途。模板导入是工作区 DOCX；工作稿新版交接 matterId、familyId、baselineDocumentId；待章 PDF、章后 PDF 各自登记；本文书可选既有同案凭据 ID。只读原件定位 matterId+documentId，返回保留来源行和事件；Editor 只接可编辑基线。两包合成 ID 独立，不凭同名推断关联。 |
| 归档组的凭据消费 | 已对照归档预览的显式选件与清单。交接字段为 matterId、deliveryId、eventId、documentId/version/sha256、proofDocumentId、correctsEventId、supersedesId。归档组保存冻结的专业历史；凭据是否已选入实体在归档检查中分别呈现。合成 ID 映射和两包真实对象互跳待统筹。 |

## 可重复点验

所有操作均使用合成数据。左下“验收场景”可恢复正常或重置。为从头演练请选择“重置合成数据”并确认。发生时间按上海时区；两个程序可以同时存在。初始甲案 V1 已批准且已交付、V2 待复核。乙案含同名法律意见书与回单，交付及用印列表为空。

1. **固定历史**。进入甲案逐版复核 V2，点“此前版本的未结问题”定位 V1 的具体问题；点固定原件读正文。切到乙案，打开同名法律意见书，核对不同案号、ID 和正文。用浏览器返回旧案。直接进入[错案链接](./index.html#/matters/B/delivery/A-P01/A-E03)应被拒绝。
2. **从零起草**。起草→从模板起草，选择程序、填名称与“实际字段”。失焦、切窗再返回字段应保留。未核对时提交会得到错误；重新核对字段并勾选后生成 V1。提交本版送审→退回本版，填原因并勾固定版本；重送后在“更多操作”提出问题，作者回应、复查。核对批准须逐项勾选并确认本版。
3. **导出与实际交付**。已批准版→冻结交付清单，核对接收人、联系地点与披露范围。导出固定 ZIP，列表仍为“已导出，未登记发送”；此时无收悉入口。另行登记实际送出、发生时间、渠道、说明；再登记收悉并选本案签收回单。查看实际/登记时间、收件对象、回单及待确认客户决定。更多操作→更正发送登记，点击更正原记录回到指定事件。
4. **V2、补发与归档**。回到刚批准的 V1，更多操作→模拟 Editor 登记后继版。V2 独立送审和批准。回旧清单重新导出并查看原件，仍为 V1。另建补发选择 V2，检查新清单编号和可点的原清单。归档引用中对照原事件，勾选“同时选入可读凭据原件”前后观察实体/引用的差别。
5. **用印**。申请用印，填事由、页数、份数并选择模拟待章 PDF。本人确认后状态仍待盖章；登记实际盖章选择另一份 PDF，分别打开原稿与扫描件。新建两份待审申请，分别执行本人撤销、附理由驳回，核对历史。
6. **错误、撤回与只读**。验收场景→跨案凭据校验→登记收悉，选乙案同名回单，提交应拒绝且保留输入。分别选已撤回签收凭据/清单原件，检查前者保留事件且遮蔽说明，后者不显示旧目的/收件人，重新准备补发时只列可读已批稿。选择只读后仍可读原件，写按钮消失；切换读取失败→重新读取；乙案空列表可从合法入口开始。核对快照失效应拒绝批准，重新恢复正常后另开表单。场景随刷新保留。
7. **失焦与返回**。模板全屏页中填值，Tab/窗口失焦再返回，点击返回或浏览器返回时保护脏字段。选继续填写核对原值；再次返回→放弃，再浏览器前进，回到原用印/文书分区。干净 Sheet 按 Esc 还焦到原触发按钮。旧事件链接可复制、新窗口按同一案重新定位；只读场景和撤回状态应继续生效。

## 两层评审与验证范围

| 层次 | 实际评审及处理 | 留待统筹 |
|---|---|---|
| 第一层 · 业务事实 | 对照网页、当前桌面及原服务的独立只读审查。纠正了预览初稿把“退回”也要求逐项勾选的问题；撤回的 V1 在材料、复核、版本列表均不暴露。一份待审文书可以带未结问题退回；批准须逐项核对，签收只追加事实。 | 材料包原件打开契约、归档实体选择与深链统一。预览仅演示典型单件包、一位具备相应资格的合成律师与只读角色。 |
| 第二层 · 界面交互 | 使用真实 React/Base UI 组件，在渲染 DOM 实点按钮、填表、切案、读取下载字节和事件链接。初评发现脏表单放弃返回后前进记录丢失、只读与撤回场景刷新丢失，已在预览修正并回归。 | 系统文件选择器、真实 Editor、各浏览器下载策略与 Tauri WebView 的窗口焦点/系统打开仍需宿主复验。本轮未写正式路由或 API。 |

重复运行用固定基线安装好的桌面依赖，在预览源码目录设置 CHRONICLE_DESKTOP 指向该仓库的 desktop/personal-chronicle，运行 node build.cjs 和 node verify.cjs。该驱动对实际生成的单文件预览派发 DOM 操作，解包断言 ZIP 内 V1 与 V2 后旧 ZIP 的字节。不能将此结果计为本轮正式业务服务或原生 WebView 实跑。[本轮逐项运行输出](./verification.txt)

## 模板与来源

沿用 Chronicle 的 PageHeader、Button、Badge、Input、Textarea、NativeSelect、Sheet 与 `Field` 分组习惯；布局样式在隔离预览中实现，引用基线 slate/cobalt 主题变量。起草页按 Emporium 商品详情页的字段密度与右侧信息栏重排，不复制电商业务，也不引入新组件库。短操作沿用现有 Base UI Dialog/Sheet primitive，但统一呈现为居中 Dialog，含 Portal、键盘焦点及减少动效；模板起草仍是独立页面，不套 Dialog。没有引入另一套组件库。[Tasks][tasks] · [Users Sheet][users] · [本地 Sheet][sheet] · [界面约束][agents] · [个人版迁移及既有实跑][migration]

官方对照：[Chronicle 模板](https://demo.shadcnstore.com/chronicle/) · [Base UI Quick start](https://base-ui.com/react/overview/quick-start) · [Dialog 与焦点](https://base-ui.com/react/components/dialog) · [Composition](https://base-ui.com/react/handbook/composition) · [Styling](https://base-ui.com/react/handbook/styling) · [Animation](https://base-ui.com/react/handbook/animation) · [shadcn Base Sheet](https://ui.shadcn.com/docs/components/base/sheet)。

[tm]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/document-templates/actions.ts#L123>
[tsm]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/tools/workbench-m1/chronicle-smoke/templates-seal.mjs#L24>
[draft]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/features/matters/template-drafts.tsx#L50>
[rapi]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/app/api/personal/document-review/route.ts#L120>
[docactions]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/documents/actions.ts#L298>
[issues]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/document-reviews/service.ts#L267>
[rdesk]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/features/matters/document-review-desk.tsx#L305>
[fixed]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/document-reviews/fixed-approval.ts#L14>
[reviewSmoke]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/tools/workbench-m1/chronicle-smoke/document-review.mjs#L100>
[sealSvc]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/seals/actions.ts#L147>
[sealUI]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/features/matters/seal-workspace.tsx#L63>
[ds]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/deliveries/service.ts#L35>
[contract]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/deliveries/contracts.ts#L9>
[zip]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/deliveries/export.ts#L21>
[events]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/deliveries/service.ts#L158>
[withdraw]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/documents/material-ingest.ts#L285>
[redact]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/deliveries/service.ts#L203>
[sup]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/features/matters/delivery-prepare.test.ts#L31>
[mat]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/features/matters/materials-workspace.tsx#L59>
[old]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/clients/history-service.ts#L299>
[arc]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/server/archive/professional-history.ts#L93>
[arct]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/tests/server/archive-professional-history.integration.test.ts#L116>
[section]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/features/matters/matter-section-page.tsx#L138>
[audit]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/docs/lexorder-matter-ui-audit.md>
[plan]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/docs/lexorder-desktop-migration-plan.md>
[webm]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/app/(app)/matters/[id]/_components/matter-detail-tabs.tsx#L258>
[webd]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/src/components/deliveries/delivery-panel.tsx#L129>
[tasks]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/features/tasks/tasks-page.tsx#L113>
[users]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/features/users/user-sheet.tsx>
[sheet]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/components/ui/sheet.tsx#L42>
[agents]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/AGENTS.md>
[migration]: <https://github.com/zaenzhang/LexOrder/blob/95eabf3f566a4409bd24ccd78da978ca6cc20085/desktop/personal-chronicle/docs/lexorder-personal-migration.md#L92>

## 2026-11-20 v2 交互收口与文件预览

### 短操作

`Sheet` 是当前本地 Base UI Dialog primitive 的包装。它在原界面呈现为右侧抽屉；本轮不更改其 React 结构和业务动作，只在隔离预览样式层统一改为居中模态窗口。短字段录入、单次选择、确认/驳回和事件登记使用该居中 Dialog。完整起草流程仍为独立页面；需要列表与正文同时核对的事项仍在内容区分栏，不通过抽屉承载。

### 文件预览

- 文书详情里的固定原件链接改为打开中央内容区的只读预览，不导航离开当前复核/交付对象。
- 预览来源是当前案件的 `docs + files`；下拉选项显示文件名、版本和固定 ID，因此 `法律意见书.docx` V1 与 V2 不会混淆。
- 可用“上一份 / 下一份”及下拉选择切换；右侧 Inspector 继续显示原业务对象。预览顶部明确显示“当前业务对象”，避免把查看另一个文件误解为切换复核目标。
- 从“材料”侧栏进入时自动打开首个可读固定原件；显式关闭后保持关闭，直到用户重新导航。
- 撤回/不可读文件不进入可切换列表；预览不修改版本、事件、状态或路由。
- 本轮正文来自合成 `body` 字段，未真正解析 PDF/DOCX 二进制。真实文件查看器、分页/缩放/下载/系统打开以及大文件性能属于正式迁移验收，不计入本轮通过项。

### 本轮 Chromium 验证

| 用例 | 结果 |
|---|---|
| 在 V2 详情打开固定原件预览 | 通过 |
| 同名 V1/V2 以版本号与 ID 区分 | 通过 |
| 下拉切换、上一份/下一份 | 通过 |
| 切换预览后 URL、V2 复核对象不变 | 通过 |
| 材料分区默认预览，关闭后不自动重开 | 通过 |
| 短操作居中 Dialog，非右侧抽屉 | 通过 |
| 起草全屏三步、Inspector 精简、输入字号 | 通过 |
| 预览切换和 Dialog 操作后页面无循环重渲染 | 通过 |

原生 Tauri WebView、Windows 系统文件打开、真实 PDF/DOCX 渲染和生产 API 尚未验证。

## 2026-11-20 模板工作页的业务边界

当前交互预览的第二步展示委托人、对方当事人、第三人、程序、保存卷宗、固定材料引用、文书名称与本次要点；修改主体、程序或材料引用会使“已核对”失效，第三步必须重新核对后才能生成。生成后的右侧 Inspector 展示模板来源、卷宗、引用材料和版本族。

**这仍是合成预览，不是正式 API 实现。** 当前 `postprocess.js` 直接向两案本地合成数据写入一个 V1 `DRAFT`，用于观察交互和路由。正式迁移必须继续使用现有 `prepare-template` / `render-template` 服务，并保留 `templateUpdatedAt`、`expectedValues`、`expectedSubjects`、主体选择（委托人/对方/第三人/程序）、`contextInputs`、`folderId`、`requestKey`、`reviewed` 和服务端校验。服务端错误应回到同一步并保留已填内容；模板更新或条件变化时不得用旧准备结果生成。默认 Editor 继续负责打开、保存和回传新版本。

当前桌面 `template-drafts.tsx` 与旧网页 `template-picker-dialog.tsx` 的能力并不完全相同：旧网页有 `ContextInputPicker` 与保存卷宗选择；正式重构不能因本次页面改版而丢失这两项。

