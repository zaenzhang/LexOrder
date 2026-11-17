// @vitest-environment node
import { describe, expect, it } from "vitest";
import { materialFamilyRows } from "@/lib/documents/family-rows";

const at = new Date("2026-11-17T01:00:00Z");
function version(id: string, versionNumber: number, isLatest: boolean, extra: { familyId?: string | null; stageId?: string; source?: string; name?: string } = {}) {
  return { id, familyId: "family-a" as string | null, version: versionNumber, isLatest, createdAt: at,
    name: "合成同名材料.pdf", stageId: "stage-a", source: "委托人", ...extra };
}

describe("已授权、已限范围材料的版本族行", () => {
  it("真实当前版代表一族，保留原对象和版本集合，计数采用族行", () => {
    const old = version("old", 1, false), latest = version("latest", 2, true, { source: "本所" });
    const documents = [old, latest];
    const rows = materialFamilyRows(documents);
    expect(rows).toEqual([{ document: latest, versionCount: 2 }]);
    expect(rows[0].document).toBe(latest);
    expect(documents).toEqual([old, latest]);
    expect(rows.filter(row => row.document.source === "委托人")).toEqual([]);
  });

  it("仅获准历史版时仍保持历史身份，不提升为当前版", () => {
    const history = version("history", 2, false), earlier = version("earlier", 1, false);
    expect(materialFamilyRows([earlier, history])).toEqual([{ document: history, versionCount: 2 }]);
    expect(history.isLatest).toBe(false);
  });

  it("先按真实环节筛选；另一个环节的当前版不抹掉当前范围的历史入口", () => {
    const here = version("history-here", 1, false), elsewhere = version("latest-elsewhere", 2, true, { stageId: "stage-b" });
    const rows = materialFamilyRows([here, elsewhere].filter(document => document.stageId === "stage-a"));
    expect(rows).toEqual([{ document: here, versionCount: 1 }]);
  });

  it("null 族和同名不同族各自独立，不按名称或日期猜测关联", () => {
    const rows = materialFamilyRows([
      version("loose-a", 1, true, { familyId: null }), version("loose-b", 1, true, { familyId: null }),
      version("family-a-current", 1, true), version("family-b-current", 1, true, { familyId: "family-b" })
    ]);
    expect(rows.map(row => row.document.id)).toEqual(["loose-a", "loose-b", "family-a-current", "family-b-current"]);
    expect(rows.every(row => row.versionCount === 1)).toBe(true);
  });
});
