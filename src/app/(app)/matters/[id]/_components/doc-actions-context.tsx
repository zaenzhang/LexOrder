"use client";

/**
 * 材料行的附加操作（AI 审查等）通过上下文下发，避免穿透多层工作区组件传参。
 * 未提供时 DocRow 不显示对应按钮（按配置与权限显示，不做假入口）。
 */
import { createContext, useContext } from "react";
import type { EvidenceItemRow } from "./evidence-panel";

export type DocActions = {
  onOpenDocument: (documentId: string) => void;
  onReview?: (documentId: string) => void;
  /** 材料行上的证据要点（按来源材料 id 分组） */
  evidenceByDoc?: Map<string, EvidenceItemRow[]>;
  /** 添加证据要点（docId 为 null 表示不挂材料） */
  onAddEvidence?: (documentId: string | null) => void;
};

export const DocActionsContext = createContext<DocActions | null>(null);
export function useDocActions() {
  const actions = useContext(DocActionsContext);
  if (!actions) throw new Error("材料操作须位于案件工作区内");
  return actions;
}
