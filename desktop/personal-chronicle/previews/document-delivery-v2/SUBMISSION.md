# 文书与交付 v2 · 预览提交说明

> 仅提交隔离 HTML/两案合成数据/评审产物；不是正式 Tauri 页面实现。

- 仓库：`zaenzhang/LexOrder`
- 固定起点：`main@95eabf3f566a4409bd24ccd78da978ca6cc20085`
- 需求与后续实现：[Issue #36](https://github.com/zaenzhang/LexOrder/issues/36)
- 材料阅读器共享边界：[Issue #35](https://github.com/zaenzhang/LexOrder/issues/35)

## 推荐查看

1. 打开 [index.html](index.html)，交互检查文书台、模板起草、复核、交付、用印与材料文件切换。预览所有数据均为合成数据；无需登录、无需真实后端。
2. 阅读 [review.md](review.md) 的业务事实矩阵与路由映射，或 [review.html](review.html) 浏览器版。
3. 查看 [screenshots/](screenshots/) 中的六张本轮截图；仅用于视觉核对。
4. 下载 [review-package.zip](review-package.zip) 获得完整 **53 个文件**：原始 React 合成源码、统一侧栏后处理脚本、两案 seed、重建/Chromium 回归脚本、历史版本、所有截图和审查报告。
5. 检查 [ARTIFACTS.md](ARTIFACTS.md) 和 [SHA256SUMS.txt](SHA256SUMS.txt)。SHA256SUMS 对应解压后 `lexorder_review_source/` 内的文件。

## 独立复验

```sh
unzip review-package.zip
cd lexorder_review_source/source
node verify.cjs
cd ..
sha256sum -c SHA256SUMS.txt
```

本次从原始 ZIP 独立解压复验：`node verify.cjs` 通过，10 项 SHA256SUMS 校验通过，ZIP 结构检查无错误。

已记录的 Chromium 交互回归详见 `verification-v2.txt`（为先前测试报告，本 PR 不声称在 Tauri WebView 或真实 PDF/DOCX 二进制阅读器中完成验收）。

## Scope

不包含正式业务页面、schema、公共 API、授权、原生 Tauri 壳、菜单/路由激活更改；正式开发继续遵守统筹约定的单写者和跨包评审，Editor 保存回传和材料读取/预览由各自负责人负责。

> 打包原件 SHA-256: `3882a04aee4c32214a77a0a8975bc6282cda8cf3a91c070060790340dd756b3c`
