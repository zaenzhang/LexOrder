"""Generate synthetic originals in a NEW directory; never imports business data.

Acceptance-only dependencies: reportlab, Pillow, python-docx, openpyxl.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from docx import Document
from openpyxl import Workbook
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
parser.add_argument("--font", default="/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
args = parser.parse_args()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=False)
pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
font = ImageFont.truetype(args.font, 36)
records = []


def register(path, mime, kind, expected):
    records.append({"file": path.name, "mimeType": mime, "workPackage": kind,
                    "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "expected": expected})


def text_page(pdf, lines):
    pdf.setFont("STSong-Light", 16)
    for i, line in enumerate(lines):
        pdf.drawString(40, 780 - i * 35, line)


for kind, total, paid in [("civil", "120000.00", "40000.00"), ("arbitration", "60000.00", "30000.00")]:
    heading = "合成验收资料，不用于真实事项"
    lines = [heading, "合成甲公司与合成乙公司", f"合同总价 {total} 元。", "2026-05-10 交付与验收分别确认。"]
    adverse = [heading, "对方提出质量异议。", "签收数量不代表质量验收。", f"付款记录 {paid} 元。"]
    image = Image.new("RGB", (1400, 600), "white")
    draw = ImageDraw.Draw(image)
    for i, line in enumerate(adverse):
        draw.text((50, 45 + i * 95), line, font=font, fill="black")
    png = out / f"{kind}-scan.png"
    image.save(png)
    register(png, "image/png", kind, {"ocrContains": ["质量异议", paid]})

    path = out / f"{kind}-text.pdf"
    pdf = canvas.Canvas(str(path), pagesize=(595, 842), invariant=1)
    text_page(pdf, lines); pdf.showPage(); text_page(pdf, adverse); pdf.save()
    register(path, "application/pdf", kind, {"pages": 2, "contains": [total, "质量异议"]})

    path = out / f"{kind}-mixed.pdf"
    pdf = canvas.Canvas(str(path), pagesize=(595, 842), invariant=1)
    text_page(pdf, lines); pdf.showPage()
    pdf.drawImage(str(png), 20, 400, width=555, height=238); pdf.save()
    register(path, "application/pdf", kind, {"pages": 2, "pendingWithoutOcr": [2], "ocrContains": ["质量异议", paid]})

    path = out / f"{kind}-scan.pdf"
    pdf = canvas.Canvas(str(path), pagesize=(595, 842), invariant=1)
    pdf.drawImage(str(png), 20, 400, width=555, height=238); pdf.save()
    register(path, "application/pdf", kind, {"pages": 1, "pendingWithoutOcr": [1], "ocrContains": ["质量异议", paid]})

    path = out / f"{kind}-notes.docx"
    document = Document()
    document.add_paragraph(heading)
    document.add_paragraph("同一段前半\n\n同一段后半")
    document.add_paragraph(f"真实下一段：付款记录 {paid} 元，额外款项待补凭证。")
    document.save(path)
    register(path, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind,
             {"contains": ["同一段后半", paid], "locationKind": "TEXT"})

    path = out / f"{kind}-payments.xlsx"
    book = Workbook(); sheet = book.active; sheet.title = "付款记录"
    sheet.append([heading]); sheet.merge_cells("A1:C1")
    sheet.append(["付款日期", "金额", "凭证"])
    sheet.append(["2026-05-11", float(paid), "待人工核对"])
    sheet.append(["未核实金额", "=B3+5000", "公式无缓存，不能当作已计算结果"])
    book.save(path)
    register(path, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind,
             {"cell": {"sheet": "付款记录", "row": 3, "column": 2, "text": str(int(float(paid)))}, "unsupportedFormula": "B4"})

    path = out / f"{kind}-long.txt"
    path.write_text((heading + "\n同名主体需核对身份，金额尚未确认。\n") * 300 + "末尾反向材料：尚未签署验收单。", encoding="utf-8")
    register(path, "text/plain", kind, {"contains": ["末尾反向材料：尚未签署验收单。"]})

path = out / "corrupt.pdf"; path.write_bytes(b"%PDF-1.7\nSYNTHETIC_TRUNCATED")
register(path, "application/pdf", "negative", {"state": "FAILED"})
(out / "manifest.json").write_text(json.dumps({"provenance": "SYNTHETIC", "professionalReview": "PENDING", "documents": records}, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"generated": len(records), "manifest": str(out / "manifest.json")}, ensure_ascii=False))
