'use server';
import {z} from 'zod';
import {hasCustomPermission} from '@/lib/roles/catalog';
import {decryptIdNumber} from '@/lib/clients/id-number-crypto';
import {readWorkRows} from '@/server/reminders/responsibility';
import {Prisma} from '@prisma/client';
import {revalidatePath} from 'next/cache';
import {requireSession} from '@/lib/auth/session';
import {approvalTransaction} from '@/lib/approvals/service';
import {clientVisibilityFilter} from '@/lib/permissions';
import {normalizeIdNumber,duplicateWhereInput,suggestIdType} from '@/lib/clients/identity';
import {sealIdNumber} from '@/lib/clients/id-number-crypto';
import {assertAgencyAllowedForProcedure,normalizeJurisdictionForAgency} from '@/lib/china-regions';
import {assertCauseAllowedForSelection} from '@/server/causes/validation';
import {auditTx} from '@/server/audit';
import {intakeCreateSchema,type IntakeCreateInput} from './schemas';
import {currentActor,intakeWorkflowReady,assertIntakeEditor,assertLiveAssignees,intakeFields,withdrawIntakeTx,intakeState} from './workflow';
import { ActionError } from "@/lib/action-error";
export async function getIntakeEditForm(id:string){
 const session=await requireSession('matters.write');
 return approvalTransaction(async db=>{
  if(!await intakeWorkflowReady(db))throw new ActionError('补正表单尚未启用');
  await assertIntakeEditor(db,session.user.id,id);
  const actor=await currentActor(db,session.user.id,'matters.write');
  if(actor.role!==session.user.role)throw new ActionError('账号或岗位已变化，请刷新后重试');
  const {intake:i}=await intakeState(db,id);
  const [revision]=await db.$queryRaw<{revision:number}[]>`SELECT "workflowRevision" AS revision FROM "Intake" WHERE id=${id}`;
  const plain=JSON.parse(JSON.stringify(i)) as Record<string,unknown>;
  const values=Object.fromEntries(intakeFields.map(k=>[k,plain[k]??undefined]));
  const canFinance=hasCustomPermission(actor,'finance.read')&&hasCustomPermission(actor,'finance.write');
  if(!canFinance)for(const k of ['feeType','feeAmount','contingencyTerms','feeSchedule','feeNote'])values[k]=undefined;
  const client=i.parties.find(p=>p.role==='CLIENT_PARTY');
  const parties=i.parties.map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,v===null?undefined:v])));
  return {revision:revision.revision,values:({...values,claimAmount:i.claimAmount?.toNumber(),feeAmount:canFinance?i.feeAmount?.toNumber():undefined,clientName:client?.name??i.client?.name??'',clientType:i.clientType??i.client?.type,clientIdNumber:client?.idNumber??client?.enterpriseSocialCode??'',parties}) as Partial<IntakeCreateInput>};
 },Prisma.TransactionIsolationLevel.ReadCommitted);
}
export async function saveIntakeRevision(id:string,revision:number,input:IntakeCreateInput){
 const session=await requireSession('matters.write'),data=intakeCreateSchema.parse(input);z.number().int().nonnegative().parse(revision);
 assertAgencyAllowedForProcedure(data.firstAgency,data.firstProcedureType);
 await assertCauseAllowedForSelection({causeId:data.causeId,category:data.category,procedureType:data.firstProcedureType});
 await approvalTransaction(async db=>{
  if(!await intakeWorkflowReady(db))throw new ActionError('补正表单尚未启用');
  await assertIntakeEditor(db,session.user.id,id);
  const actor=await currentActor(db,session.user.id,'matters.write');
  if(actor.role!==session.user.role)throw new ActionError('账号或岗位已变化，请刷新后重试');
  const [version]=await db.$queryRaw<{revision:number}[]>`SELECT "workflowRevision" AS revision FROM "Intake" WHERE id=${id}`;
  if(version.revision!==revision)throw new ActionError('收案已被修改，请刷新后重试');
  await assertLiveAssignees(db,[data.ownerUserId||session.user.id,...data.coUserIds]);
  const current=await db.intake.findUniqueOrThrow({where:{id}});
  // 补正表单不得更换主办：换主办走「收案交接」（含接收人确认与留痕），
  // 且未显式传 ownerUserId 时保持现主办——此前默认回填提交人会让协办静默接管（2026-09-19 审计）。
  const nextOwnerUserId=data.ownerUserId||current.ownerUserId;
  if(nextOwnerUserId!==current.ownerUserId)throw new ActionError('更换收案主办请使用「收案交接」流程办理');
  const team=[current.createdById,nextOwnerUserId,...data.coUserIds];
  if((await readWorkRows(db)).some(w=>w.intakeId===id&&w.state==='OPEN'&&(!team.includes(w.assigneeId)||(w.proposedAssigneeId&&!team.includes(w.proposedAssigneeId)))))throw new ActionError('移除经办前请完成其紧急事项交接');
  if(!hasCustomPermission(actor,'finance.write')||!hasCustomPermission(actor,'finance.read'))Object.assign(data,{feeType:current.feeType??undefined,feeAmount:current.feeAmount?.toNumber(),contingencyTerms:current.contingencyTerms??undefined,feeSchedule:current.feeSchedule??undefined,feeNote:current.feeNote??undefined});
  let clientId=data.clientId||null;
  if(clientId){await db.$queryRaw`SELECT id FROM "Client" WHERE id=${clientId} FOR UPDATE`;if(!await db.client.count({where:{id:clientId,deletedAt:null,...clientVisibilityFilter(session.user.id,actor.role,actor.rolePermissions)}}))throw new ActionError('客户不存在或无权关联');const c=await db.client.findUniqueOrThrow({where:{id:clientId}}),number=normalizeIdNumber(decryptIdNumber(c.idNumber)),supplied=normalizeIdNumber(data.clientIdNumber);if(c.idNumber&&!number)throw new ActionError('客户证件信息无法读取，请联系管理员核对');if((current.clientId!==clientId&&data.clientName?.trim()&&data.clientName.trim()!==c.name)||(data.clientType&&c.type!==data.clientType)||(number&&supplied&&number!==supplied)||(number&&supplied&&data.clientIdType&&c.idType&&data.clientIdType!==c.idType))throw new ActionError('委托方身份与所选客户不一致，请选择正确客户或另建客户');data.clientName=data.clientName?.trim()||c.name;data.clientType=c.type;if(number)data.clientIdNumber=number;if(c.idType)data.clientIdType=c.idType;}
  else {
   if(!data.clientName?.trim())throw new ActionError('请填写委托方');
   const number=normalizeIdNumber(data.clientIdNumber),idType=data.clientIdType||suggestIdType(data.clientType??'INDIVIDUAL');
   if(number&&idType&&await db.client.count({where:duplicateWhereInput({idType,idNumber:number})}))throw new ActionError('客户身份已存在，请选择已有客户');
   const c=await db.client.create({data:{ownerUserId:session.user.id,name:data.clientName,type:data.clientType??'INDIVIDUAL',idType, ...(number?sealIdNumber(number):{}),address:data.clientAddress||null,legalRep:data.clientLegalRep||null,phone:data.contactPhone||null}});clientId=c.id;
  }
  const update=Object.fromEntries(intakeFields.map(k=>[k,k==='title'?(data.title?.trim()||data.clientName||'待完善收案'):k==='clientId'?clientId:k==='ownerUserId'?nextOwnerUserId:k==='jurisdiction'?normalizeJurisdictionForAgency(data.firstAgency,data.jurisdiction):data[k]??null]));
  update.causeId=data.causeId||null;
  update.receivedAt=data.receivedAt??current.receivedAt;
  update.coUserIds=[...new Set(data.coUserIds)];update.counterclaim=data.counterclaim;
  await db.intake.update({where:{id},data:update as Prisma.IntakeUncheckedUpdateInput});
  // 名称兜底：clientId 模式下留空会生成空名 CLIENT_PARTY，抑制 buildIntakeConflictQueries 的客户档案检索分支
  const clientPartyName=data.clientName?.trim()||(clientId?await db.client.findUnique({where:{id:clientId},select:{name:true}}).then(c=>c?.name??''):'');
  const clientParty={role:'CLIENT_PARTY' as const,standing:data.ourStanding,ordinal:1,name:clientPartyName,partyType:data.clientType==='INDIVIDUAL'?'NATURAL_PERSON' as const:data.clientType==='ORGANIZATION'?'ORGANIZATION' as const:'COMPANY' as const,idType:data.clientIdType||undefined,idNumber:data.clientType==='INDIVIDUAL'?data.clientIdNumber:undefined,enterpriseSocialCode:data.clientType!=='INDIVIDUAL'?data.clientIdNumber:undefined,phone:data.contactPhone,address:data.clientAddress,legalRep:data.clientLegalRep,contactName:data.contactName};
  await db.party.deleteMany({where:{intakeId:id}});
  const normCode=<T extends string|null|undefined>(v:T):T=>typeof v==='string'&&v?v.trim().toUpperCase() as T:v;
  for(const p of [clientParty,...data.parties.filter(p=>p.role!=='CLIENT_PARTY')])await db.party.create({data:{...p,idNumber:normCode(p.idNumber),enterpriseSocialCode:normCode(p.enterpriseSocialCode),idType:p.partyType==='NATURAL_PERSON'?p.idType||'ID_CARD':null,intakeId:id} as Prisma.PartyUncheckedCreateInput});
  await db.$executeRaw`UPDATE "Intake" SET "workflowRevision"="workflowRevision"+1 WHERE id=${id}`;
  await auditTx(db,{userId:session.user.id,action:'INTAKE_REVISION_SAVE',targetType:'Intake',targetId:id,detail:{previousRevision:revision}});
 },Prisma.TransactionIsolationLevel.ReadCommitted);
 revalidatePath(`/intakes/${id}`);revalidatePath('/approvals');revalidatePath('/matters');return {ok:true,id,workflowEnabled:true};
}
export async function withdrawIntake(id:string,reason:string){const session=await requireSession('matters.write');await approvalTransaction(async db=>{if(!await intakeWorkflowReady(db))throw new ActionError('撤回补正功能尚未启用');return withdrawIntakeTx(db,session.user.id,id,z.string().trim().min(1).max(1000).parse(reason));});revalidatePath(`/intakes/${id}`);revalidatePath('/approvals');return {ok:true};}

/** A caption-only correction preserves party identities, intake materials and fee instructions. */
export async function reviseIntakeSummary(input: {
  id: string; revision: number; title: string; description: string;
}) {
  const session = await requireSession("matters.write");
  const { id, revision, title, description } = z.object({
    id: z.cuid(), revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(200), description: z.string().max(2000),
  }).parse(input);
  await approvalTransaction(async db => {
    if (!await intakeWorkflowReady(db)) throw new ActionError("收案补正尚未启用");
    await assertIntakeEditor(db, session.user.id, id);
    const { count } = await db.intake.updateMany({
      where: { id, workflowRevision: revision, status: { in: ["INTAKE", "NEEDS_REVISION"] } },
      data: { title, description: description || null, workflowRevision: { increment: 1 } },
    });
    if (count !== 1) throw new ActionError("收案已更新，请重新读取。");
    await auditTx(db, { userId: session.user.id, action: "INTAKE_REVISION_SAVE",
      targetType: "Intake", targetId: id, detail: { previousRevision: revision, fields: ["title", "description"] } });
  });
  revalidatePath(`/intakes/${id}`);
  revalidatePath("/approvals");
  revalidatePath("/matters");
  return { ok: true };
}
