import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { renderPageAsImage, getDocumentProxy, createIsomorphicCanvasFactory } from "unpdf";
import type { OcrInput } from "../../src/server/rag/parse-material";

const execute = promisify(execFile);
// Explicit Linux acceptance provider. Not silently bundled into either product.
export function localTesseract(tessdataDir: string, language = "chi_sim", pdfResources?: { cMapUrl: string; standardFontDataUrl: string }) {
  return async (input: OcrInput): Promise<string> => {
    const work = await mkdtemp(path.join(tmpdir(), "lexorder-ocr-"));
    try {
      let bytes = input.bytes;
      if (input.mimeType === "application/pdf") {
        const pdf = await getDocumentProxy(new Uint8Array(input.bytes), { ...pdfResources, cMapPacked: true,
          CanvasFactory: await createIsomorphicCanvasFactory(() => import("@napi-rs/canvas")) });
        try { bytes = new Uint8Array(await renderPageAsImage(pdf, input.page!, { scale: 3, canvasImport: () => import("@napi-rs/canvas") })); }
        finally { await pdf.destroy(); }
      }
      const filename = path.join(work, "page.png");
      await writeFile(filename, bytes);
      const result = await execute("tesseract", [filename, "stdout", "--tessdata-dir", tessdataDir, "-l", language, "--psm", "6"],
        { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
      return result.stdout.trim();
    } finally { await rm(work, { recursive: true, force: true }); }
  };
}
