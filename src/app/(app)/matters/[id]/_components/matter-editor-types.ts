import type { LitigationStanding, MatterCategory, PartyRole, PartyType, ProcedureType } from "@prisma/client";

export type UserOption = { id: string; name: string; role: string; roleName?: string; isTeammate?: boolean; active?: boolean };

export type MatterMeta = {
  updatedAt: Date;
  intakeDate: Date | null;
  category: MatterCategory;
  title: string;
  causeId: string | null;
  causeFreeText: string | null;
  claimAmount: number | null;
  ourStanding: LitigationStanding | null;
  teamAccessRestricted?: boolean;
};

export type ProcedureMeta = {
  id: string;
  updatedAt: Date;
  type: ProcedureType;
  customLabel: string | null;
  jurisdiction: string | null;
  handlingAgency: string | null;
  caseNumber: string | null;
  presidingJudge: string | null;
  presidingJudgeContact: string | null;
  judgeAssistant: string | null;
  judgeAssistantContact: string | null;
  ourStanding: LitigationStanding | null;
  acceptedAt: Date | null;
  concludedAt: Date | null;
  procedureParties: ProcedurePartyRow[];
};

export type PartyLite = {
  id: string;
  updatedAt: Date | null;
  role: PartyRole;
  standing: LitigationStanding | null;
  ordinal: number;
  name: string;
  partyType: PartyType;
  idType?: string | null;
  idNumber: string | null;
  phone: string | null;
  address: string | null;
  legalRep: string | null;
  contactName: string | null;
  enterpriseSocialCode: string | null;
};

export type ProcedurePartyRow = {
  id: string;
  partyId: string;
  standing: LitigationStanding;
  ordinal: number;
  party: PartyLite;
};

export type PartyEditDraft = {
  partyId: string;
  name: string;
  role: PartyRole;
  partyType: PartyType;
  idType: string;
  idNumber: string;
  enterpriseSocialCode: string;
  legalRep: string;
  contactName: string;
  phone: string;
  address: string;
};

export type NewProcedurePartyDraft = {
  tempId: string;
  name: string;
  role: PartyRole;
  partyType: PartyType;
  idType: string;
  idNumber: string;
  enterpriseSocialCode: string;
  standings: LitigationStanding[];
};

export type MatterEditorSection = "matter" | "procedure" | "parties" | "team";

export type TeamEditorDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  matterId: string;
  matterMeta: MatterMeta;
  currentProcedure?: ProcedureMeta | null;
  parties: PartyLite[];
  currentOwnerId: string;
  currentMembers: { userId: string; role: "LEAD" | "CO_LEAD" | "ASSISTANT"; name: string }[];
  userOptions: UserOption[];
  canEditMatterInfo: boolean;
  canManageTeam: boolean;
  canManageProcedure?: boolean;
  initialSection?: MatterEditorSection;
  onReturnFocus?: () => void;
  onOpenHandover?: () => void;
};


export type EditorFormActions = {
  onStateChange: (state: { dirty: boolean; pending: boolean }) => void;
  onSaved: () => void;
  onCancel: () => void;
};
