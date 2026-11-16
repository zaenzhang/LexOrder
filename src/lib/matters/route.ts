/** 案件详情只使用创建时确定的实际 internalCode；编码一次，不改变编号。 */
export function matterHref(matter: { internalCode: string }, suffix = ""): string {
  return `/matters/${encodeURIComponent(matter.internalCode)}${suffix}`;
}
