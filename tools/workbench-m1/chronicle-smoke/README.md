# Chronicle 个人工作流定向验收

这些脚本只对隔离运行时中的合成案件写入。它们使用与 Tauri 宿主相同的个人服务、已登记物理目录、工作稿监听与业务事务。原生 WebView 键盘操作、Word 和 Windows 文件关联另行实机验收。

## 准备

1. 按根仓库和 `tools/workbench-m1` 的锁文件安装依赖，生成 Prisma 客户端并构建个人运行时。使用独立空目录作为 `M1_WORKSPACE`。先启动一次 `tools/workbench-m1/personal-runtime.mjs` 完成建库，再正常停止，让它释放 `.owner`。
2. 保留同一个 `M1_WORKSPACE`，在仓库根目录运行下面的命令。种子脚本验证 manifest 与数据库的工作区、操作者一致后新建两个合成案件，写入 `chronicle-smoke-cases.json`。它可在运行时退出后使用内嵌数据库，也支持已迁移并由同一 manifest 引导的隔离 PostgreSQL 实例，通过 `DATABASE_URL` 指定本地连接。

```sh
suite=tools/workbench-m1/chronicle-smoke
node "$suite/seed.mjs"
node "$suite/prepare-editor.mjs"
```

3. Linux 编辑器验收使用宿主的 `xdg-open`、`gio`、Vim 的 `ex` 和 `update-desktop-database`。启动运行时的终端使用下列环境。XDG 配置只影响本次启动的进程。准备脚本为 TXT 注册 Vim Ex，打开测试工作稿时会写入一行并保存。

```sh
export M1_READY_FILE="$M1_WORKSPACE/ready.json"
export XDG_CONFIG_HOME="$M1_WORKSPACE/smoke-editor/config"
export XDG_DATA_HOME="$M1_WORKSPACE/smoke-editor/data"
export XDG_CURRENT_DESKTOP=GNOME
node tools/workbench-m1/personal-runtime.mjs
```

4. 在另一个终端使用同一 `M1_WORKSPACE`、`M1_READY_FILE` 依次执行。就绪文件包含本地临时通道凭据，只在测试进程读取。采用独立 PostgreSQL 启动 Next 的测试宿主可生成同格式的私有就绪文件，字段为本机 `origin` 与 `token`。

```sh
suite=tools/workbench-m1/chronicle-smoke
node "$suite/practice.mjs"
node "$suite/resources.mjs"
node "$suite/material-batch.mjs"
node "$suite/volumes.mjs"
node "$suite/editor.mjs"
node "$suite/finance.mjs"
node "$suite/contracts.mjs"
node "$suite/operations.mjs"
node "$suite/court-inbox.mjs"
node "$suite/matter-workflows.mjs"
node "$suite/matter-management.mjs"
node "$suite/templates-seal.mjs"
node "$suite/archive.mjs"
```

## 检查内容

- 工作稿用两个案件的同名 TXT 核对归属、原件限制、受控签出、Linux 默认编辑器保存、替换写、V1 至 V3 字节及重复事件。脚本只轮询材料详情，等待宿主监听主动回传。随后还原一份旧基线工作稿登记，确认冲突及两份内容保留。200 毫秒安静期用于合并同一次保存的多个文件事件，间隔短于窗口的多次改写可能合并。工作台重新打开时检查已登记工作稿并恢复监听。
- 财务验证以原请求键重试收支登记、本人实际到账确认、错案拒绝、退回和读回。已退回登记的原键再试不能重新生成流水。
- 办案事务验证快递登记和案件边界、保全对象与财产同笔登记、续期历史、归档阻断和收尾安排修订。快递样本使用合成运单，无外部物流服务依赖。
- 法院来件验证重复粘贴与附件去重、待入卷文件处置说明、确认归案后按固定材料 ID 读取原件、过期跨案绑定和已处理记录。

验收完成后正常停止运行时。每次重跑只在已准备的合成工作区生成新的样本。

设置 `M1_CHRONICLE_ORIGIN` 为当前 Chronicle 的回环 origin，可由同一组脚本经桌面通道复验。省略时直连个人业务服务。客户/收案脚本覆盖补正版本冲突、撤回重提与转案；资料脚本检验新版列表、两版原始字节、版本链和 Excel。
