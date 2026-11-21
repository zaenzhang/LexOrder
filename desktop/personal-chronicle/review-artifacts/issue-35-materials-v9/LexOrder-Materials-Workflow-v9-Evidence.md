# LexOrder Materials v9 — Source Evidence

基线：`main@95eabf3f566a4409bd24ccd78da978ca6cc20085`。GitHub compare `95eabf3f...main` 返回 `identical`，因此本轮核对的 `main` 与用户指定基线一致。

## E1. Schema — 材料类别、来源、状态和身份是独立字段

来源：[prisma/schema.prisma](https://github.com/zaenzhang/LexOrder/blob/main/prisma/schema.prisma)

- `DocumentCategory` 有 `EVIDENCE / PLEADING / PROCEDURE / JUDGMENT / CONTRACT / OTHER` 六个值。
- `DocumentSourceOrigin` 有 `CLIENT_PROVIDED / COURT_SERVED / AI_EXTRACTED / SELF_COLLECTED / TEAM_PRODUCED` 五个值。
- `DocumentStatus` 有 `DRAFT / PENDING_REVIEW / APPROVED / FILED` 四个值。
- `Document` 分别保存 `category`、`sourceParty`、`status`、`version`、`isLatest`、`familyId`、`sourceOrigin`、`folderId`，说明类别、来源方、状态、版本族、来源和卷宗归属是不同字段。

## E2. Upload service — 上传写入分别接收类别与来源

来源：[src/server/documents/actions.ts](https://github.com/zaenzhang/LexOrder/blob/main/src/server/documents/actions.ts)

- `uploadDocument` 分别读取 `category`、`sourceOrigin`、`sourceParty`、`procedureId`、`stageId`、`folderId` 等字段。
- 校验文件类型和大小、案件经办权限、目标卷宗是否属于本案、环节是否属于所选程序、归档后的可写规则。
- 通过校验后调用 `ingestMaterial` 保存材料元数据和文件内容。
- `sourceOrigin` 按枚举值独立解析；上传服务没有将 `COURT_SERVED` 自动等同于法院来件流程已去重/匹配/完成的逻辑。因此 UI 不应显示“已核实入卷”。

## E3. Existing upload UI — 多文件接件是逐件流程

来源：[material-upload-dialog.tsx](https://github.com/zaenzhang/LexOrder/blob/main/src/app/(app)/matters/%5Bid%5D/_components/material-upload-dialog.tsx)

- 每个文件建立独立 row，保留文件对象、请求 key、草稿字段、已提交字段、状态、回执、材料 ID 和错误消息。
- 状态覆盖待上传、提交中、拒绝、结果未知、上传未完成、已保存和关闭。
- 每行可独立修改并提交；共同默认值仅用于仍可编辑的行。
- 结果未知/已有上传意图时不能直接重复新建请求；必须核对原请求或沿原请求继续。
- 所属案件、程序和页面位置变化时会暂停/阻止错误上下文下的继续提交。

## E4. Court inbox — 独立工作区，不是材料分类

来源：[desktop/personal-chronicle/docs/lexorder-matter-ui-audit.md](https://github.com/zaenzhang/LexOrder/blob/main/desktop/personal-chronicle/docs/lexorder-matter-ui-audit.md)

迁移审查记录将法院来件列为独立工作区，负责来件粘贴去重、附件处置与归案；材料上传/材料页则负责正式案件材料。故“法院来件”应保留在事务导航，不应与 `DocumentCategory` 或 `DocumentSourceOrigin` 混为一类。

## E5. Personal Chronicle design constraints

来源：[desktop/personal-chronicle/AGENTS.md](https://github.com/zaenzhang/LexOrder/blob/main/desktop/personal-chronicle/AGENTS.md)

Chronicle 采用 `base-nova` 和本地主题/Kit 封装，要求复用 PageHeader、Card、DataTable、Sheet、表单控件及 Base UI 焦点/键盘语义。导航、滚动、弹层关闭与焦点恢复需按桌面 WebView 复验。

## Evidence boundary

以上是从指定 GitHub 基线源码和项目约束读取到的事实。v9 HTML 的合成数据、编辑器模拟、上传回执模拟和目录状态切换仅用于交互评审，不证明真实 Tauri、数据库、系统文件关联或外盘硬件验收已经完成。
