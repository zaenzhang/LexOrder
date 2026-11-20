# 全量实验档案：分块无损还原

本目录是 `LexOrder-NLV-庭审对抗实验档案-v8.5.zip` 的 **13 个原始二进制分块**，因 GitHub 连接器单次传输 4.7 MB ZIP 遇到上限而分块提交；本目录不是 13 份独立 ZIP。

- 原 ZIP 字节数：`4744745`
- 原 ZIP SHA-256：`a2595cd7abef55579c980f9631bc8f210246661bcf6464e20aef509f253fb818`
- 文件：`LexOrder-NLV-庭审对抗实验档案-v8.5.zip.part-00` 至 `.part-12`。00–11 各 393216 字节，第 12 块 26153 字节。

从该目录执行：

```bash
cat LexOrder-NLV-庭审对抗实验档案-v8.5.zip.part-* > LexOrder-NLV-庭审对抗实验档案-v8.5.zip
sha256sum LexOrder-NLV-庭审对抗实验档案-v8.5.zip
```

跨平台 Python（在 Windows PowerShell / macOS / Linux 均可）：

```python
from pathlib import Path
parts = sorted(Path(".").glob("LexOrder-NLV-庭审对抗实验档案-v8.5.zip.part-*"))
assert len(parts) == 13
Path("LexOrder-NLV-庭审对抗实验档案-v8.5.zip").write_bytes(
    b"".join(part.read_bytes() for part in parts)
)
```

验证 SHA-256 完全一致后解压。全量归档保存了第一轮和第二轮的 HTML、工作簿、图片、SVG、PDF、上游示例、报告及测试记录。各分块本身也是独立提交到 Git 的二进制文件，并非链接或占位符。
