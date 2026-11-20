# NLV 庭审对抗分析实验档案

本目录是对 `MiaoQichuan/new-litigation-visualization` 中 `mqc-trial-confrontation-master` 的实验记录与 LexOrder 交互预览。所有文件按版本保留，不覆盖早期结果。

## 先看

1. `LexOrder-诉讼分析工作台-实验预览-v8.5.html`：当前交互预览。解压后直接用浏览器打开；建议桌面宽屏。
2. `实验分析-第二轮.md`：业务方法、结构发现和 LexOrder 映射建议。
3. `实验记录.md`：第一轮、第二轮连续实验日志。
4. `来源与产物清单.json`：固定上游 commit、源码文件 SHA、所有重要产物 SHA-256。
5. `实验测试结果-v8.5.json`：本轮 Chromium 点击验收结果。

## 实验源

- 仓库：<https://github.com/MiaoQichuan/new-litigation-visualization>
- Skill：`plugins/mqc-nlv/skills/mqc-trial-confrontation-master`
- 固定版本：`main@16c480c3947e78ba49623423ea0486277f5fe99d`
- 上游示例：`examples/matrix-input.json`
- 许可证：AGPL-3.0-only

`source-evidence/upstream-matrix-input.json` 是从 GitHub 原始文件读取后保存的输入副本；其 GitHub blob SHA 与本地 SHA-256 记录在清单中。

## Excel 版本

- `庭审对抗分析-示例-初次复现版.xlsx`：第一轮手工复现。
- `庭审对抗分析-示例-按注释理解版.xlsx`：按源码注释中「不冻结」的字面理解生成，用于保留注释与执行行为冲突的证据。
- `庭审对抗分析-示例-结构复核版.xlsx`：按当前 `build_matrix.py` 实际执行行为复核，单工作表、17列、B8 冻结、A7:Q20 自动筛选。

这些是独立复现文件，不是声称由上游脚本原样执行生成的二进制产物。当前执行环境不能解析 `github.com`，因此没有运行上游 pipeline。

## 其他历史产物

- `庭审对抗图-结构预览.svg/.png`：第一轮手工示意，文字布局存在问题；保留作为失败实验记录，不是上游官方图。
- `pdf-preview/`：第一轮 Excel 默认分页预览，保留用于比较，不是正式打印版。
- `V8*` HTML 与截图：各轮预览迭代证据。最终入口为 V8.5。

## 预览范围

预览使用上游单案示例数据。第二案仅用于验证导航隔离，不复制第一案数据。律师复核输入只保存在当前浏览器预览中，不写入 LexOrder 服务。正式业务代码未修改。
