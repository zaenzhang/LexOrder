/** Validate this workflow's return address; never infer a case or rewrite its position. */
export function isMatterReturnHref(value: string, matter: { internalCode: string }): boolean {
  if (!matter.internalCode || value.length > 4096 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return false;
  const pathname = `/matters/${encodeURIComponent(matter.internalCode)}`;
  if (value.split(/[?#]/, 1)[0] !== pathname) return false;
  try {
    const target = new URL(value, "http://lexorder.invalid");
    return target.origin === "http://lexorder.invalid" && target.pathname === pathname && !target.searchParams.has("returnTo")
      && !target.searchParams.getAll("detail").includes("create") && !target.searchParams.getAll("action").includes("create");
  } catch { return false; }
}
