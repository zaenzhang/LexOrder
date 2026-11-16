"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Archive,
  BookOpen,
  CalendarClock,
  Check,
  CircleDollarSign,
  FileCheck2,
  FileText,
  FolderOpen,
  Gavel,
  Landmark,
  Lightbulb,
  ListChecks,
  Loader2,
  MessageSquare,
  PenLine,
  Plus,
  Scale,
  ScrollText,
  Shield,
  Stamp,
  StickyNote,
  Truck,
  Sparkles,
  Upload
} from "lucide-react";
import type {
  DeadlineCategory,
  DocumentCategory,
  DocumentSourceOrigin,
  GuaranteeType,
  LitigationStanding,
  PreservationStatus,
  PreservationType,
  ProcedureType
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { uploadDocument } from "@/server/documents/actions";
import { TaskWorkPanel } from "@/components/matters/task-work-panel";
import { updateDossierLocation, type DossierView, type WorkPane } from "@/lib/matters/dossier-location";
import { createProcedureStage, deleteProcedureMemo, ensureProcedureStage, removeProcedureStage, toggleDeadlineCompleted, toggleProcedureMemo } from "@/server/procedures/actions";
import { deleteExpress } from "@/server/express/actions";
import type { ExpressItem } from "./info-extras";
import { AddDeadlineDialog } from "./procedure-forms";
import { liftProperty } from "@/server/preservations/actions-v2";
import { cn, daysUntil, formatCurrency } from "@/lib/utils";
import { litigationStandingLabel, procedureTypeLabel } from "@/lib/enums";
import {
  defaultStageNamesForProcedure,
  normalizeProcedureStageName,
  procedureStagePresetsForProcedure,
  stagePresetForName,
  type StagePresetKind
} from "@/lib/procedure-stage-defaults";
import { canPreview, officePreviewKind } from "@/lib/storage/mime-ext";
import {
  PreservationCaseDialog,
  AddTargetDialog,
  AddPropertyDialog,
  RenewPropertyDialog
} from "@/app/(app)/preservation/_components/preservation-dialog";
import {
  GUARANTEE_TYPE_CN,
  PRES_STATUS_CN,
  PRES_STATUS_COLOR,
  PRES_TYPE_CN,
  PROPERTY_TYPE_CN,
  classifyExpiry,
  type MatterOption,
  type UserOption
} from "@/app/(app)/preservation/_components/preservation-types";
import { TemplatePickerDialog } from "./template-picker-dialog";
import { AdjustDeadlineDialog } from "./procedure-content";
import { confirmDeadline } from "@/server/deadlines/confirm";
import { DocIcon, EmptyState, SourceChip } from "@/components/patterns/moan";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { documentSourceChip } from "@/lib/ui/moan-tones";
import type { FolderPayload, TemplateSummary } from "./folder-types";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { useDocActions } from "./doc-actions-context";
import { EvidencePoints } from "./evidence-panel";
import { evidenceKindLabel } from "@/lib/enums";
import { shMonthDay, shMonthDayTime, shTime } from "@/lib/ui/sh-time";
import { actionErrorMessage } from "@/lib/action-error";

type WorkflowTask = {
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  completed: boolean;
  completedAt: Date | null;
  priority: number;
  stageId: string | null;
  assigneeId: string | null;
  responsibility: { state: "OPEN" | "DONE" | "CANCELLED"; closedAt: Date | null } | null;
};

type WorkflowStageSource = {
  id: string;
  name: string;
  description: string | null;
  order: number;
  status: "ACTIVE" | "HIDDEN";
  startedAt: Date | null;
  completedAt: Date | null;
  tasks: WorkflowTask[];
};

type WorkflowDeadline = {
  id: string;
  title: string;
  category: DeadlineCategory;
  dueAt: Date;
  basis: string | null;
  remindDays: number;
  completed: boolean;
  confirmStatus?: "PENDING" | "CONFIRMED" | "ADJUSTED";
};

type WorkflowHearing = {
  id: string;
  title: string;
  room: string | null;
  address: string | null;
  startsAt: Date;
};

type WorkflowProcedure = {
  id: string;
  type: ProcedureType;
  customLabel: string | null;
  caseNumber: string | null;
  acceptedAt: Date | null;
  concludedAt: Date | null;
  status: "PENDING" | "IN_PROGRESS" | "CONCLUDED";
  stages: WorkflowStageSource[];
  deadlines: WorkflowDeadline[];
  hearings: WorkflowHearing[];
  memos?: { id: string; content: string; done: boolean; doneAt: Date | null; createdAt: Date }[];
  procedureParties: {
    id: string;
    standing: LitigationStanding;
    ordinal: number;
    party: { id: string; name: string };
  }[];
};

type WorkflowDocument = {
  id: string;
  name: string;
  category: DocumentCategory;
  mimeType: string | null;
  size: number | null;
  createdAt: Date;
  sourceParty: string | null;
  tags: string[];
  stageId: string | null;
  procedureId: string | null;
  sourceOrigin: DocumentSourceOrigin | null;
  ocrStatus: "PENDING" | "READY" | "PARTIAL" | "FAILED" | "SKIP" | null;
  textSource: "DOCX" | "PDF_TEXT" | "OCR" | "MANUAL" | null;
  pageCount: number | null;
  sha256: string | null;
  templateId: string | null;
  version: number | null;
};

type WorkflowMatter = {
  id: string;
  internalCode: string;
  title: string;
  category: string;
};

export type WorkflowPreservationCase = {
  id: string;
  matterId: string | null;
  type: PreservationType;
  status: PreservationStatus;
  court: string | null;
  rulingNumber: string | null;
  guaranteeType: GuaranteeType | null;
  appliedAt: Date | null;
  note: string | null;
  ownerId: string | null;
  remindDays: number[];
  createdAt: Date;
  updatedAt: Date;
  matter: { id: string; internalCode: string; title: string } | null;
  owner: { id: string; name: string } | null;
  targets: {
    id: string;
    caseId: string;
    name: string;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    properties: {
      id: string;
      targetId: string;
      propertyType: keyof typeof PROPERTY_TYPE_CN;
      propertyDetail: string | null;
      amount: number | null;
      startDate: Date;
      duration: number;
      expiryDate: Date;
      status: PreservationStatus;
      createdAt: Date;
      updatedAt: Date;
      renewals: {
        id: string;
        propertyId: string;
        renewedAt: Date;
        oldExpiryDate: Date;
        newExpiryDate: Date;
        renewalDuration: number;
        note: string | null;
        performedById: string;
        createdAt: Date;
      }[];
    }[];
  }[];
};

type WorkflowStageStatus = "done" | "active" | "risk" | "todo" | "not_applicable";

type WorkflowStage = {
  key: string;
  id: string | null;
  name: string;
  kind: "normal" | "preservation";
  presetKind: StagePresetKind | "custom";
  removable: boolean;
  status: WorkflowStageStatus;
  tasks: WorkflowTask[];
  /** v1.1 UI（方案 E）：导航徽标——任务数 / 临期倒计时 / 开庭日期 */
  badge: { text: string; hot: boolean } | null;
};

type WorkflowItem = WorkflowStage;

type StageGuide = {
  summary: string;
  checklistTitle: string;
  checklist: string[];
  actions: string[];
  deadlineCategories: DeadlineCategory[];
  includeHearings?: boolean;
  materialCategories: DocumentCategory[];
  materialPattern: RegExp;
  defaultCategory: DocumentCategory;
};


const PRESERVATION_ACTIONS = [
  "财产保全申请书",
  "财产线索清单",
  "担保书/保函",
  "网络查控申请书",
  "保全费缴费凭证",
  "续封申请书",
  "解除保全申请书",
  "保全复议申请书"
];

const DEFAULT_STAGE_GUIDE: StageGuide = {
  summary: "记录本环节的任务、文件和沟通结果，作为当前程序的工作留痕。",
  checklistTitle: "本环节事项",
  checklist: ["明确本环节目标和交付物", "记录当事人或法院沟通要点", "归集本环节形成的材料"],
  actions: ["工作底稿", "补充说明"],
  deadlineCategories: [],
  materialCategories: [],
  materialPattern: /阶段|说明|记录|底稿|工作/,
  defaultCategory: "PROCEDURE"
};

const STAGE_GUIDES: { keys: string[]; guide: StageGuide }[] = [
  {
    keys: ["代理授权", "委托手续"],
    guide: {
      summary: "办理代理合同、授权文件、律所手续、风险告知、费用到账和材料交接留痕。",
      checklistTitle: "委托手续",
      checklist: [
        "核对委托人身份和签章主体",
        "签署委托代理合同、授权委托书、所函",
        "完成风险告知、工作联系函和材料交接留痕",
        "确认律师费到账、发票和原件移交记录"
      ],
      actions: ["委托代理合同", "授权委托书", "律所函", "风险告知书", "工作联系函", "证据原件交接单"],
      deadlineCategories: [],
      materialCategories: ["CONTRACT"],
      materialPattern: /授权|委托|所函|律所函|风险告知|联系函|发票|签收|交接/,
      defaultCategory: "CONTRACT"
    }
  },
  {
    keys: ["财产保全"],
    guide: {
      summary: "围绕保全申请、担保、缴费、裁定、续封和解除组织材料。",
      checklistTitle: "保全事项",
      checklist: [
        "确认保全范围、财产线索和担保方式",
        "提交保全申请、担保书/保函和财产线索",
        "跟进缴费、裁定、查封冻结结果和首封情况",
        "记录保全期限并提前安排续保或解除"
      ],
      actions: PRESERVATION_ACTIONS,
      deadlineCategories: ["PRESERVATION"],
      materialCategories: [],
      materialPattern: /保全|财产线索|担保|保函|查封|冻结|续封|续保|解除|裁定|协助执行/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["案情研判", "材料消化", "诉讼方案", "二审阅卷研判"],
    guide: {
      summary: "消化基础材料，形成事实摘要、证据缺口、法律检索和诉讼代理方案。",
      checklistTitle: "研判事项",
      checklist: [
        "梳理案件事实、法律关系、争议焦点",
        "核对证据原件或扫描件，列出缺漏清单",
        "完成法律法规、案例和司法观点检索",
        "向当事人确认关键事实和诉讼方案"
      ],
      actions: ["案件事实摘要", "法律关系图", "证据缺口清单", "法律检索报告", "诉讼代理方案"],
      deadlineCategories: [],
      materialCategories: [],
      materialPattern: /摘要|法律关系|检索|方案|证据缺口|材料清单|事实梳理/,
      defaultCategory: "OTHER"
    }
  },
  {
    keys: ["执行立案"],
    guide: {
      summary: "准备强制执行申请材料，确认生效、履行期限和执行法院立案要求。",
      checklistTitle: "执行立案事项",
      checklist: [
        "确认裁判文书已生效且履行期限届满",
        "准备强制执行申请书、生效文书和身份材料",
        "补齐申请人账户确认书、送达地址确认书和委托手续",
        "立案后一周内跟进承办法官联系方式"
      ],
      actions: ["强制执行申请书", "生效证明", "申请人账号确认书", "送达地址确认书", "执行立案材料清单"],
      deadlineCategories: ["PERFORMANCE", "ENFORCEMENT"],
      materialCategories: [],
      materialPattern: /执行申请|强制执行|生效|履行|账号确认|送达地址/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["起诉立案", "仲裁立案"],
    guide: {
      summary: "完成起诉或仲裁申请材料、主体身份、管辖依据、证据目录、缴费和诉调跟进。",
      checklistTitle: "立案事项",
      checklist: [
        "确认请求标的、管辖法院或仲裁机构",
        "整理起诉状/仲裁申请、身份材料、授权手续和证据目录",
        "核对被告身份、送达信息、管辖材料和保全材料",
        "跟进立案审查、诉调转立案和诉讼费/仲裁费缴纳"
      ],
      actions: ["民事起诉状", "仲裁申请书", "证据目录", "送达地址确认书", "诉讼费缴费凭证", "立案材料清单"],
      deadlineCategories: ["LIMITATION"],
      materialCategories: [],
      materialPattern: /起诉|仲裁申请|立案|证据目录|送达地址|诉讼费|仲裁费|管辖材料/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["管辖异议", "管辖权异议"],
    guide: {
      summary: "处理对方管辖异议、答辩、裁定签收和异议上诉/答辩衔接。",
      checklistTitle: "管辖事项",
      checklist: [
        "签收并研判对方管辖权异议理由",
        "提交管辖权异议答辩意见及证据",
        "跟进裁定结果并告知当事人",
        "在上诉期内处理异议上诉或二审答辩"
      ],
      actions: ["管辖权异议答辩意见", "管辖权异议申请书", "管辖异议上诉状", "管辖异议裁定签收记录"],
      deadlineCategories: ["APPEAL", "RESPONSE"],
      materialCategories: [],
      materialPattern: /管辖|异议|移送|裁定|上诉/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["举证质证"],
    guide: {
      summary: "围绕举证期限、补充证据、调查令、鉴定、证人出庭和对方证据质证组织工作。",
      checklistTitle: "举证事项",
      checklist: [
        "记录举证通知签收日并计算举证期限",
        "复核全案材料，确认补充证据和反驳证据",
        "评估调查令、法院调查取证、鉴定和证人出庭申请",
        "收到对方证据后与当事人核实真实性并形成质证意见"
      ],
      actions: ["证据目录", "补充证据清单", "质证意见", "调查取证申请书", "证人出庭申请书"],
      deadlineCategories: ["EVIDENCE"],
      materialCategories: ["EVIDENCE"],
      materialPattern: /证据|举证|质证|调查令|调查取证|证人|反驳证据/,
      defaultCategory: "EVIDENCE"
    }
  },
  {
    keys: ["鉴定申请", "司法鉴定"],
    guide: {
      summary: "判断是否申请鉴定、提出鉴定事项、异议、补充材料和专家辅助人安排。",
      checklistTitle: "鉴定事项",
      checklist: [
        "确认鉴定必要性、鉴定事项和证明目的",
        "准备鉴定申请、样本材料和费用沟通",
        "处理鉴定机构、鉴定材料和鉴定意见异议",
        "需要时安排专家辅助人出庭"
      ],
      actions: ["鉴定申请书", "鉴定材料清单", "鉴定异议书", "专家辅助人出庭申请书"],
      deadlineCategories: ["EVIDENCE"],
      materialCategories: [],
      materialPattern: /鉴定|专家|辅助人|样本|检材/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["庭前会议"],
    guide: {
      summary: "处理庭前会议通知、争点归纳、证据交换、程序事项和庭审安排。",
      checklistTitle: "庭前会议事项",
      checklist: [
        "确认庭前会议时间、地点、参加人员和会议目的",
        "准备争议焦点、证据交换意见和程序性申请",
        "记录法院或仲裁庭确认的审理范围和举证安排",
        "根据会议结果修订庭审提纲和证据组织方案"
      ],
      actions: ["庭前会议提纲", "争议焦点清单", "证据交换意见", "程序事项申请书", "庭前会议记录"],
      deadlineCategories: ["EVIDENCE", "CUSTOM"],
      includeHearings: true,
      materialCategories: [],
      materialPattern: /庭前会议|争议焦点|证据交换|程序事项|会议记录/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["模拟法庭"],
    guide: {
      summary: "围绕庭审争点、发问路径、攻防预案和客户出庭表现做正式开庭前演练。",
      checklistTitle: "模拟事项",
      checklist: [
        "形成争点清单和证明责任分配表",
        "准备我方发问、反问和对方可能追问清单",
        "演练法庭调查、法庭辩论和最后陈述",
        "记录演练暴露的问题并修订庭审提纲"
      ],
      actions: ["模拟法庭脚本", "争点攻防清单", "发问提纲", "客户庭前沟通记录", "庭审风险提示"],
      deadlineCategories: [],
      materialCategories: [],
      materialPattern: /模拟法庭|攻防|发问|反问|演练|庭审风险|庭前沟通/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["开庭准备", "开庭/询问", "开庭审理"],
    guide: {
      summary: "围绕开庭通知、证据原件、庭审提纲、质证意见、发问提纲和客户庭前沟通做准备。",
      checklistTitle: "庭前事项",
      checklist: [
        "确认开庭时间、地点、法庭和书记员联系方式",
        "核对证据原件、对方证据和是否变更诉请",
        "准备庭审提纲、发问提纲、质证意见和代理词提纲",
        "向当事人交代出庭材料、庭审流程和注意事项"
      ],
      actions: ["庭审提纲", "发问提纲", "质证意见", "代理词提纲", "庭前沟通记录"],
      deadlineCategories: [],
      includeHearings: true,
      materialCategories: [],
      materialPattern: /开庭|庭审|传票|发问|提纲|质证|原件|代理词/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["庭后工作", "庭后代理词", "庭后补充"],
    guide: {
      summary: "庭后复盘并提交代理意见、补充材料，向客户汇报并持续跟进裁判进度。",
      checklistTitle: "庭后事项",
      checklist: [
        "庭后向当事人汇报庭审情况并留痕",
        "提交代理词、质证意见、法律检索报告或补充意见",
        "按庭审要求核实事实、补交材料或移交证据原件",
        "联系法官或书记员跟进裁判进度"
      ],
      actions: ["开庭报告", "代理词", "庭后补充意见", "书面质证意见", "法律检索报告"],
      deadlineCategories: ["EVIDENCE", "CUSTOM"],
      materialCategories: [],
      materialPattern: /代理词|庭后|补充意见|开庭报告|质证意见|检索报告|笔录/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["裁判/上诉", "裁判签收", "二审裁判", "仲裁裁决", "执行结案"],
    guide: {
      summary: "签收裁判或裁决文书，计算上诉期/履行期，处理生效、退费、履行和后续程序提示。",
      checklistTitle: "裁判事项",
      checklist: [
        "记录裁判文书签收日并计算上诉期或撤裁期限",
        "向当事人汇报裁判结果并确认是否上诉、撤裁或履行",
        "处理文书更正、生效证明、诉讼费退费和保全解除",
        "跟进对方履行并提示需要另行新建执行程序的情形"
      ],
      actions: ["裁判结果报告", "上诉期告知函", "结案报告", "生效证明申请", "履行衔接清单"],
      deadlineCategories: ["APPEAL", "PERFORMANCE", "ARBITRATION_SET_ASIDE", "ENFORCEMENT"],
      materialCategories: ["JUDGMENT"],
      materialPattern: /判决|裁定|裁决|调解书|上诉|生效|履行|退费|结案|后续程序/,
      defaultCategory: "JUDGMENT"
    }
  },
  {
    keys: ["案件归档"],
    guide: {
      summary: "完成结案报告、材料完整性核对、原件退还、费用结清和归档申请。",
      checklistTitle: "归档事项",
      checklist: [
        "确认裁判、裁决、调解或执行结果已形成最终留痕",
        "核对委托手续、程序材料、证据材料和往来记录是否完整",
        "完成结案报告、客户交接、原件退还和费用结清",
        "提交归档申请并处理补正意见"
      ],
      actions: ["结案报告", "归档材料清单", "原件退还确认书", "客户结案告知函", "归档申请"],
      deadlineCategories: [],
      materialCategories: ["PROCEDURE", "JUDGMENT"],
      materialPattern: /归档|结案报告|原件退还|材料清单|结案告知|费用结清/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["上诉/应诉"],
    guide: {
      summary: "围绕上诉、二审应诉、补充证据、上诉费和二审庭询安排组织材料。",
      checklistTitle: "二审事项",
      checklist: [
        "签订二审委托手续并确认上诉期限",
        "递交上诉状或二审答辩意见、证据材料",
        "提醒并核对上诉费缴纳",
        "梳理一审裁判争点和二审代理思路"
      ],
      actions: ["上诉状", "二审答辩状", "二审证据目录", "上诉费缴费凭证", "二审代理方案"],
      deadlineCategories: ["APPEAL", "RESPONSE", "EVIDENCE"],
      materialCategories: [],
      materialPattern: /上诉|二审|答辩|一审判决|裁定|上诉费|代理方案/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["财产查控"],
    guide: {
      summary: "梳理并提交被执行人财产线索，跟进网络查控、处置方案和续保。",
      checklistTitle: "查控事项",
      checklist: [
        "梳理房产、车辆、银行账户、股权等财产线索",
        "向执行法官提交财产线索和查控申请",
        "跟进查封、冻结、扣押和评估拍卖进度",
        "执行周期较长时同步检查已保全财产续保"
      ],
      actions: ["财产线索清单", "网络查控申请书", "追加被执行人申请书", "续封申请书"],
      deadlineCategories: ["ENFORCEMENT", "PRESERVATION"],
      materialCategories: [],
      materialPattern: /查控|财产线索|冻结|查封|扣押|拍卖|追加被执行人|续封/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["异议/复议"],
    guide: {
      summary: "处理执行异议、复议、不予执行或案外人异议相关材料和期限。",
      checklistTitle: "异议事项",
      checklist: [
        "确认异议主体、异议对象和法定期限",
        "准备执行异议申请或复议申请及证据",
        "跟进听证、裁定和后续异议之诉衔接",
        "向当事人汇报风险和下一步策略"
      ],
      actions: ["执行异议申请书", "复议申请书", "不予执行申请书", "听证提纲"],
      deadlineCategories: ["ENFORCEMENT", "CUSTOM"],
      materialCategories: [],
      materialPattern: /执行异议|复议|不予执行|案外人|听证|异议之诉/,
      defaultCategory: "PLEADING"
    }
  },
  {
    keys: ["执行和解"],
    guide: {
      summary: "推动执行和解方案、客户确认、协议签署、履行监督和恢复执行预案。",
      checklistTitle: "和解事项",
      checklist: [
        "核实对方履行能力和和解条件",
        "形成和解方案并取得客户书面确认",
        "签署执行和解协议并提交法院备案",
        "跟进分期履行、违约处理和恢复执行"
      ],
      actions: ["执行和解方案", "调解/和解方案确认函", "执行和解协议", "恢复执行申请书"],
      deadlineCategories: ["PERFORMANCE", "ENFORCEMENT"],
      materialCategories: [],
      materialPattern: /和解|调解|履行计划|恢复执行|确认函/,
      defaultCategory: "PROCEDURE"
    }
  },
  {
    keys: ["会见", "取保候审", "阅卷线索", "辩护意见"],
    guide: {
      summary: "刑事程序内按会见、取保、阅卷、线索核实和辩护意见组织工作。",
      checklistTitle: "刑事事项",
      checklist: [
        "核对委托手续、会见手续和办案机关要求",
        "记录会见情况、阅卷要点和补充线索",
        "评估取保候审、羁押必要性和证据风险",
        "形成书面辩护意见或法律意见"
      ],
      actions: ["会见笔录", "取保候审申请书", "阅卷笔录", "辩护意见", "法律意见书"],
      deadlineCategories: ["CUSTOM"],
      materialCategories: [],
      materialPattern: /会见|取保|阅卷|辩护|羁押|法律意见/,
      defaultCategory: "PROCEDURE"
    }
  }
];

const DOCUMENT_CATEGORY_OPTIONS: DocumentCategory[] = [
  "CONTRACT",
  "PLEADING",
  "EVIDENCE",
  "PROCEDURE",
  "JUDGMENT",
  "OTHER"
];
const SOURCE_MATERIAL_CATEGORIES: DocumentCategory[] = ["PLEADING", "EVIDENCE"];
const COURT_PROCEDURE_SOURCE = "法院程序文件";

export type WorkflowNote = {
  id: string;
  channel: string;
  withWhom: string | null;
  occurredAt: Date;
  content: string;
  tags: string[];
  author: { id: string; name: string };
};

export type WorkflowTimelineEvent = {
  id: string;
  eventType: string;
  title: string;
  content: string | null;
  occurredAt: Date;
};

/** 研判笔记标记（Note.tags）：人工判断内容，与事务记录分开陈列 */
export const JUDGMENT_NOTE_TAG = "研判笔记";
export const stageNoteTag = (stageName: string) => `环节:${stageName}`;

export type WorkflowApi = {
  /** 从外部（页头「上传材料」）打开当前环节的上传 */
  openUpload: () => void;
  /** 从「登记进展」打开当前环节的添加任务 */
  openAddTask: () => void;
  /** 当前可归档环节名（研判笔记归档用） */
  stageNames: string[];
  currentStageName: string | null;
};

/** 待办「等待他人」：审批中的用印、归档等 */
export type WaitingItem = { key: string; title: string; meta: string; onOpen?: () => void };

/**
 * 案卷工作台（程序栏之下）：页签 → 各视图。
 * - 案件档案：案件页注入的档案主栏 + 侧栏（承办团队 + 最近待办 / 最近记录）
 * - 办案与材料：共同的环节上下文 + 材料与要点 / 事项与期限 / 办理记录
 * - 委托与财务、审批用印：案件页注入
 * 同一份数据只在一处展示：未完成事项只在待办，已发生事项只在经办记录，材料与证据链只在办案进程。
 */
export function ProcedureWorkflowPanel({
  matter,
  procedure,
  documents,
  folders,
  templates,
  users,
  canManage,
  canWriteRecords,
  notes,
  timelineEvents,
  onWriteNote,
  apiRef,
  view,
  onViewChange,
  viewCounts,
  archiveNode, responsibilityNode,
  archiveRailTop,
  expresses,
  onAddLedger,
  materialsActions,
  materialsExtra,
  factsNode,
  deliveryNode,
  canWriteTasks,
  canWriteMaterials,
  canReadSchedule,
  allProcedures,
  invalidProcedure = false,
  onCaseSearch,
  financeNode,
  sealNode,
  waiting
}: {
  matter: WorkflowMatter;
  procedure: WorkflowProcedure | null;
  documents: WorkflowDocument[];
  folders: FolderPayload[];
  templates: TemplateSummary[];
  users: UserOption[];
  canManage: boolean;
  canWriteRecords: boolean;
  notes: WorkflowNote[];
  timelineEvents: WorkflowTimelineEvent[];
  onWriteNote: (opts: { judgment: boolean; stageName?: string }) => void;
  apiRef?: React.MutableRefObject<WorkflowApi | null>;
  view: DossierView;
  onViewChange: (view: DossierView) => void;
  viewCounts?: Partial<Record<DossierView, number>>;
  archiveNode: React.ReactNode;
  responsibilityNode?: React.ReactNode;
  /** 案件档案侧栏顶部（承办团队） */
  archiveRailTop?: React.ReactNode;
  /** 快递记录（并入经办记录） */
  expresses?: ExpressItem[];
  /** 「＋记录」中的快递、「＋事项」中的开庭（沿用重要事项弹窗） */
  onAddLedger?: (type: "express" | "hearing" | "deadline") => void;
  /** 类案检索入口（元典已配置时） */
  onCaseSearch?: () => void;
  /** 当前材料工作区的工具入口及恢复提示。 */
  materialsActions?: React.ReactNode;
  /** 材料工作区的补充内容（AI 审查总览）。 */
  materialsExtra?: React.ReactNode;
  factsNode?: React.ReactNode;
  deliveryNode?: React.ReactNode;
  canWriteTasks: boolean;
  canWriteMaterials: boolean;
  canReadSchedule: boolean;
  allProcedures: WorkflowProcedure[];
  invalidProcedure?: boolean;
  financeNode?: React.ReactNode;
  sealNode?: React.ReactNode;
  waiting?: WaitingItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPane = searchParams.get("workPane");
  const workPane: WorkPane | null = requestedPane === null ? "materials" : ["materials", "facts", "tasks", "records"].includes(requestedPane) ? requestedPane as WorkPane : null;
  const recordsExpanded = searchParams.get("recordsExpanded") === "1";
  const recordsPane = searchParams.get("recordsView") === "delivery" || searchParams.get("delivery") || searchParams.get("deliveryDocument") ? "delivery" : "activity";
  const [visitedDelivery, setVisitedDelivery] = useState(view === "work" && workPane === "records" && recordsPane === "delivery");
  const [createTaskRequest, setCreateTaskRequest] = useState(0);
  const [createTaskStage, setCreateTaskStage] = useState<{ id: string; name: string } | null>(null);
  const [tasksVisited, setTasksVisited] = useState(view === "work" && workPane === "tasks");
  const [visitedWorkMatterId, setVisitedWorkMatterId] = useState<string | null>(view === "work" ? matter.id : null);
  const [expandRequest, setExpandRequest] = useState(0);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [stageCreateTarget, setStageCreateTarget] = useState<{ procedure: WorkflowProcedure; stages: WorkflowStage[]; selected: WorkflowStage | null; location: string } | null>(null);
  const [deadlineTarget, setDeadlineTarget] = useState<WorkflowProcedure | null>(null);
  const [stageActivationPending, startStageActivation] = useTransition();
  const [uploadSignal, setUploadSignal] = useState(0);
  const pendingWorkFocus = useRef<"tasks" | "records" | null>(null);
  const actionSectionRef = useRef<HTMLDivElement>(null);
  const recordSectionRef = useRef<HTMLElement>(null);
  const [, startStageRemovalTransition] = useTransition();

  useEffect(() => {
    if (view === "work") setVisitedWorkMatterId(matter.id);
    if (view === "work" && workPane === "tasks") setTasksVisited(true);
    if (view === "work" && workPane === "records" && recordsPane === "delivery") setVisitedDelivery(true);
  }, [view, matter.id, workPane, recordsPane]);

  const stages = useMemo(() => buildWorkflowStages(procedure), [procedure]);
  const requestedStage = searchParams.get("stage");
  const unassignedOnly = requestedStage === "unassigned";
  const selectedKey = stages.some(stage => stage.key === requestedStage) ? requestedStage : null;
  const setSelectedKey = (stage: string | null) => updateDossierLocation({ stage, task: null });
  const invalidStage = requestedStage !== null && !unassignedOnly && selectedKey === null;
  const selectedStage = requestedStage !== null ? stages.find(stage => stage.key === requestedStage) ?? null : null;
  const effectiveScope: "all" | "stage" = selectedStage ? "stage" : "all";
  const actions = useMemo(() => (procedure ? [procedure] : allProcedures).flatMap(item => buildActionItems(item)), [procedure, allProcedures]);
  const logItems = useMemo(() => buildLogItems({ procedures: allProcedures, notes, events: timelineEvents, users, expresses: expresses ?? [] }), [allProcedures, notes, timelineEvents, users, expresses]);

  useEffect(() => {
    if (view !== "work" || !pendingWorkFocus.current) return;
    const section = pendingWorkFocus.current === "tasks" ? actionSectionRef.current : recordSectionRef.current;
    if (!section) return;
    pendingWorkFocus.current = null;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start", behavior: "auto" });
  }, [view, workPane, expandRequest]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      openUpload: () => {
        if (invalidStage || invalidProcedure) {
          toast.error("请先重新选择有效程序和环节");
          return;
        }
        setUploadSignal((n) => n + 1);
      },
      openAddTask: () => {
        setCreateTaskStage(null);
        updateDossierLocation({ view: "work", workPane: "tasks" });
        setCreateTaskRequest(value => value + 1);
      },
      stageNames: stages.map((st) => st.name),
      currentStageName: selectedStage?.name ?? null
    };
  }, [apiRef, selectedStage, stages, invalidStage, invalidProcedure]);

  function selectStage(key: string | null) {
    pendingWorkFocus.current = null;
    setSelectedKey(key);
  }

  function openWorkSection(section: "tasks" | "records") {
    pendingWorkFocus.current = section;
    setExpandRequest(value => value + 1);
    updateDossierLocation({ view: "work", workPane: section, ...(section === "records" ? { recordsExpanded: "1" } : {}) });
    onViewChange("work");
  }

  function selectWorkSection(value: string) {
    if (value !== "materials" && value !== "facts" && value !== "tasks" && value !== "records") return;
    pendingWorkFocus.current = null;
    updateDossierLocation({ workPane: value });
  }

  function selectView(next: DossierView) {
    pendingWorkFocus.current = null;
    onViewChange(next);
  }

  async function handleRemoveStage(stage: WorkflowStage) {
    const stageId = stage.id;
    if (!stageId) {
      toast.info("该环节尚未写入流程，无需移除");
      return;
    }
    if (!stage.removable) {
      toast.warning("必备环节不能移除");
      return;
    }
    const location = window.location.pathname + window.location.search;
    if (!(await confirmDialog({ title: `移除环节「${stage.name}」？`, description: "已有任务或材料的环节将被隐藏（数据保留，重新添加同名环节可恢复）。", confirmText: "移除", danger: true }))) return;
    startStageRemovalTransition(async () => {
      try {
        const res = await removeProcedureStage({ id: stageId });
        toast.success(res.hidden ? "环节已隐藏，数据保留（重新添加同名环节可恢复）" : "环节已移除");
        if (window.location.pathname + window.location.search === location) setSelectedKey(null);
        router.refresh();
      } catch (err) {
        toast.error("移除失败", { description: actionErrorMessage(err) });
      }
    });
  }


  const VIEWS: { key: DossierView; label: string; show: boolean; icon: typeof FileText; count?: number; hot?: boolean }[] = [
    { key: "archive", label: "档案与摘要", show: true, icon: FileText },
    { key: "work", label: "办案与材料", show: true, icon: ListChecks },
    { key: "money", label: "委托与财务", show: Boolean(financeNode), icon: CircleDollarSign },
    { key: "seal", label: "审批用印", show: Boolean(sealNode), icon: Stamp, count: viewCounts?.seal }
  ];

  return (
    <>
      <div className="dos-views" role="tablist" aria-label="案件视图">
        {VIEWS.filter((v) => v.show).map((v) => {
          const Icon = v.icon;
          return (
            <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={cn("dos-view", view === v.key && "on")} onClick={() => selectView(v.key)}>
              <Icon strokeWidth={1.9} />
              {v.label}
              {v.count ? <span className={cn("n", v.hot && "hot")}>{v.count}</span> : null}
            </button>
          );
        })}
      </div>

      {/* 团队信息常驻；工作区按业务切换，其余视图保留待办与记录摘要。 */}
      <div className="dos-work">
        <div className="dos-main">
      {view === "archive" ? archiveNode : null}

      {view === "work" || visitedWorkMatterId === matter.id ? (
        <div hidden={view !== "work"} className="min-w-0">
        {invalidStage ? <p role="alert" className="mb-3 text-sm text-destructive">指定环节不可用。<Button variant="link" onClick={() => setSelectedKey(null)}>重新选择环节</Button></p> : null}
        <div className={workPane === "materials" || workPane === "tasks" ? "dos-flow" : "min-w-0"}>
          {workPane === "materials" || workPane === "tasks" ? <StageLine
            procedure={procedure}
            stages={stages}
            selectedKey={unassignedOnly ? "unassigned" : selectedStage?.key ?? null}
            onSelect={selectStage}
            onAddStage={canWriteTasks && procedure ? () => setStageCreateTarget({ procedure, stages, selected: selectedStage, location: window.location.pathname + window.location.search }) : undefined}
          /> : null}
          <div className="dos-main">
          {(workPane === "materials" || workPane === "tasks") && selectedStage && procedure && effectiveScope === "stage" ? (
            <>
            <StageBar
              stage={selectedStage}
              procedure={procedure}
              documents={documents}
              canManage={Boolean(canWriteTasks)}
              onRemoveStage={canWriteTasks && selectedStage.removable ? () => handleRemoveStage(selectedStage) : undefined}
            />
            {selectedStage.id && canWriteTasks && !invalidStage && !invalidProcedure ? <Button size="sm" variant="outline" onClick={() => {
              setCreateTaskStage({ id: selectedStage.id!, name: selectedStage.name });
              setCreateTaskRequest(value => value + 1);
              updateDossierLocation({ view: "work", workPane: "tasks" });
              onViewChange("work");
            }}>为此环节新建任务</Button> : null}
            {!selectedStage.id && canManage && canWriteTasks && !invalidStage && !invalidProcedure ? <Button size="sm" variant="outline" disabled={stageActivationPending} onClick={() => {
              startStageActivation(async () => {
                try {
                  const location = window.location.pathname + window.location.search;
                  const result = await ensureProcedureStage({ procedureId: procedure.id, name: selectedStage.name, description: "", insertPosition: "END" });
                  if (window.location.pathname + window.location.search === location) setSelectedKey(`stage-${result.id}`);
                  router.refresh();
                } catch (error) {
                  toast.error("启用环节失败", { description: actionErrorMessage(error) });
                }
              });
            }}>{stageActivationPending ? "正在启用…" : "启用此环节"}</Button> : null}
            </>
          ) : null}
          <Tabs value={workPane ?? "unavailable"} onValueChange={selectWorkSection}>
            <TabsList aria-label="办案工作区" className="grid h-auto w-full grid-cols-4 gap-1">
              <TabsTrigger value="materials">材料</TabsTrigger>
              <TabsTrigger value="facts">事实与来源</TabsTrigger>
              <TabsTrigger value="tasks">待办</TabsTrigger>
              <TabsTrigger value="records">办理记录</TabsTrigger>
            </TabsList>
            <TabsContent value="materials" forceMount hidden={workPane !== "materials"} className="data-[state=inactive]:hidden">
              <div className="flex flex-col gap-4">
                {!invalidStage && !invalidProcedure ? <>{materialsActions}
                <MaterialsSection
                  matterId={matter.id}
                  procedure={procedure}
                  documents={documents}
                  stage={effectiveScope === "stage" ? selectedStage : null}
                  unassignedOnly={unassignedOnly}
                  canManage={canWriteMaterials}
                  onOpenTemplate={() => setTemplateOpen(true)}
                  onRequestUpload={() => setUploadSignal(value => value + 1)}
                />
                {materialsExtra}</> : null}
              </div>
            </TabsContent>
            {!workPane ? <p role="alert" className="py-4 text-sm text-destructive">指定工作区不可用，请选择上方工作区。</p> : null}
            <TabsContent value="facts" forceMount hidden={workPane !== "facts"} className="data-[state=inactive]:hidden">{factsNode}</TabsContent>
            <TabsContent value="tasks" forceMount hidden={workPane !== "tasks"} className="data-[state=inactive]:hidden">
              <div ref={actionSectionRef} tabIndex={-1} className="flex scroll-mt-44 flex-col gap-4" role="region" aria-label="待办">
                {procedure && selectedStage && !selectedStage.id && !invalidStage && !invalidProcedure && <p className="text-sm text-muted-foreground">此环节尚未启用，请在材料区启用后再添加环节任务。</p>}
                {!canReadSchedule ? <p className="text-sm text-muted-foreground">无日程查看权限</p> : <p className="text-sm text-muted-foreground">{unassignedOnly ? "事项级任务 · 未关联程序或环节" : selectedStage ? `环节任务 · ${selectedStage.name}` : procedure ? "本程序任务 · 全部真实环节" : "全案任务"}</p>}
                {canReadSchedule && (tasksVisited || view === "work" && workPane === "tasks") ? <TaskWorkPanel
                  matterId={matter.id}
                  canWrite={canWriteTasks && !invalidStage && !invalidProcedure && (!procedure || !selectedStage || Boolean(selectedStage.id))}
                  createRequest={createTaskRequest}
                  createStage={createTaskStage}
                  defaultStage={selectedStage?.id && effectiveScope === "stage" ? { id: selectedStage.id, name: selectedStage.name } : null}
                  scopeStageIds={invalidStage || invalidProcedure ? [] : unassignedOnly || !procedure ? null : effectiveScope === "stage" ? (selectedStage?.id ? [selectedStage.id] : []) : procedure.stages.map(stage => stage.id)}
                  unassignedOnly={unassignedOnly}
                  selectedTaskId={searchParams.get("task")}
                  onTaskSelect={(task, mode) => updateDossierLocation({ ...(task ? { view: "work", workPane: "tasks" } : {}), task }, mode)}
                  onTaskCreated={task => updateDossierLocation({ view: "work", workPane: "tasks", procedure: null, stage: null, task })}
                /> : null}
                {canReadSchedule ? <NextActions
                  initiallyExpanded
                  expandRequest={expandRequest}
                  actions={actions}
                  selectedStage={selectedStage}
                  scope="all"
                  allScopeLabel={procedure ? `${procedure.customLabel ?? procedureTypeLabel[procedure.type]} · 程序级日程` : "全案日程 · 各程序"}
                  canManage={Boolean(canWriteTasks)}
                  waiting={waiting ?? []}
                  onAddDeadline={canWriteTasks && procedure ? () => setDeadlineTarget(procedure) : undefined}
                  onAddHearing={canWriteTasks && procedure && onAddLedger ? () => onAddLedger("hearing") : undefined}
                /> : null}
                {responsibilityNode}

              </div>
            </TabsContent>
            <TabsContent value="records" forceMount hidden={workPane !== "records"} className="data-[state=inactive]:hidden">
              <Tabs value={recordsPane} onValueChange={value => updateDossierLocation({ recordsView: value === "delivery" ? "delivery" : "activity" })}>
              <TabsList aria-label="办理记录分区"><TabsTrigger value="activity">进展记录</TabsTrigger><TabsTrigger value="delivery">交付与回复</TabsTrigger></TabsList>
              <TabsContent value="activity" forceMount hidden={recordsPane !== "activity"} className="data-[state=inactive]:hidden">
              <CaseLog
                sectionRef={recordSectionRef}
                initiallyExpanded={recordsExpanded}
                expandRequest={expandRequest}
                items={logItems}
                allScopeLabel="全案记录 · 全部程序"
                canManage={canWriteRecords}
                canWriteRecords={canWriteRecords}
                onWriteRecord={() => onWriteNote({ judgment: false })}
                onWriteJudgment={() => onWriteNote({ judgment: true })}
                onAddLedger={canManage && onAddLedger ? () => onAddLedger("express") : undefined}
                onCaseSearch={onCaseSearch}
              />
              </TabsContent>
              <TabsContent value="delivery" forceMount hidden={recordsPane !== "delivery"} className="data-[state=inactive]:hidden">{visitedDelivery ? deliveryNode : null}</TabsContent>
              </Tabs>
            </TabsContent>
          </Tabs>
        </div>
          </div>
        </div>
      ) : null}

      {view === "money" ? financeNode : null}
      {view === "seal" ? sealNode : null}
        </div>
        <aside className="dos-rail">
          {archiveRailTop}
          {view !== "work" ? (
          <ArchiveGlance
            actions={actions}
            logItems={logItems}
            waiting={waiting ?? []}
            procedureLabel={procedure ? procedure.customLabel ?? procedureTypeLabel[procedure.type] : null}
            canReadSchedule={canReadSchedule}
            onOpenWork={openWorkSection}
          />
          ) : null}
        </aside>
      </div>

      {/* 环节操作条与页头「上传材料」共用：打开当前选中环节的上传弹窗 */}
        <div hidden>
          <StageMaterialsPanel
            matterId={matter.id}
            procedure={procedure}
            stage={selectedStage}
            documents={[]}
            canManage={canWriteMaterials && !invalidStage && !invalidProcedure}
            uploadSignal={uploadSignal}
          />
        </div>

      <TemplatePickerDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        matterId={matter.id}
        matterCategory={matter.category}
        folders={folders}
        templates={templates}
      />
      {stageCreateTarget ? (
        <StageCreateDialog
          open
          onOpenChange={open => { if (!open) setStageCreateTarget(null); }}
          procedureId={stageCreateTarget.procedure.id}
          procedureType={stageCreateTarget.procedure.type}
          procedureLabel={stageCreateTarget.procedure.customLabel ?? procedureTypeLabel[stageCreateTarget.procedure.type]}
          stages={stageCreateTarget.stages}
          selectedItem={stageCreateTarget.selected}
          onCreated={stageId => {
            if (window.location.pathname + window.location.search === stageCreateTarget.location) setSelectedKey(`stage-${stageId}`);
          }}
        />
      ) : null}
      {deadlineTarget ? (
        <AddDeadlineDialog
          open
          onOpenChange={open => { if (!open) setDeadlineTarget(null); }}
          procedures={[{ id: deadlineTarget.id, label: deadlineTarget.customLabel ?? procedureTypeLabel[deadlineTarget.type] }]}
          defaultProcedureId={deadlineTarget.id}
        />
      ) : null}
    </>
  );
}

function stageChainDate(stage: WorkflowStage, procedure: WorkflowProcedure | null): string | null {
  const source = procedure?.stages.find(item => item.id === stage.id);
  if (source?.completedAt) return `完成 ${shortDay(source.completedAt)}`;
  if (source?.startedAt) return `开始 ${shortDay(source.startedAt)}`;
  return null;
}

function StageGlyph({ name, kind, className }: { name: string; kind: WorkflowStage["kind"]; className?: string }) {
  const p = { className, strokeWidth: 1.8 };
  if (kind === "preservation" || name.includes("保全")) return <Shield {...p} />;
  if (name.includes("授权") || name.includes("委托")) return <FileCheck2 {...p} />;
  if (name.includes("研判") || name.includes("分析")) return <Lightbulb {...p} />;
  if (name.includes("证据") || name.includes("举证") || name.includes("质证")) return <BookOpen {...p} />;
  if (name.includes("开庭") || name.includes("庭审") || name.includes("庭")) return <Landmark {...p} />;
  if (name.includes("判决") || name.includes("裁") || name.includes("送达")) return <ScrollText {...p} />;
  if (name.includes("归档") || name.includes("结案")) return <Archive {...p} />;
  if (name.includes("立案") || name.includes("材料") || name.includes("起诉")) return <FolderOpen {...p} />;
  if (name.includes("执行")) return <Gavel {...p} />;
  return <ListChecks {...p} />;
}

const STAGE_STATUS_TEXT: Record<WorkflowStageStatus, string> = {
  done: "已完成",
  active: "进行中",
  risk: "临期风险",
  todo: "未记录进度",
  not_applicable: "不适用"
};

/** 环节条：选中环节的说明、清单与本环节操作；事项列表在「下一步」，材料在「材料」视图 */
function StageBar({
  stage,
  procedure,
  documents,
  canManage,
  onRemoveStage
}: {
  stage: WorkflowStage;
  procedure: WorkflowProcedure;
  documents: WorkflowDocument[];
  canManage: boolean;
  onRemoveStage?: () => void;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const guide = stageGuideFor(stage.name);
  const src = procedure.stages.find((s) => s.id === stage.id);
  const openTasks = stage.tasks.filter((t) => !t.completed).length;
  const docCount = documents.filter((d) => documentMatchesStage(d, stage)).length;
  const tone = stage.status === "risk" ? "amber" : stage.status === "done" ? "green" : stage.status === "active" ? "teal" : "slate";

  return (
    <section className="card dos-stage" aria-label={`环节：${stage.name}`}>
      <div className="dos-stage-head">
        <div className="ic-wrap" style={stage.status === "risk" ? { background: "var(--amber-bg)", color: "var(--amber)" } : undefined}>
          <StageGlyph name={stage.name} kind={stage.kind} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="dos-stage-name">{stage.name}</h2>
            <span className={cn("badge", `b-${tone}`)}>
              <span className="bdot" />
              {STAGE_STATUS_TEXT[stage.status]}
            </span>
          </div>
          <div className="dos-stage-meta">
            {[
              src?.startedAt ? `开始 ${shortDay(src.startedAt)}` : null,
              src?.completedAt ? `完成 ${shortDay(src.completedAt)}` : null,
              `未完成任务 ${openTasks}`
            ]
              .filter(Boolean)
              .join(" · ")}
            {` · 材料 ${docCount} 份`}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setGuideOpen((v) => !v)} aria-expanded={guideOpen}>
          {guideOpen ? "收起说明" : "环节说明"}
        </button>
      </div>
      {guideOpen ? <StageGuideBody guide={guide} /> : <p className="dos-stage-summary">{guide.summary}</p>}
      {canManage && onRemoveStage ? (
        <div className="dos-stage-acts">
          <button type="button" className="btn btn-ghost btn-sm text-[var(--t-muted)]" onClick={onRemoveStage}>
            移除环节
          </button>
        </div>
      ) : null}
    </section>
  );
}

function StageGuideBody({ guide }: { guide: StageGuide }) {
  return (
    <div className="mx-4 mb-3 rounded-[8px] bg-[var(--bg-sunken)] px-3 py-2.5">
      <div className="text-[11.5px] font-semibold text-[var(--t-secondary)]">{guide.checklistTitle}</div>
      <ul className="mt-1.5 space-y-1">
        {guide.checklist.map((item) => (
          <li key={item} className="flex items-start gap-2 text-[12px] leading-5 text-[var(--t-secondary)]">
            <span className="mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--teal)]" />
            {item}
          </li>
        ))}
      </ul>
      {guide.actions.length > 0 ? (
        <p className="mt-1.5 text-[11px] leading-5 text-[var(--t-muted)]">常用文书：{guide.actions.join("、")}（在「从模板生成」中选用）</p>
      ) : null}
    </div>
  );
}


/** 研判笔记归属环节（tags「环节:xxx」） */
function noteStage(note: WorkflowNote) {
  return note.tags?.find((t) => t.startsWith("环节:"))?.slice(3) ?? null;
}


function formatDateTimeShort(date: Date) {
  const d = new Date(date);
  return shMonthDayTime(d);
}

const NOTE_CHANNEL_LABEL: Record<string, string> = {
  PHONE: "电话沟通",
  WECHAT: "微信沟通",
  EMAIL: "邮件往来",
  MEETING: "面谈",
  COURT: "法院沟通",
  OTHER: "办案记录"
};

const EVENT_TONE: Record<string, { bg: string; fg: string; icon: typeof FileText }> = {
  FEE_RECEIVED: { bg: "var(--green-bg)", fg: "var(--green)", icon: CircleDollarSign },
  DOCUMENT_UPLOADED: { bg: "var(--blue-bg)", fg: "var(--blue)", icon: FileText },
  HEARING_SCHEDULED: { bg: "var(--blue-bg)", fg: "var(--blue)", icon: Landmark },
  DEADLINE_ADDED: { bg: "var(--amber-bg)", fg: "var(--amber)", icon: CalendarClock },
  MATTER_ARCHIVED: { bg: "var(--bronze-bg)", fg: "var(--bronze)", icon: Archive },
  MATTER_ARCHIVE_REQUESTED: { bg: "var(--bronze-bg)", fg: "var(--bronze)", icon: Archive },
  MATTER_CLOSED: { bg: "var(--green-bg)", fg: "var(--green)", icon: Check }
};

/* ------------------------------------------------------------------ */
/* 环节线：当前程序的全部环节，末尾是「＋ 添加环节」                     */
/* ------------------------------------------------------------------ */

function StageLine({ procedure, stages, selectedKey, onSelect, onAddStage }: {
  procedure: WorkflowProcedure | null;
  stages: WorkflowStage[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onAddStage?: () => void;
}) {
  return <nav className="card dos-vline" aria-label="办案范围">
    <div className="dos-vline-head"><span className="t">{procedure ? "程序环节" : "全案范围"}</span></div>
    <div className="flex flex-wrap gap-2 px-3 pb-3">
      <Button size="sm" variant={selectedKey === null ? "default" : "outline"} onClick={() => onSelect(null)}>{procedure ? "全部环节" : "全部材料与任务"}</Button>
      <Button size="sm" variant={selectedKey === "unassigned" ? "default" : "outline"} onClick={() => onSelect("unassigned")}>{procedure ? "未归属环节" : "未归属"}</Button>
    </div>
    {procedure ? <ol className="dos-vline-list">{stages.map(stage => {
      const state = stage.status === "done" ? "done" : stage.status === "active" ? "cur" : "todo";
      const overdue = stage.tasks.filter(task => !task.completed && task.dueAt && daysUntil(task.dueAt) < 0).length;
      return <li key={stage.key} className={cn("dos-vnode", state, stage.key === selectedKey && "sel")}>
        <button type="button" onClick={() => onSelect(stage.key)} aria-pressed={stage.key === selectedKey} title={`${stage.name} · ${STAGE_STATUS_TEXT[stage.status]}`}>
          <span className="pin" aria-hidden>{state === "done" ? <Check strokeWidth={3} /> : null}</span>
          <span className="body"><span className="nm">{stage.name}</span><span className="sub">
            {overdue > 0 ? <span className="dos-flag red">任务逾期 {overdue}</span> : null}
            <span className="dt">{stageChainDate(stage, procedure) ?? (stage.id ? "未记录进度" : "尚未启用")}</span>
          </span></span>
        </button>
      </li>;
    })}</ol> : null}
    {onAddStage ? <Button variant="ghost" size="sm" className="m-3" onClick={onAddStage}><Plus />添加环节</Button> : null}
  </nav>;
}

/** 一个按钮 + 类型菜单：待办用「＋事项」，记录用「＋记录」（2026-09-15 入口合并） */
function AddMenu({
  label,
  primary,
  items
}: {
  label: string;
  primary?: boolean;
  items: { key: string; label: string; hint: string; icon: typeof Plus; onSelect: () => void }[];
}) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn("btn btn-sm", primary ? "btn-primary" : "btn-secondary")}>
          <Plus />
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <DropdownMenuItem key={item.key} onSelect={item.onSelect} className="items-start gap-2.5 py-2">
              <Icon className="mt-0.5 h-4 w-4 text-[var(--t-muted)]" strokeWidth={1.8} />
              <span className="flex flex-col">
                <span className="text-[13px] font-medium">{item.label}</span>
                <span className="text-[11px] text-muted-foreground">{item.hint}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/* 待办：只放未完成的任务、法定期限与开庭                               */
/* ------------------------------------------------------------------ */

type ActionItem = {
  key: string;
  kind: "deadline" | "hearing" | "memo";
  title: string;
  at: Date | null;
  days: number | null;
  stageKey: string | null;
  stageName: string | null;
  meta: string;
  priority: number;
  deadlineId?: string;
  memoId?: string;
  pendingConfirm?: boolean;
};

function buildActionItems(procedure: WorkflowProcedure | null): ActionItem[] {
  if (!procedure) return [];
  const items: ActionItem[] = [];
  const procedureLabel = procedure.customLabel ?? procedureTypeLabel[procedure.type];
  for (const deadline of procedure.deadlines) {
    if (deadline.completed) continue;
    items.push({
      key: `d-${deadline.id}`,
      kind: "deadline",
      title: deadline.title,
      at: deadline.dueAt,
      days: daysUntil(deadline.dueAt),
      stageKey: null,
      stageName: null,
      meta: [procedureLabel, deadline.basis].filter(Boolean).join(" · "),
      priority: 2,
      deadlineId: deadline.id,
      pendingConfirm: deadline.confirmStatus === "PENDING"
    });
  }
  for (const hearing of procedure.hearings) {
    const days = daysUntil(hearing.startsAt);
    items.push({
      key: `h-${hearing.id}`,
      kind: "hearing",
      title: hearing.title,
      at: hearing.startsAt,
      days,
      stageKey: null,
      stageName: null,
      meta: [procedureLabel, hearing.room, hearing.address, days < 0 ? "计划时间已过，结果未记录" : null].filter(Boolean).join(" · "),
      priority: 1
    });
  }
  // 历史备忘＝无截止日的事项（2026-09-15 起不再新增）
  for (const memo of procedure.memos ?? []) {
    if (memo.done) continue;
    items.push({
      key: `m-${memo.id}`,
      kind: "memo",
      title: memo.content.split("\n")[0].slice(0, 80),
      at: null,
      days: null,
      stageKey: null,
      stageName: null,
      meta: `备忘 · ${shortDay(memo.createdAt)} 记`,
      priority: 0,
      memoId: memo.id
    });
  }
  const byTime = (a: ActionItem, b: ActionItem) => (a.at ? new Date(a.at).getTime() : Infinity) - (b.at ? new Date(b.at).getTime() : Infinity) || b.priority - a.priority;
  return items.sort(byTime);
}

function actionWhen(item: ActionItem) {
  const tone = item.days !== null && item.days < 0 ? "red" : item.kind === "hearing" ? "blue" : item.days !== null && item.days <= 7 ? "amber" : "slate";
  const main =
    item.kind === "hearing" && item.at
      ? shortDay(item.at)
      : item.days === null
        ? "无期限"
        : item.days < 0
          ? `逾期 ${-item.days} 天`
          : item.days === 0
            ? "今天"
            : `剩 ${item.days} 天`;
  const sub = item.at ? (item.kind === "hearing" ? shTime(item.at) : `${shortDay(item.at)} 截止`) : "";
  return { tone, main, sub };
}

function NextActions({
  sectionRef,
  initiallyExpanded = false,
  expandRequest = 0,
  compact = false,
  actions,
  selectedStage,
  scope,
  allScopeLabel,
  canManage,
  waiting,
  onAddDeadline,
  onAddHearing
}: {
  sectionRef?: React.Ref<HTMLElement>;
  initiallyExpanded?: boolean;
  expandRequest?: number;
  /** 侧栏紧凑排布（办案进程页签） */
  compact?: boolean;
  actions: ActionItem[];
  selectedStage: WorkflowStage | null;
  scope: "all" | "stage";
  allScopeLabel: string;
  canManage: boolean;
  waiting: WaitingItem[];
  onAddDeadline?: () => void;
  onAddHearing?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showLater, setShowLater] = useState(initiallyExpanded);
  const [showOthers, setShowOthers] = useState(initiallyExpanded);
  useEffect(() => {
    if (!expandRequest) return;
    setShowLater(true);
    setShowOthers(true);
  }, [expandRequest]);
  const [adjusting, setAdjusting] = useState<{ id: string; title: string; dueAt: Date } | null>(null);
  const inScope = scope === "stage" && selectedStage ? actions.filter((i) => i.stageKey === selectedStage.key) : actions;
  const overdue = inScope.filter((i) => i.days !== null && i.days < 0);
  const soon = inScope.filter((i) => i.days !== null && i.days >= 0 && i.days <= 7);
  const later = inScope.filter((i) => i.days === null || i.days > 7);
  const others = scope === "stage" && selectedStage ? actions.filter((i) => i.stageKey !== selectedStage.key) : [];
  const othersOverdue = others.filter((i) => i.days !== null && i.days < 0).length;

  function run(action: () => Promise<unknown>, ok: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(ok);
        router.refresh();
      } catch (err) {
        toast.error("操作失败", { description: actionErrorMessage(err) });
      }
    });
  }

  async function completeDeadline(item: ActionItem) {
    if (!item.deadlineId) return;
    if (!(await confirmDialog({ title: `标记「${item.title}」已完成？`, description: "法定期限完成后不再提醒，会记入记录。", confirmText: "标记完成" }))) return;
    run(() => toggleDeadlineCompleted(item.deadlineId!), "期限已标记完成");
  }

  const row = (item: ActionItem, other = false) => {
    const when = actionWhen(item);
    if (compact) {
      const kindMeta =
        item.kind === "deadline"
          ? { label: "期限", cls: "k-deadline", Icon: Scale }
          : item.kind === "hearing"
            ? { label: "开庭", cls: "k-hearing", Icon: Landmark }
            : { label: "备忘", cls: "k-memo", Icon: StickyNote };
      const KindIcon = kindMeta.Icon;
      return (
        <div key={item.key} className={cn("dos-act-c", when.tone, other && "other")}>
          <span className="bar" aria-hidden />
          <span className={cn("ki", kindMeta.cls)} title={kindMeta.label} aria-label={kindMeta.label}>
            <KindIcon strokeWidth={2} />
          </span>
          <div className="body">
            <div className="top">
              <span className="t">{item.title}</span>
              <span className="w">{when.main}</span>
            </div>
            <div className="bot">
              <span className="m">
                {[other || scope === "all" ? item.stageName : null, when.sub, item.meta || null].filter(Boolean).join(" · ") || "\u00a0"}
              </span>
              <span className="ops">
                {canManage && item.kind === "memo" && item.memoId ? (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => toggleProcedureMemo(item.memoId!), "已办结，转入记录")}>
                    办结
                  </button>
                ) : null}
                {canManage && item.kind === "deadline" && item.deadlineId ? (
                  <>
                    {item.pendingConfirm ? (
                      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => confirmDeadline({ id: item.deadlineId! }), "期限已确认")}>
                        确认
                      </button>
                    ) : null}
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => item.at && setAdjusting({ id: item.deadlineId!, title: item.title, dueAt: item.at })}>
                      调整
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => completeDeadline(item)}>
                      完成
                    </button>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div key={item.key} className={cn("dos-act", when.tone)}>
        <i className="sev" aria-hidden />
        <div className="when">
          <b>{when.main}</b>
          <span>{when.sub}</span>
        </div>
        <div className="what">
          <div className="t">
            {item.title}
            {item.kind === "deadline" ? <span className="badge b-outline-red" style={{ fontSize: 10 }}>法定期限</span> : null}
            {item.kind === "hearing" ? <span className="badge b-blue" style={{ fontSize: 10 }}>开庭</span> : null}
            {item.kind === "memo" ? <span className="badge b-slate" style={{ fontSize: 10 }}>备忘</span> : null}
            {item.pendingConfirm ? <span className="badge b-amber" style={{ fontSize: 10 }}>期限待确认</span> : null}
          </div>
          <div className="d">{[scope === "all" ? item.stageName : null, item.meta || null].filter(Boolean).join(" · ") || " "}</div>
        </div>
        <div className="op">
          {canManage && item.kind === "memo" && item.memoId ? (
            <>
              <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => run(() => toggleProcedureMemo(item.memoId!), "已办结，转入记录")}>
                办结
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-[var(--t-muted)]"
                disabled={pending}
                onClick={async () => {
                  if (!(await confirmDialog({ title: "删除这条备忘？", confirmText: "删除", danger: true }))) return;
                  run(() => deleteProcedureMemo(item.memoId!), "已删除");
                }}
              >
                删除
              </button>
            </>
          ) : null}
          {canManage && item.kind === "deadline" && item.deadlineId ? (
            <>
              {item.pendingConfirm ? (
                <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => run(() => confirmDeadline({ id: item.deadlineId! }), "期限已确认")}>
                  确认
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => item.at && setAdjusting({ id: item.deadlineId!, title: item.title, dueAt: item.at })}>
                调整
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={pending} onClick={() => completeDeadline(item)}>
                完成
              </button>
            </>
          ) : null}
        </div>
      </div>
    );
  };

  const empty = overdue.length + soon.length + later.length === 0;

  return (
    <section ref={sectionRef} tabIndex={-1} className={cn("card scroll-mt-44", compact && "dos-todo-rail")} aria-label="期限与庭期">
      <div className={cn("panel-head flex-wrap", compact && "rail-sec-head")}>
        <div className={compact ? "flex items-center gap-2" : "panel-title"}>
          <ListChecks className={compact ? "h-[15px] w-[15px] text-[var(--t-muted)]" : "ic"} strokeWidth={1.8} />
          期限与庭期
          <span className="t-xs t-mute" style={{ fontWeight: 400 }}>{scope === "stage" && selectedStage ? selectedStage.name : allScopeLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {canManage ? (
            <AddMenu
              label="事项"
              items={[
                ...(onAddDeadline ? [{ key: "deadline", label: "期限", hint: "法定或约定期限，带起算依据与确认", icon: Scale, onSelect: onAddDeadline }] : []),
                ...(onAddHearing ? [{ key: "hearing", label: "开庭", hint: "时间、法庭与地址，同时进日程", icon: Landmark, onSelect: onAddHearing }] : [])
              ]}
            />
          ) : null}
        </div>
      </div>

      {empty && waiting.length === 0 ? (
        <EmptyState compact title={scope === "stage" ? "本环节没有未结日程" : "当前程序没有未结日程"} />
      ) : null}
      {overdue.length ? (
        <div className="dos-lane">
          <div className={cn("dos-lane-h red", compact && "chip")}>已逾期 · {overdue.length}</div>
          {overdue.map((i) => row(i))}
        </div>
      ) : null}
      {soon.length ? (
        <div className="dos-lane">
          <div className={cn("dos-lane-h", compact && "chip amber")}>7 天内 · {soon.length}</div>
          {soon.map((i) => row(i))}
        </div>
      ) : null}
      {later.length ? (
        <div className="dos-lane">
          <button type="button" className={cn("dos-lane-h as-btn", compact && "chip slate")} onClick={() => setShowLater((v) => !v)} aria-expanded={showLater}>
            之后 · {later.length} {showLater ? "（收起）" : "（展开）"}
          </button>
          {showLater ? later.map((i) => row(i)) : null}
        </div>
      ) : null}
      {/* 其他环节的待办：同一模块内弱化陈列，默认折叠（2026-09-16 用户要求） */}
      {others.length ? (
        <div className="dos-lane others">
          <div className="dos-others-h">
            <span className={cn("chip", othersOverdue && "hot")}>
              其他环节 · {others.length}
              {othersOverdue ? `（逾期 ${othersOverdue}）` : ""}
            </span>
            <button type="button" className="more" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
              {showOthers ? "收起" : "展开"}
            </button>
          </div>
          {showOthers ? others.map((i) => row(i, true)) : null}
        </div>
      ) : null}
      {waiting.length ? (
        <div className="dos-lane">
          <div className={cn("dos-lane-h", compact && "chip teal")}>等待他人 · {waiting.length}</div>
          {waiting.map((w) => compact ? (
            <div key={w.key} className="dos-act-c teal">
              <span className="bar" aria-hidden />
              <span className="ki k-approval" aria-label="审批">
                <Stamp strokeWidth={2} />
              </span>
              <div className="body">
              <div className="top">
                <span className="t">{w.title}</span>
                <span className="w">审批中</span>
              </div>
              <div className="bot">
                <span className="m">{w.meta}</span>
                <span className="ops">
                  {w.onOpen ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={w.onOpen}>
                      查看
                    </button>
                  ) : null}
                </span>
              </div>
              </div>
            </div>
          ) : (
            <div key={w.key} className="dos-act teal">
              <i className="sev" aria-hidden />
              <div className="when">
                <b>审批中</b>
                <span />
              </div>
              <div className="what">
                <div className="t">{w.title}</div>
                <div className="d">{w.meta}</div>
              </div>
              <div className="op">
                {w.onOpen ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={w.onOpen}>
                    查看
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {adjusting ? (
        <AdjustDeadlineDialog
          deadline={adjusting}
          onClose={() => {
            setAdjusting(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 经办记录：只放已发生的事——沟通、研判、完成的任务、已开庭、系统事件    */
/* ------------------------------------------------------------------ */

type LogKind = "talk" | "court" | "note" | "task" | "express" | "memo" | "sys";
type LogItem = {
  key: string;
  kind: LogKind;
  at: Date;
  stageName: string | null;
  title: string;
  body: string | null;
  meta: string;
  channelTone?: "court" | "talk";
  stageTag?: string | null;
  eventType?: string;
  memo?: { id: string; done: boolean };
  express?: { id: string; outbound: boolean };
};

function buildLogItems({ procedures, notes, events, users, expresses }: {
  procedures: WorkflowProcedure[];
  notes: WorkflowNote[];
  events: WorkflowTimelineEvent[];
  users: UserOption[];
  expresses: ExpressItem[];
}): LogItem[] {
  const nameOf = (id: string | null) => id ? users.find(user => user.id === id)?.name ?? null : null;
  const items: LogItem[] = [];
  for (const note of notes) {
    const at = new Date(note.occurredAt);
    const judgment = note.tags.includes(JUDGMENT_NOTE_TAG);
    items.push({ key: `n-${note.id}`, kind: judgment ? "note" : note.channel === "COURT" ? "court" : "talk", at,
      stageName: null, title: judgment ? "研判笔记" : `${NOTE_CHANNEL_LABEL[note.channel] ?? "办案记录"}${note.withWhom ? ` · ${note.withWhom}` : ""}`,
      body: note.content, meta: `${note.author.name} · ${formatDateTimeShort(at)}`, stageTag: noteStage(note) });
  }
  for (const procedure of procedures) {
    const procedureLabel = procedure.customLabel ?? procedureTypeLabel[procedure.type];
    for (const stage of procedure.stages) for (const task of stage.tasks) {
      const responsibility = task.responsibility;
      if (!responsibility || responsibility.state === "OPEN" || !responsibility.closedAt) continue;
      const at = new Date(responsibility.closedAt);
      const assignee = nameOf(task.assigneeId);
      items.push({ key: `t-${task.id}`, kind: "task", at, stageName: null,
        title: `${responsibility.state === "DONE" ? "办结" : "取消"}任务：${task.title}`, body: null,
        meta: [procedureLabel, stage.name, assignee ? `经办 ${assignee}` : null, formatDateTimeShort(at)].filter(Boolean).join(" · ") });
    }
    for (const hearing of procedure.hearings) {
      const at = new Date(hearing.startsAt);
      if (at.getTime() > Date.now()) continue;
      items.push({ key: `h-${hearing.id}`, kind: "court", at, stageName: null,
        title: `开庭计划：${hearing.title}`, body: "计划时间已过，实际结果尚未记录。",
        meta: [procedureLabel, hearing.room, formatDateTimeShort(at)].filter(Boolean).join(" · "), channelTone: "court" });
    }
    for (const memo of (procedure.memos ?? []).filter(item => item.done)) {
      const at = new Date(memo.doneAt ?? memo.createdAt);
      items.push({ key: `m-${memo.id}`, kind: "memo", at, stageName: null, title: "备忘（已办）", body: memo.content,
        meta: [procedureLabel, formatDateTimeShort(at)].join(" · "), memo: { id: memo.id, done: memo.done } });
    }
  }
  for (const express of expresses) {
    const at = new Date(express.createdAt);
    const outbound = express.direction === "OUTBOUND";
    items.push({ key: `x-${express.id}`, kind: "express", at, stageName: null, title: `${outbound ? "寄出" : "收件"}：${express.purpose}`, body: null,
      meta: [express.companyCode ?? "快递公司待识别", express.trackingNo, express.lastState ?? "待跟踪", express.lastUpdateAt ? `更新 ${formatDateTimeShort(new Date(express.lastUpdateAt))}` : null].filter(Boolean).join(" · "),
      express: { id: express.id, outbound } });
  }
  for (const event of events) {
    if (["DOCUMENT_UPLOADED", "TASK_ADDED", "HEARING_SCHEDULED", "DEADLINE_ADDED"].includes(event.eventType)) continue;
    const at = new Date(event.occurredAt);
    items.push({ key: `e-${event.id}`, kind: "sys", at, stageName: null, title: event.title, body: null,
      meta: [formatDateTimeShort(at), event.content].filter(Boolean).join(" · "), eventType: event.eventType });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}

const LOG_FILTERS: { key: "all" | LogKind; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "talk", label: "沟通" },
  { key: "court", label: "法院" },
  { key: "note", label: "研判" },
  { key: "task", label: "任务" },
  { key: "express", label: "快递" },
  { key: "sys", label: "系统" }
];

function LogRow({ item, canManage }: { item: LogItem; canManage?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function run(fn: () => Promise<unknown>, ok: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(ok);
        router.refresh();
      } catch (err) {
        toast.error("操作失败", { description: actionErrorMessage(err) });
      }
    });
  }
  const ledgerOps =
    canManage && (item.memo || item.express) ? (
      <div className="dos-log-ops">
        {item.memo ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => toggleProcedureMemo(item.memo!.id), item.memo!.done ? "已恢复为待办" : "备忘已办结")}>
            {item.memo.done ? "恢复" : "办结"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm text-[var(--t-muted)]"
          disabled={pending}
          onClick={async () => {
            if (!(await confirmDialog({ title: item.memo ? "删除这条备忘？" : "删除这条快递记录？", confirmText: "删除", danger: true }))) return;
            run(() => (item.memo ? deleteProcedureMemo(item.memo.id) : deleteExpress({ id: item.express!.id })), "已删除");
          }}
        >
          删除
        </button>
      </div>
    ) : null;
  if (item.kind === "note") {
    return (
      <div className="rec">
        <div className="rec-ic" style={{ background: "var(--violet-bg)", color: "var(--violet)" }}>
          <PenLine strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="rec-title">
            研判笔记
            {item.stageTag ? <span className="badge b-white" style={{ fontSize: 9.5, padding: "0 6px", marginLeft: 6 }}>{item.stageTag}</span> : null}
            <span className="badge b-violet" style={{ fontSize: 9.5, padding: "0 6px", marginLeft: 6 }}>人工判断</span>
          </div>
          <div className="rec-note whitespace-pre-wrap">{item.body}</div>
          <div className="rec-meta">{item.meta}</div>
        </div>
      </div>
    );
  }
  const tone =
    item.kind === "express"
      ? { bg: item.express?.outbound ? "var(--amber-bg)" : "var(--green-bg)", fg: item.express?.outbound ? "var(--amber)" : "var(--green)", icon: Truck }
      : item.kind === "memo"
        ? { bg: "var(--slate-bg)", fg: "var(--slate)", icon: StickyNote }
        : item.kind === "court"
      ? { bg: "var(--bronze-bg)", fg: "var(--bronze)", icon: Landmark }
      : item.kind === "talk"
        ? { bg: "var(--teal-soft)", fg: "var(--teal-deep)", icon: MessageSquare }
        : item.kind === "task"
          ? { bg: "var(--green-bg)", fg: "var(--green)", icon: Check }
          : EVENT_TONE[item.eventType ?? ""] ?? { bg: "var(--slate-bg)", fg: "var(--slate)", icon: ListChecks };
  const Icon = tone.icon;
  return (
    <div className="rec">
      <div className="rec-ic" style={{ background: tone.bg, color: tone.fg }}>
        <Icon strokeWidth={2} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="rec-title">{item.title}</div>
        {item.body ? <div className={cn("dos-note-text whitespace-pre-wrap", item.memo?.done && "line-through text-[var(--t-muted)]")}>{item.body}</div> : null}
        <div className="rec-meta">{item.meta}</div>
      </div>
      {ledgerOps}
    </div>
  );
}

function CaseLog({
  sectionRef,
  initiallyExpanded = false,
  expandRequest = 0,
  items,
  allScopeLabel,
  canManage,
  canWriteRecords,
  onWriteRecord,
  onWriteJudgment,
  onAddLedger,
  onCaseSearch
}: {
  sectionRef?: React.Ref<HTMLElement>;
  initiallyExpanded?: boolean;
  expandRequest?: number;
  onAddLedger?: (type: "express") => void;
  onCaseSearch?: () => void;
  items: LogItem[];
  allScopeLabel: string;
  canManage: boolean;
  canWriteRecords: boolean;
  onWriteRecord: () => void;
  onWriteJudgment: () => void;
}) {
  const [filter, setFilter] = useState<"all" | LogKind>("all");
  const [expanded, setExpanded] = useState(initiallyExpanded);
  useEffect(() => {
    if (!expandRequest) return;
    setFilter("all");
    setExpanded(true);
  }, [expandRequest]);

  const scoped = items;
  const shown = scoped.filter(item => filter === "all" || item.kind === filter);
  const visible = expanded ? shown : shown.slice(0, 12);

  return (
    <section ref={sectionRef} tabIndex={-1} className="card scroll-mt-44" aria-label="记录">
      <div className="panel-head flex-wrap">
        <div className="panel-title">
          <BookOpen className="ic" strokeWidth={1.8} />
          记录
          <span className="t-xs t-mute" style={{ fontWeight: 400 }}>{allScopeLabel}</span>
        </div>
        <div className="flex items-center gap-[7px]">
        {onCaseSearch ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCaseSearch}>
            <Scale />
            类案检索
          </button>
        ) : null}
          <AddMenu
            label="记录"
            items={[
              ...(canWriteRecords ? [{ key: "talk", label: "沟通", hint: "电话、微信、邮件、会见、法院沟通", icon: MessageSquare, onSelect: onWriteRecord }] : []),
              ...(onAddLedger ? [{ key: "express", label: "快递", hint: "填单号，物流状态自动更新", icon: Truck, onSelect: () => onAddLedger("express") }] : []),
              ...(canWriteRecords ? [{ key: "judgment", label: "研判", hint: "我的判断与分析，独立样式陈列", icon: PenLine, onSelect: onWriteJudgment }] : [])
            ]}
          />
        </div>
      </div>
      <div className="dos-log-filters" role="group" aria-label="记录筛选">
        {LOG_FILTERS.map((f) => {
          const count = f.key === "all" ? scoped.length : scoped.filter((e) => e.kind === f.key).length;
          return (
            <button key={f.key} type="button" className={cn("dos-filter", filter === f.key && "on")} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
              {count ? <span>{count}</span> : null}
            </button>
          );
        })}
      </div>
      {shown.length === 0 ? <EmptyState compact title="暂无记录" /> : <div className="dos-seg">{visible.map(item => <LogRow key={item.key} item={item} canManage={canManage} />)}</div>}
      {shown.length > visible.length ? <Button variant="ghost" className="m-3" onClick={() => setExpanded(true)}>展开更早的 {shown.length - visible.length} 条记录</Button> : null}
    </section>
  );
}

/** 案件档案右侧提醒：最近待办 + 最近记录，只做提醒，完整内容在办案进程 */
function ArchiveGlance({
  actions,
  logItems,
  waiting,
  procedureLabel,
  canReadSchedule,
  onOpenWork
}: {
  actions: ActionItem[];
  logItems: LogItem[];
  waiting: WaitingItem[];
  procedureLabel: string | null;
  canReadSchedule: boolean;
  onOpenWork: (section: "tasks" | "records") => void;
}) {
  const overdue = actions.filter((a) => a.days !== null && a.days < 0).length;
  return (
    <>
      <div className="card">
        <div className="rail-sec-head">
          <ListChecks className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
          近期日程与审批
          {procedureLabel ? <span className="t-xs t-mute" style={{ fontWeight: 400 }}>{procedureLabel}</span> : null}
          <button type="button" className="link border-0 bg-transparent p-0" onClick={() => onOpenWork("tasks")}>查看全部任务与日程</button>
        </div>
        {actions.length === 0 && waiting.length === 0 ? (
          <div className="panel-body t-xs t-mute">{canReadSchedule ? "当前范围没有未结日程或审批" : "无日程查看权限"}</div>
        ) : (
          <>
            {overdue > 0 ? <div className="dos-glance-alert">已逾期 {overdue} 项</div> : null}
            {actions.slice(0, 3).map((a) => {
              const when = actionWhen(a);
              return (
                <button key={a.key} type="button" className="dos-glance-row" onClick={() => onOpenWork("tasks")}>
                  <span className={cn("w", when.tone)}>{when.main}</span>
                  <span className="t">{a.title}</span>
                </button>
              );
            })}
            {waiting.slice(0, actions.length >= 3 ? 0 : 3 - actions.length).map((w) => (
              <button key={w.key} type="button" className="dos-glance-row" onClick={w.onOpen ?? (() => onOpenWork("tasks"))}>
                <span className="w teal">审批中</span>
                <span className="t">{w.title}</span>
              </button>
            ))}
          </>
        )}
      </div>
      <div className="card">
        <div className="rail-sec-head">
          <BookOpen className="h-[15px] w-[15px] text-[var(--t-muted)]" strokeWidth={1.8} />
          最近记录
          {logItems.length > 0 ? <button type="button" className="link border-0 bg-transparent p-0" onClick={() => onOpenWork("records")}>
            查看全部记录 <span className="mono">{logItems.length}</span>
          </button> : null}
        </div>
        {logItems.length === 0 ? (
          <div className="panel-body t-xs t-mute">暂无记录</div>
        ) : (
          logItems.slice(0, 3).map((l) => (
            <button key={l.key} type="button" className="dos-glance-row col" onClick={() => onOpenWork("records")}>
              <span className="t">{l.title}</span>
              {l.body ? <span className="b">{l.body}</span> : null}
              <span className="m">{l.meta}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 材料：随环节范围展示（本环节带上传与来源筛选，全部环节按环节分组）   */
/* ------------------------------------------------------------------ */

function MaterialsSection({ matterId, procedure, documents, stage, unassignedOnly, canManage, onOpenTemplate, onRequestUpload }: {
  matterId: string;
  procedure: WorkflowProcedure | null;
  documents: WorkflowDocument[];
  stage: WorkflowStage | null;
  unassignedOnly: boolean;
  canManage: boolean;
  onOpenTemplate: () => void;
  onRequestUpload: () => void;
}) {
  const visible = stage ? documents.filter(document => documentMatchesStage(document, stage))
    : unassignedOnly ? documents.filter(document => procedure ? !document.stageId : !document.procedureId) : documents;
  return <>
    <p className="text-sm text-muted-foreground">{stage ? `环节材料 · ${stage.name}` : procedure ? unassignedOnly ? "本程序 · 未归属环节材料" : "本程序 · 全部材料" : unassignedOnly ? "全案 · 未归属程序材料" : "全案 · 全部材料"}</p>
    <StageMaterialsPanel matterId={matterId} procedure={procedure} stage={stage} documents={visible} canManage={canManage} onOpenTemplate={onOpenTemplate} onRequestUpload={onRequestUpload} />
  </>;
}

function DocRow({ doc, compact = false }: { doc: WorkflowDocument; compact?: boolean }) {
  const { onReview, onOpenDocument, evidenceByDoc, onAddEvidence } = useDocActions();
  const [evOpen, setEvOpen] = useState(false);
  const pUrl = documentPreviewUrl(doc);
  const chip = doc.sourceOrigin ? documentSourceChip[doc.sourceOrigin] : null;
  const ext = doc.name.split(".").pop()?.toLowerCase() ?? "";
  const tone = ext === "pdf" ? "red" : ["doc", "docx"].includes(ext) ? "blue" : doc.textSource === "OCR" ? "violet" : "slate";
  const evidence = evidenceByDoc?.get(doc.id) ?? [];
  const meta: string[] = [];
  if (doc.size) meta.push(formatBytes(doc.size));
  meta.push(`${shortDay(doc.createdAt)} ${doc.templateId ? "从模板生成" : "上传"}`);
  if (doc.ocrStatus === "READY" && doc.pageCount) meta.push(`已抽取文本 · ${doc.pageCount} 页`);
  if (!compact && doc.sha256) meta.push(`校验值 ${doc.sha256.slice(0, 4)}…${doc.sha256.slice(-4)}`);
  if (doc.version && doc.version > 1) meta.push(`版本 ${doc.version}`);
  return (
    <div className={cn("dos-doc", evOpen && "open")}>
      <div className="doc-row">
        <DocIcon tone={tone} />
        <div className="min-w-0 flex-1">
          {onOpenDocument ? <button type="button" className="doc-name block w-full truncate text-left hover:text-[var(--teal-deep)]" onClick={() => onOpenDocument(doc.id)}>{doc.name}</button> : pUrl ? (
            <a href={pUrl} target="_blank" rel="noreferrer" className="doc-name block truncate hover:text-[var(--teal-deep)]">
              {doc.name}
            </a>
          ) : (
            <div className="doc-name truncate">{doc.name}</div>
          )}
          {/* 标签行：材料性质 / 来源 / 识别状态 / 证据要点（2026-09-14 证据链并入材料） */}
          <div className="dos-doc-tags">
            <span className={cn("dos-doc-cat", doc.category === "EVIDENCE" && "ev")}>{documentCategoryLabel[doc.category]}</span>
            {chip ? <SourceChip kind={chip.kind}>{chip.label}</SourceChip> : doc.sourceParty ? <SourceChip kind="plain">{doc.sourceParty}</SourceChip> : null}
            {doc.ocrStatus === "FAILED" ? <span className="src-chip" style={{ color: "var(--red)", borderColor: "var(--red-line)", background: "var(--red-bg)" }}>识别失败</span> : null}
            {doc.ocrStatus === "PARTIAL" ? <SourceChip kind="plain">部分文本可用</SourceChip> : null}
            {doc.textSource === "OCR" && doc.ocrStatus === "READY" ? <SourceChip kind="ai">AI 识别</SourceChip> : null}
            {evidence.length ? (
              <button type="button" className="dos-doc-ev" aria-expanded={evOpen} onClick={() => setEvOpen((v) => !v)}>
                证据要点 {evidence.length}
                {[...new Set(evidence.map((e) => evidenceKindLabel[e.kind]))].slice(0, 2).map((k) => (
                  <span key={k}>· {k}</span>
                ))}
              </button>
            ) : null}
            <span className="doc-meta truncate">{meta.join(" · ")}</span>
          </div>
        </div>
        {!compact ? (
          <div className="dos-doc-ops">
            {onOpenDocument ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => onOpenDocument(doc.id)}>文书与复核</button> : null}
            {onAddEvidence ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAddEvidence(doc.id)} title="记录这份材料证明的事实、主张或分析">
                ＋证据要点
              </button>
            ) : null}
            {pUrl ? (
              <a href={pUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                预览
              </a>
            ) : null}
            <a href={`/api/documents/${doc.id}/download`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              下载
            </a>
            {onReview && doc.ocrStatus !== "FAILED" ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onReview(doc.id)} title="AI 审查缺失要素、法律风险与条款问题">
                AI 审查
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {evOpen && evidence.length ? (
        <div className="dos-doc-evbox">
          <EvidencePoints items={evidence} />
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

export function MatterPreservationContent({
  matter,
  cases,
  users,
  canManage
}: {
  matter: WorkflowMatter;
  cases: WorkflowPreservationCase[];
  users: UserOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [addTargetCaseId, setAddTargetCaseId] = useState<string | null>(null);
  const [addPropertyTargetId, setAddPropertyTargetId] = useState<string | null>(null);
  const [renewPropertyId, setRenewPropertyId] = useState<string | null>(null);

  const matterOption: MatterOption = {
    id: matter.id,
    internalCode: matter.internalCode,
    title: matter.title
  };
  const properties = cases.flatMap((c) => c.targets.flatMap((t) => t.properties));
  const activeProperties = properties.filter((p) => p.status === "ACTIVE" || p.status === "RENEWED");
  const expiringCount = activeProperties.filter((p) => daysUntil(p.expiryDate) <= 30).length;
  const renewableProperty = properties.find((p) => p.id === renewPropertyId) ?? null;

  function handleLift(propertyId: string) {
    startTransition(async () => {
      try {
        await liftProperty(propertyId);
        toast.success("已解除保全");
        router.refresh();
      } catch (err) {
        toast.error("操作失败", { description: actionErrorMessage(err) });
      }
    });
  }

  return (
    <>
    <div className="card">
      <div className="panel-head" style={{ borderBottom: "none", paddingBottom: 8 }}>
        <div className="ws-head min-w-0 flex-1">
          <div className="ic-wrap" style={expiringCount > 0 ? { background: "var(--amber-bg)", color: "var(--amber)" } : undefined}>
            <Shield strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <h2>事项级保全</h2>
            <div className="desc truncate">
              {activeProperties.length > 0 ? `在保 ${activeProperties.length} 项` : "暂无在保财产"}
              {expiringCount > 0 ? ` · 30 天内到期 ${expiringCount} 项` : ""} · 事项级记录
            </div>
          </div>
          <div className="acts">
            {canManage ? (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  新建保全
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
      <div className="panel-body" style={{ paddingTop: 4 }}>
      {cases.length === 0 ? (
        <EmptyState compact icon={Shield} title="本事项尚无财产保全记录" />
      ) : (
        <div className="space-y-3">
          {cases.map((item) => (
            <div key={item.id} className="rounded-[10px] border border-[var(--bd-hair)] bg-card">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--bd-hair)] px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">{PRES_TYPE_CN[item.type]}</span>
                    {item.court && <span className="text-[11px] text-muted-foreground">{item.court}</span>}
                    {item.rulingNumber && (
                      <span className="font-mono text-[10.5px] text-muted-foreground">{item.rulingNumber}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                    {item.guaranteeType ? GUARANTEE_TYPE_CN[item.guaranteeType] : "未填写担保方式"}
                    {item.owner?.name ? ` · ${item.owner.name}` : ""}
                  </div>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAddTargetCaseId(item.id)}
                    className="h-7 gap-1 px-2 text-[11px]"
                  >
                    <Plus className="h-3 w-3" />
                    被保全人
                  </Button>
                )}
              </div>

              <div className="space-y-3 p-3">
                {item.targets.length === 0 ? (
                  <p className="py-3 text-center text-xs text-muted-foreground">暂无被保全人</p>
                ) : (
                  item.targets.map((target) => (
                    <div key={target.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Landmark className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">{target.name}</span>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setAddPropertyTargetId(target.id)}
                            className="ml-auto text-[11px] text-primary hover:underline"
                          >
                            + 添加财产
                          </button>
                        )}
                      </div>
                      {target.properties.length === 0 ? (
                        <p className="pl-6 text-[11px] text-muted-foreground">暂无财产</p>
                      ) : (
                        <div className="space-y-1.5 pl-6">
                          {target.properties.map((property) => (
                            <PreservationPropertyRow
                              key={property.id}
                              property={property}
                              onRenew={() => setRenewPropertyId(property.id)}
                              onLift={() => handleLift(property.id)}
                              canManage={canManage}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      </div>
    </div>


      <PreservationCaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        matters={[matterOption]}
        users={users}
        initialMatterId={matter.id}
      />
      {addTargetCaseId && (
        <AddTargetDialog
          open={!!addTargetCaseId}
          onOpenChange={(open) => !open && setAddTargetCaseId(null)}
          caseId={addTargetCaseId}
        />
      )}
      {addPropertyTargetId && (
        <AddPropertyDialog
          open={!!addPropertyTargetId}
          onOpenChange={(open) => !open && setAddPropertyTargetId(null)}
          targetId={addPropertyTargetId}
        />
      )}
      {renewableProperty && (
        <RenewPropertyDialog
          open={!!renewPropertyId}
          onOpenChange={(open) => !open && setRenewPropertyId(null)}
          property={renewableProperty}
        />
      )}
    </>
  );
}

function PreservationPropertyRow({
  property,
  onRenew,
  onLift,
  canManage
}: {
  property: WorkflowPreservationCase["targets"][number]["properties"][number];
  onRenew: () => void;
  onLift: () => void;
  canManage: boolean;
}) {
  const days = daysUntil(property.expiryDate);
  const expiry = classifyExpiry(days);
  const statusColor = PRES_STATUS_COLOR[property.status] ?? PRES_STATUS_COLOR.ACTIVE;
  const isActive = property.status === "ACTIVE" || property.status === "RENEWED";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--bd-hair)] bg-[var(--bg-hover)] px-2.5 py-2 text-[11.5px]">
      <span className="font-medium">{PROPERTY_TYPE_CN[property.propertyType]}</span>
      {property.amount && (
        <span className="font-mono text-muted-foreground tabular">
          {formatCurrency(Number(property.amount), { compact: true })}
        </span>
      )}
      {property.propertyDetail && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{property.propertyDetail}</span>
      )}
      <span
        className={cn(
          "ml-auto shrink-0 font-medium",
          expiry.tone === "danger" && "text-[var(--red)]",
          expiry.tone === "warn" && "text-[var(--amber)]",
          expiry.tone === "ok" && "text-[var(--green)]"
        )}
      >
        {expiry.label}
      </span>
      <span
        className="shrink-0 rounded border px-1.5 py-0 text-[9px]"
        style={{
          borderColor: statusColor.border,
          color: statusColor.text,
          backgroundColor: statusColor.bg
        }}
      >
        {PRES_STATUS_CN[property.status]}
      </span>
      {canManage && isActive && (
        <>
          <button type="button" onClick={onRenew} className="shrink-0 text-primary hover:underline">
            续保
          </button>
          <button type="button" onClick={onLift} className="shrink-0 text-muted-foreground hover:text-foreground">
            解除
          </button>
        </>
      )}
    </div>
  );
}

function StageMaterialsPanel({
  matterId,
  procedure,
  stage,
  documents,
  canManage,
  onOpenTemplate,
  onRequestUpload,
  uploadSignal = 0,
  bare = false
}: {
  matterId: string;
  procedure: WorkflowProcedure | null;
  stage: WorkflowStage | null;
  documents: WorkflowDocument[];
  canManage: boolean;
  /** 嵌在环节页签内：不包卡片、不重复标题 */
  bare?: boolean;
  /** v1.1 UI（方案 D）：模板生成收口到材料区的单一入口 */
  onOpenTemplate?: () => void;
  onRequestUpload?: () => void;
  /** 页头「上传材料」递增信号：打开本环节上传弹窗 */
  uploadSignal?: number;
}) {
  const router = useRouter();
  const fieldId = useId();
  const stageName = stage?.name ?? "事项材料";
  const uploadScopeTitle = stage?.name ?? (procedure ? "程序材料" : "事项材料");
  const uploadScopeDescription = procedure && stage ? "文件将关联到当前程序，并自动归入本环节。"
    : procedure ? "文件将保存到当前程序，暂不归入具体环节。" : "文件将保存到当前事项。";
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadRequest = useRef<{ signature: string; key: string } | null>(null);
  const currentTarget = { matterId, procedureId: procedure?.id ?? null, stageKey: stage?.key ?? null, stageId: stage?.id ?? null, canManage };
  const currentTargetRef = useRef(currentTarget);
  useEffect(() => { currentTargetRef.current = currentTarget; });
  const [uploadTarget, setUploadTarget] = useState<{
    matterId: string; procedureId: string | null; stageKey: string | null; stageId: string | null;
    stageName: string; title: string; description: string; sourceOptions: string[];
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [customName, setCustomName] = useState("");
  const [sourceParty, setSourceParty] = useState("");
  const [sourceOrigin, setSourceOrigin] = useState<DocumentSourceOrigin | "">("");
  const [originFilter, setOriginFilter] = useState<DocumentSourceOrigin | "ALL">("ALL");
  const [category, setCategory] = useState<DocumentCategory>(defaultCategoryForStage(stageName));
  const [isPending, startTransition] = useTransition();
  const sourceOptions = useMemo(() => procedure ? buildSourceOptions(procedure) : [], [procedure]);

  function targetIsCurrent(target: NonNullable<typeof uploadTarget>) {
    const current = currentTargetRef.current;
    return current.canManage && current.matterId === target.matterId && current.procedureId === target.procedureId &&
      (current.stageKey === target.stageKey || (target.stageId !== null && current.stageId === target.stageId));
  }

  function openUploadDialog() {
    if (!canManage) return;
    if (open) { toast.info("请先处理已打开的上传草稿"); return; }
    setUploadTarget({ matterId, procedureId: procedure?.id ?? null, stageKey: stage?.key ?? null, stageId: stage?.id ?? null,
      stageName, title: uploadScopeTitle, description: uploadScopeDescription, sourceOptions });
    setCategory(defaultCategoryForStage(stageName));
    setSourceParty("");
    setSourceOrigin("");
    setPicked(null);
    uploadRequest.current = null;
    setCustomName("");
    if (fileRef.current) fileRef.current.value = "";
    setOpen(true);
  }

  function submitUpload() {
    const target = uploadTarget;
    if (!target || !targetIsCurrent(target)) {
      toast.error("上传目标已变化，请返回原程序和环节核对草稿");
      return;
    }
    if (!picked) {
      toast.warning("请先选择文件");
      return;
    }
    startTransition(async () => {
      try {
        let submissionTarget = target;
        // v0.48: 材料按外键归属环节；虚拟环节先物化拿到真实 stageId
        let stageId = submissionTarget.stageId;
        if (submissionTarget.procedureId && submissionTarget.stageKey && !stageId) {
          const ensured = await ensureProcedureStage({
            procedureId: submissionTarget.procedureId,
            name: submissionTarget.stageName,
            description: "",
            insertPosition: "END"
          });
          stageId = ensured.id;
          submissionTarget = { ...submissionTarget, stageId };
          setUploadTarget(submissionTarget);
        }
        if (!targetIsCurrent(submissionTarget)) throw new Error("上传目标已变化，请返回原程序和环节核对草稿");
        const fd = new FormData();
        fd.set("matterId", submissionTarget.matterId);
        if (submissionTarget.procedureId) fd.set("procedureId", submissionTarget.procedureId);
        if (stageId) fd.set("stageId", stageId);
        fd.set("file", picked);
        fd.set("category", category);
        fd.set("name", customName.trim() || picked.name);
        fd.set("tags", submissionTarget.stageKey ? stageMaterialTag(submissionTarget.stageName) : "");
        if (SOURCE_MATERIAL_CATEGORIES.includes(category) && sourceParty) {
          fd.set("sourceParty", sourceParty);
        }
        if (sourceOrigin) fd.set("sourceOrigin", sourceOrigin);
        const signature = JSON.stringify([picked.name, picked.size, picked.lastModified, customName.trim(), category, sourceParty, sourceOrigin, stageId]);
        if (uploadRequest.current?.signature !== signature) uploadRequest.current = { signature, key: crypto.randomUUID() };
        fd.set("requestKey", uploadRequest.current.key);
        await uploadDocument(fd);
        uploadRequest.current = null;
        toast.success("材料已保存，等待处理");
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error("上传失败", { description: actionErrorMessage(err) });
        router.refresh();
      }
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (uploadSignal > 0 && canManage) openUploadDialog(); }, [uploadSignal]);

  const originCounts = documents.reduce<Partial<Record<DocumentSourceOrigin, number>>>((acc, d) => {
    if (d.sourceOrigin) acc[d.sourceOrigin] = (acc[d.sourceOrigin] ?? 0) + 1;
    return acc;
  }, {});
  const isWritten = (d: WorkflowDocument) => Boolean(d.templateId) || d.category === "PLEADING" || d.category === "JUDGMENT";
  const writtenCount = documents.filter(isWritten).length;
  const [writtenOnly, setWrittenOnly] = useState(false);
  const [evidenceOnly, setEvidenceOnly] = useState(false);
  const { evidenceByDoc } = useDocActions();
  const evidenceDocCount = documents.filter((d) => (evidenceByDoc?.get(d.id)?.length ?? 0) > 0).length;
  const shownDocs = (originFilter === "ALL" ? documents : documents.filter((d) => d.sourceOrigin === originFilter))
    .filter((d) => !writtenOnly || isWritten(d))
    .filter((d) => !evidenceOnly || (evidenceByDoc?.get(d.id)?.length ?? 0) > 0);

  const originChips = (
  <>
          {(Object.keys(originCounts) as DocumentSourceOrigin[]).map((origin, i) => (
            <button
              key={origin}
              type="button"
              onClick={() => setOriginFilter((v) => (v === origin ? "ALL" : origin))}
              className={cn("src-chip cursor-pointer", originFilter === origin && documentSourceChip[origin].kind !== "team" && documentSourceChip[origin].kind)}
              aria-pressed={originFilter === origin}
            >
              {i === 0 ? "来源：" : ""}
              <b style={{ fontWeight: i === 0 ? 600 : 550 }}>{documentSourceChip[origin].label} {originCounts[origin]}</b>
            </button>
          ))}
  </>
  );

  return (
    <div className={bare ? undefined : "card"}>
      {/* 头部两行：标题与操作按钮固定一行，筛选标签单独一行（窄宽度下不再挤乱） */}
      <div className={cn("panel-head", bare && "!border-b-0 !pb-1")}>
        <div className="panel-title min-w-0">
          <FileText className="ic" strokeWidth={1.8} />
          材料
          <span className="badge b-white" style={{ marginLeft: 2 }}>{documents.length}</span>
        </div>
        <div className="flex shrink-0 items-center gap-[7px]">
          {canManage && onOpenTemplate ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenTemplate}>
              <Sparkles />
              从模板生成
            </button>
          ) : null}
          {canManage ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRequestUpload ?? openUploadDialog}>
              <Upload />
              上传
            </button>
          ) : null}
        </div>
      </div>
      {documents.length > 0 ? (
        <div className="dos-mat-filters" role="group" aria-label="材料筛选">
          <button
            type="button"
            className={cn("src-chip cursor-pointer", !writtenOnly && !evidenceOnly && originFilter === "ALL" && "self")}
            aria-pressed={!writtenOnly && !evidenceOnly && originFilter === "ALL"}
            onClick={() => { setWrittenOnly(false); setEvidenceOnly(false); setOriginFilter("ALL"); }}
          >
            <b style={{ fontWeight: 550 }}>全部 {documents.length}</b>
          </button>
          {evidenceDocCount > 0 ? (
            <button type="button" className={cn("src-chip cursor-pointer", evidenceOnly && "self")} aria-pressed={evidenceOnly} onClick={() => setEvidenceOnly((v) => !v)}>
              <b style={{ fontWeight: 550 }}>有证据要点 {evidenceDocCount}</b>
            </button>
          ) : null}
          {writtenCount > 0 ? (
            <button type="button" className={cn("src-chip cursor-pointer", writtenOnly && "self")} aria-pressed={writtenOnly} onClick={() => setWrittenOnly((v) => !v)}>
              <b style={{ fontWeight: 550 }}>文书 {writtenCount}</b>
            </button>
          ) : null}
          {Object.keys(originCounts).length ? <span className="dos-mat-sep" aria-hidden /> : null}
          {originChips}
        </div>
      ) : null}

      {shownDocs.length === 0 ? (
        <EmptyState compact icon={FileText}
          title={documents.length > 0 ? "没有符合筛选条件的材料" : stage ? "本环节暂无材料" : procedure ? "本程序暂无材料" : "本事项暂无材料"}
          description={documents.length > 0 ? "调整上方筛选条件可查看其他材料。" : canManage ? uploadScopeDescription : undefined} />
      ) : (
        shownDocs.map((doc) => <DocRow key={doc.id} doc={doc} />)
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>上传材料 · {uploadTarget?.title ?? uploadScopeTitle}</DialogTitle>
            <DialogDescription className="text-xs">
              {uploadTarget?.description ?? uploadScopeDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {uploadTarget && (!canManage || matterId !== uploadTarget.matterId || (procedure?.id ?? null) !== uploadTarget.procedureId || ((stage?.key ?? null) !== uploadTarget.stageKey && (uploadTarget.stageId === null || stage?.id !== uploadTarget.stageId))) ? <p role="alert" className="text-sm text-destructive">上传目标已变化，请返回原程序和环节核对草稿。</p> : null}
            <div className="space-y-1.5">
              <Label className="text-xs">材料类别 *</Label>
              <Select value={category} onValueChange={(value) => setCategory(value as DocumentCategory)}>
                <SelectTrigger className="h-10 bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORY_OPTIONS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {documentCategoryLabel[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">材料来源</Label>
              <Select value={sourceOrigin || "__none__"} onValueChange={(value) => setSourceOrigin(value === "__none__" ? "" : (value as DocumentSourceOrigin))}>
                <SelectTrigger>
                  <SelectValue placeholder="选择材料来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不标注</SelectItem>
                  {(Object.keys(documentSourceChip) as DocumentSourceOrigin[]).map((origin) => (
                    <SelectItem key={origin} value={origin}>
                      {documentSourceChip[origin].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {SOURCE_MATERIAL_CATEGORIES.includes(category) && (uploadTarget?.sourceOptions ?? sourceOptions).length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">归属/来源（可选）</Label>
                <Select
                  value={sourceParty || "__none__"}
                  onValueChange={(value) => setSourceParty(value === "__none__" ? "" : value)}
                >
                  <SelectTrigger className="h-10 bg-background">
                    <SelectValue placeholder="选择归属/来源" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">不标注</SelectItem>
                    {(uploadTarget?.sourceOptions ?? sourceOptions).map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor={`${fieldId}-file`}>文件 *</Label>
              <Input
                id={`${fieldId}-file`}
                ref={fileRef}
                type="file"
                onChange={(event) => { uploadRequest.current = null; setPicked(event.target.files?.[0] ?? null); }}
              />
              {picked && (
                <p className="text-[10px] text-muted-foreground">
                  已选 {picked.name}（{(picked.size / 1024).toFixed(0)} KB）
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">显示名（可选）</Label>
              <Input
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder={`${stageName}材料`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              取消
            </Button>
            <Button onClick={submitUpload} disabled={isPending || !picked || !uploadTarget || !canManage || matterId !== uploadTarget.matterId || (procedure?.id ?? null) !== uploadTarget.procedureId || ((stage?.key ?? null) !== uploadTarget.stageKey && (uploadTarget.stageId === null || stage?.id !== uploadTarget.stageId))} className="gap-1.5">
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              上传
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function StageCreateDialog({
  open,
  onOpenChange,
  procedureId,
  procedureType,
  procedureLabel,
  stages,
  selectedItem,
  onCreated
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  procedureId: string;
  procedureType: ProcedureType;
  procedureLabel: string;
  stages: WorkflowStage[];
  selectedItem: WorkflowItem | null;
  onCreated: (stageId: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [presetName, setPresetName] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [customName, setCustomName] = useState("");
  const [description, setDescription] = useState("");
  const [insertTarget, setInsertTarget] = useState("END");
  const existingNameSet = useMemo(
    () => new Set(stages.map((item) => normalizeProcedureStageName(item.name))),
    [stages]
  );
  const availablePresets = useMemo(
    () =>
      procedureStagePresetsForProcedure(procedureType).filter(
        (preset) => !existingNameSet.has(normalizeProcedureStageName(preset.name))
      ),
    [existingNameSet, procedureType]
  );
  const selectedPreset = availablePresets.find((preset) => preset.name === presetName) ?? null;
  const stageName = customMode ? customName.trim() : selectedPreset?.name ?? "";
  const duplicate = stageName ? existingNameSet.has(normalizeProcedureStageName(stageName)) : false;

  useEffect(() => {
    if (open) {
      const firstPreset = availablePresets[0];
      setPresetName(firstPreset?.name ?? "");
      setCustomMode(!firstPreset);
      setCustomName("");
      setDescription("");
      setInsertTarget(defaultInsertTarget(selectedItem));
    }
  }, [availablePresets, open, selectedItem]);

  async function close() {
    if (isPending) return;
    const dirty = Boolean(customName || description || customMode || presetName !== (availablePresets[0]?.name ?? "") || insertTarget !== defaultInsertTarget(selectedItem));
    if (dirty && !await confirmDialog({ title: "放弃未保存的环节？", confirmText: "放弃修改", cancelText: "继续编辑", initialFocus: "cancel" })) return;
    onOpenChange(false);
  }

  function submit() {
    if (!stageName) {
      toast.warning("请填写环节名称");
      return;
    }
    if (duplicate) {
      toast.warning("该环节已在列表中");
      return;
    }
    startTransition(async () => {
      try {
        const insert = parseInsertTarget(insertTarget, stages);
        const created = await createProcedureStage({
          procedureId,
          name: stageName,
          description: customMode ? description : description || selectedPreset?.description || "",
          insertPosition: insert.position,
          insertAfterStageId: insert.afterStageId,
          insertAfterStageName: insert.afterStageName
        });
        toast.success("环节已添加");
        onCreated(created.id);
        onOpenChange(false);
        router.refresh();
      } catch (err) {
        toast.error("添加失败", { description: actionErrorMessage(err) });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) void close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>添加环节 · {procedureLabel}</DialogTitle>
          <DialogDescription className="text-xs">
            优先选择预设环节；确实覆盖不到时再使用自定义。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!customMode ? (
            <div className="space-y-1.5">
              <Label className="text-xs">预设环节 *</Label>
              {availablePresets.length > 0 ? (
                <Select value={presetName} onValueChange={setPresetName}>
                  <SelectTrigger className="h-10 bg-background">
                    <SelectValue placeholder="选择预设环节" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePresets.map((preset) => (
                      <SelectItem key={preset.name} value={preset.name}>
                        {preset.name} · {preset.kind === "required" ? "必备" : "可选"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  预设环节已全部加入当前程序。
                </p>
              )}
              {selectedPreset && (
                <p className="text-[10.5px] leading-5 text-muted-foreground">{selectedPreset.description}</p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label className="text-xs">自定义环节名称 *</Label>
              <Input
                value={customName}
                onChange={(event) => setCustomName(event.target.value)}
                placeholder="如：二次庭询 / 专家论证 / 履行谈判"
              />
              {duplicate && <p className="text-[10px] text-[var(--amber)]">该环节已在列表中</p>}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">插入位置</Label>
            <Select value={insertTarget} onValueChange={setInsertTarget}>
              <SelectTrigger className="h-10 bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="START">放在最前</SelectItem>
                <SelectItem value="END">放在最后</SelectItem>
                {stages.map((stage) => (
                  <SelectItem key={stage.key} value={stage.id ? `AFTER_ID:${stage.id}` : `AFTER_NAME:${stage.name}`}>
                    放在「{stage.name}」之后
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">说明（可选）</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={customMode ? "记录该环节的目标或注意事项" : selectedPreset?.description ?? ""}
            />
          </div>
          <button
            type="button"
            onClick={() => setCustomMode((value) => !value)}
            className="text-[11px] text-primary hover:underline"
          >
            {customMode ? "返回预设环节" : "预设没有覆盖，添加自定义环节"}
          </button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => void close()} disabled={isPending}>
            取消
          </Button>
          <Button
            onClick={submit}
            disabled={isPending || duplicate || !stageName}
            className="gap-1.5"
          >
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultInsertTarget(selectedItem: WorkflowItem | null) {
  if (!selectedItem) return "START";
  return selectedItem.id ? `AFTER_ID:${selectedItem.id}` : `AFTER_NAME:${selectedItem.name}`;
}

function parseInsertTarget(target: string, stages: WorkflowStage[]) {
  if (target === "START") {
    return { position: "START" as const, afterStageId: "", afterStageName: "" };
  }
  if (target.startsWith("AFTER_ID:")) {
    return {
      position: "AFTER" as const,
      afterStageId: target.slice("AFTER_ID:".length),
      afterStageName: ""
    };
  }
  if (target.startsWith("AFTER_NAME:")) {
    const name = target.slice("AFTER_NAME:".length);
    return {
      position: "AFTER" as const,
      afterStageId: "",
      afterStageName: stages.find((stage) => stage.name === name)?.name ?? name
    };
  }
  return { position: "END" as const, afterStageId: "", afterStageName: "" };
}

function buildWorkflowStages(procedure: WorkflowProcedure | null): WorkflowStage[] {
  if (!procedure) return [];
  const visible = procedure.stages.filter(stage => stage.status !== "HIDDEN");
  if (visible.length) return visible.map(stage => ({
    key: `stage-${stage.id}`, id: stage.id, name: stage.name, kind: "normal",
    presetKind: stagePresetForName(procedure.type, stage.name)?.kind ?? "custom",
    removable: stagePresetForName(procedure.type, stage.name)?.kind !== "required",
    status: stage.completedAt ? "done" : stage.startedAt ? "active" : "todo",
    tasks: stage.tasks, badge: null
  }));
  return defaultStageNamesForProcedure(procedure.type).map((name, index) => ({
    key: `default-${index}-${name}`, id: null, name, kind: "normal", presetKind: "required", removable: false,
    status: "todo", tasks: [], badge: null
  }));
}

function shortDay(date: Date): string {
  return shMonthDay(date);
}

/** 徽标天数：逾期显示「逾期 N 天」，否则「N 天」 */


function stageGuideFor(stageName: string) {
  return STAGE_GUIDES.find((item) => item.keys.some((key) => stageName.includes(key)))?.guide ??
    DEFAULT_STAGE_GUIDE;
}

function stageMaterialTag(stageName: string) {
  return `阶段:${stageName}`;
}

function documentMatchesStage(
  document: WorkflowDocument,
  stage: { id: string | null; name: string }
) {
  // A matching name, category or tag is not proof of a material's stage.
  return stage.id !== null && document.stageId === stage.id;
}

function defaultCategoryForStage(stageName: string): DocumentCategory {
  return stageGuideFor(stageName).defaultCategory;
}

function buildSourceOptions(procedure: WorkflowProcedure) {
  const seen = new Set<string>([COURT_PROCEDURE_SOURCE]);
  const partyOptions = [...procedure.procedureParties]
    .sort((a, b) => a.ordinal - b.ordinal || a.party.name.localeCompare(b.party.name, "zh-Hans-CN"))
    .map((row) => {
      const name = row.party.name.trim();
      if (!name) return null;
      return `${litigationStandingLabel[row.standing] ?? row.standing}·${name}`;
    })
    .filter((label): label is string => {
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    });
  return [COURT_PROCEDURE_SOURCE, ...partyOptions];
}

function documentPreviewUrl(document: Pick<WorkflowDocument, "id" | "mimeType" | "name">) {
  if (officePreviewKind(document.mimeType, document.name)) {
    return `/api/documents/${document.id}/preview`;
  }
  if (canPreview(document.mimeType, document.name)) {
    return `/api/documents/${document.id}/download?inline=1`;
  }
  return null;
}


const documentCategoryLabel: Record<DocumentCategory, string> = {
  EVIDENCE: "证据",
  PLEADING: "诉辩文件",
  PROCEDURE: "程序文件",
  JUDGMENT: "裁决",
  CONTRACT: "合同",
  OTHER: "其他"
};
