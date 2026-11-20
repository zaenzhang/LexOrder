# LexOrder · 程序、任务与日程桌面界面评审产物

**状态：仅设计审查，不包含正式业务实现。** 对应 [Issue #34](https://github.com/zaenzhang/LexOrder/issues/34)。

- 审查仓库基线：`main@95eabf3f566a4409bd24ccd78da978ca6cc20085`
- 范围：个人桌面 `desktop/personal-chronicle` 的程序、任务与日程界面
- 数据：两案合成数据，**不使用生产数据**
- 正式代码、公共 API、Schema、授权、共享侧栏、迁移文档：**没有改动**

## 当前唯一评审基线

- [可交互 HTML 预览](./preview.html)：程序总览 → 当前程序任务工作区；独立任务详情与新建表单；案内/跨案日期及责任对象定位
- [程序总览截图](./screenshots/program-index.png)
- [当前程序工作区截图](./screenshots/procedure-workspace.png)
- [最终事实与设计审查](./docs/final-review.md)

**不要从历史版本挑选组件直接合并。** `archive/all-review-artifacts.zip` 保存此前的六版 HTML、评审依据、截图与 README，共 16 个文件，用于追溯，不作为最新方案。

## 内容结构

案内「程序」首先列出该案所有程序，并提供「新建程序」。点击具体程序后才进入该程序任务工作区，主区域为真实程序环节的待办/已办结/已取消 Board/Table，右侧为程序信息、庭期与法律期限。

未关联真实环节的事项级任务仍在「全案任务」中；同案或同日不能推断程序、庭期、期限与 Task 关联。程序可以并存；任务计划、办结、取消与重开均不得修改法定期限或程序真实状态。

整体复用 Chronicle 侧栏，不在业务模块里新建导航。详情和新建任务采用正文路由，短查看和确认不应扩展成完整页面。

## 审查依据

- [统一侧栏与路由映射](./docs/navigation-map.md)
- [业务与交互复核（早期）](./docs/business-ux-review.md)
- [程序总览及程序工作区验证记录（早期）](./docs/program-workflow-validation.md)

其中早期材料用于说明迭代过程；最终 UI 以 `preview.html` 和 `docs/final-review.md` 为准。

## 已验证与待验收

隔离 HTML 通过 `node --check`，并曾以 Chromium DOM 实际验证程序总览、程序切换、环节筛选、任务详情返回、新建任务和新建程序等路径。本 PR 不声称这些检查构成 Tauri 或正式服务端验收。

正式实现仍需独立核对：Tauri WebView 键盘与滚动、后端事务/并发、上海时区、已终结程序（特别是庭期与环节新增）、历史深链与责任状态校验。具体门禁见 Issue #34。

## PR 范围

本目录是供统筹与跨包评审使用的隔离产物，不注册应用路由、不更改菜单，不自动执行 HTML 里的模拟状态。正式实现另开 PR，且不自行合并本 PR。
