/** 只进入本次文书和上下文快照，不写回案件或客户源记录。 */
export const RENDER_ONLY_TEMPLATE_FIELDS = new Set([
  "execution.basis", "execution.basisNo", "execution.basisDate",
  "proceeding.caseNo", "proceeding.court"
]);
