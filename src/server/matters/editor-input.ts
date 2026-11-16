import { LitigationStanding, MatterMemberRole, PartyRole, PartyType } from "@prisma/client";
import { z } from "zod";
import { PERSON_ID_TYPES } from "@/lib/clients/person-id";
import { matterUpdateBasicSchema } from "./schemas";

export const matterBasicEditSchema = matterUpdateBasicSchema.extend({
  expectedUpdatedAt: z.date()
}).strict();
export type MatterBasicEditInput = z.input<typeof matterBasicEditSchema>;

export const matterTeamEditSchema = z.object({
  matterId: z.string().cuid(),
  expectedOwnerId: z.string().cuid(),
  expectedMembers: z.array(z.object({ userId: z.string().cuid(), role: z.enum(MatterMemberRole) }).strict()),
  coLeadIds: z.array(z.string().cuid()),
  assistantIds: z.array(z.string().cuid())
}).strict().superRefine((value, ctx) => {
  const ids = [...value.coLeadIds, ...value.assistantIds];
  if (ids.includes(value.expectedOwnerId) || new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "每人只能担任一种成员角色；主办请使用交接流程" });
  }
  if (new Set(value.expectedMembers.map(member => member.userId)).size !== value.expectedMembers.length) {
    ctx.addIssue({ code: "custom", message: "原承办成员数据重复，请刷新后重试" });
  }
});
export type MatterTeamEditInput = z.input<typeof matterTeamEditSchema>;

const partyIdentity = {
  name: z.string().trim().min(1, "当事人名称必填").max(200),
  role: z.enum(PartyRole),
  partyType: z.enum(PartyType),
  idType: z.enum(PERSON_ID_TYPES).nullable(),
  idNumber: z.string().trim().max(100),
  enterpriseSocialCode: z.string().trim().max(100)
};
const updatedParty = z.object({
  partyId: z.string().cuid(),
  expectedUpdatedAt: z.date(),
  ...partyIdentity,
  legalRep: z.string().trim().max(200),
  contactName: z.string().trim().max(200),
  phone: z.string().trim().max(100),
  address: z.string().trim().max(1000)
}).strict();
const newParty = z.object({
  ...partyIdentity,
  standings: z.array(z.enum(LitigationStanding)).min(1, "请选择程序地位")
}).strict();

export const procedureInfoEditSchema = z.object({
  procedureId: z.string().cuid(),
  expectedUpdatedAt: z.date(),
  jurisdiction: z.string().trim().max(200).optional(),
  handlingAgency: z.string().trim().max(200).optional(),
  caseNumber: z.string().trim().max(200).optional(),
  presidingJudge: z.string().trim().max(100).optional(),
  presidingJudgeContact: z.string().trim().max(200).optional(),
  judgeAssistant: z.string().trim().max(100).optional(),
  judgeAssistantContact: z.string().trim().max(200).optional(),
  ourStanding: z.enum(LitigationStanding).nullable().optional(),
  acceptedAt: z.coerce.date().nullable().optional(),
  concludedAt: z.coerce.date().nullable().optional(),
  procedureParties: z.array(z.object({
    partyId: z.string().min(1), standing: z.enum(LitigationStanding)
  }).strict()).optional(),
  updatedParties: z.array(updatedParty).default([]),
  newProcedureParties: z.array(newParty).default([])
}).strict();
export type ProcedureInfoEditInput = z.input<typeof procedureInfoEditSchema>;
