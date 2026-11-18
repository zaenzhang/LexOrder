"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Inbox, Gavel, Clock, CheckCircle2, Trash2, Link as LinkIcon, Briefcase, ExternalLink, Phone, Loader2, Sparkles, AlertCircle, ArrowRight, CalendarClock, FileCheck2, FileDigit, FileDown, KeyRound, Upload } from "lucide-react";
import { Button, Select, Tabs, Tag, Notification, Toast } from "@douyinfe/semi-ui";
import { cn, formatDateTime } from "@/lib/utils";
import {
  extractSmsAttachments,
  matchSmsToMatter,
  markSmsProcessed,
  deleteSms,
  uploadSmsInboundFile
} from "@/server/sms/actions";
import {
  SMS_TYPE_CN,
  SMS_TYPE_ACCENT,
  SMS_STATE_CN,
  SMS_STATE_ACCENT,
  SMS_FILE_STATE_CN,
  SMS_FILE_SOURCE_CN,
  SMS_ANALYSIS_CN,
  type SmsRow,
  type MatterOption,
  type ParsedJson
} from "./sms-types";
import { SmsSuggestions } from "./sms-suggestions";
import { SmsPasteDialog } from "./sms-paste-dialog";
import {
  BackfillCaseNumberDialog,
  GenerateHearingDialog,
  GenerateDeadlineDialog
} from "./sms-actions-dialogs";
import { matterHref } from "@/lib/matters/route";
import { PageHeader } from "@/components/patterns/moan";
import { confirmDialog } from "@/components/patterns/confirm-dialog";
import { useTopbarAction } from "@/components/layout/topbar-action";
import { useSearchParams, useRouter } from "next/navigation";
import { actionErrorMessage } from "@/lib/action-error";

type Tab = "unprocessed" | "needsManual" | "needsMatch" | "processed";

export function InboxView({
  unprocessed,
  processed,
  needsManual,
  needsMatch,
  matters
}: {
  unprocessed: SmsRow[];
  processed: SmsRow[];
  /** v0.48: 电子送达待人工处理（需登录/验证码/未关联案件） */
  needsManual: SmsRow[];
  /** B1 私有来件区：已取件、未匹配案件（先取件后匹配） */
  needsMatch?: SmsRow[];
  matters: MatterOption[];
}) {
  // 顶栏短信入口点「去处理」带 ?focus=<id> 过来：自动切到该条所在页签并高亮滚动到它
  const focusId = useSearchParams().get("focus");
  const focusTab: Tab | null = focusId
    ? unprocessed.some((s) => s.id === focusId)
      ? "unprocessed"
      : needsManual.some((s) => s.id === focusId)
        ? "needsManual"
        : (needsMatch ?? []).some((s) => s.id === focusId)
          ? "needsMatch"
          : processed.some((s) => s.id === focusId)
            ? "processed"
            : null
    : null;
  const [tab, setTab] = useState<Tab>(focusTab ?? (unprocessed.length > 0 ? "unprocessed" : "processed"));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [hearingTarget, setHearingTarget] = useState<{
    sms: SmsRow;
    matter: NonNullable<SmsRow["matchedMatter"]>;
  } | null>(null);
  const [deadlineTarget, setDeadlineTarget] = useState<{
    sms: SmsRow;
    matter: NonNullable<SmsRow["matchedMatter"]>;
  } | null>(null);
  const [backfillTarget, setBackfillTarget] = useState<{
    sms: SmsRow;
    matter: NonNullable<SmsRow["matchedMatter"]>;
  } | null>(null);

  const rows = tab === "unprocessed" ? unprocessed : tab === "needsManual" ? needsManual : tab === "needsMatch" ? (needsMatch ?? []) : processed;

  useTopbarAction({ label: "粘贴短信", onClick: () => setPasteOpen(true) }, []);

  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`sms-${focusId}`);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.classList.add("sms-focus");
    const timer = setTimeout(() => el.classList.remove("sms-focus"), 2400);
    return () => clearTimeout(timer);
  }, [focusId, tab]);

  return (
    <div className="space-y-5">
      <PageHeader
        className="!mb-0"
        title="法院短信"
        sub="粘贴 12368 / 法院短信 → 自动解析 → 一键生成开庭 / 期限"
      />

      <Tabs
        activeKey={tab}
        onChange={value => setTab(value as Tab)}
        tabPaneMotion={false}
        tabList={[
          { itemKey: "unprocessed", tab: <>待处理 <Count n={unprocessed.length} hot /></> },
          { itemKey: "needsManual", tab: <>待人工 <Count n={needsManual.length} hot /></> },
          { itemKey: "needsMatch", tab: <>待匹配 <Count n={(needsMatch ?? []).length} hot /></> },
          { itemKey: "processed", tab: <>已处理 <Count n={processed.length} /></> }
        ]}
      >
      <Tabs.TabPane itemKey={tab}>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="ll-surface rounded-lg border border-border p-12 text-center text-sm text-muted-foreground">
            <Inbox className="mx-auto mb-2 h-6 w-6 opacity-40" />
            {tab === "unprocessed"
              ? "无待处理短信"
              : tab === "needsManual"
                ? "没有需要人工处理的电子送达"
                : tab === "needsMatch"
                  ? "没有待匹配案件的来件（文件已安全保存在您的私有来件区）"
                  : "暂无已处理记录"}
          </div>
        ) : (
          rows.map((sms) => (
            <SmsCard
              key={sms.id}
              domId={`sms-${sms.id}`}
              sms={sms}
              matters={matters}
              onGenerateHearing={() => {
                if (sms.matchedMatter) setHearingTarget({ sms, matter: sms.matchedMatter });
              }}
              onGenerateDeadline={() => {
                if (sms.matchedMatter) setDeadlineTarget({ sms, matter: sms.matchedMatter });
              }}
              onBackfillCaseNumber={() => {
                if (sms.matchedMatter) setBackfillTarget({ sms, matter: sms.matchedMatter });
              }}
            />
          ))
        )}
      </div>
      </Tabs.TabPane>
      </Tabs>

      <SmsPasteDialog open={pasteOpen} onOpenChange={setPasteOpen} />

      {hearingTarget && (
        <GenerateHearingDialog
          open
          onOpenChange={(o) => !o && setHearingTarget(null)}
          sms={hearingTarget.sms}
          matter={hearingTarget.matter}
        />
      )}
      {deadlineTarget && (
        <GenerateDeadlineDialog
          open
          onOpenChange={(o) => !o && setDeadlineTarget(null)}
          sms={deadlineTarget.sms}
          matter={deadlineTarget.matter}
        />
      )}
      {backfillTarget && (
        <BackfillCaseNumberDialog
          open
          onOpenChange={(o) => !o && setBackfillTarget(null)}
          sms={backfillTarget.sms}
          matter={backfillTarget.matter}
        />
      )}
    </div>
  );
}

function Count({ n, hot }: { n: number; hot?: boolean }) {
  return n ? <Tag size="small" color={hot ? "amber" : "grey"}>{n}</Tag> : null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function SmsCard({
  sms,
  domId,
  matters,
  onGenerateHearing,
  onGenerateDeadline,
  onBackfillCaseNumber
}: {
  sms: SmsRow;
  domId?: string;
  matters: MatterOption[];
  onGenerateHearing: () => void;
  onGenerateDeadline: () => void;
  onBackfillCaseNumber: () => void;
}) {
  const parsed = normalizeParsedJson(sms);
  const accent = SMS_TYPE_ACCENT[sms.smsType];
  const [pending, startTransition] = useTransition();
  const [showRaw, setShowRaw] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const onMarkProcessed = () =>
    startTransition(async () => {
      try {
        await markSmsProcessed({ id: sms.id });
        Toast.success("已标记处理");
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "失败", duration: 6 });
      }
    });

  const onDelete = async () => {
    if (!(await confirmDialog({ title: "删除这条短信记录？", description: "删除后不可在列表中恢复。", confirmText: "删除", danger: true }))) return;
    startTransition(async () => {
      try {
        await deleteSms({ id: sms.id });
        Toast.success("已删除");
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "失败", duration: 6 });
      }
    });
  };

  // v0.51: 解析出新案号 + 案件里有缺案号的程序 → 可回填
  const usedCaseNumbers = new Set(
    (sms.matchedMatter?.procedures ?? []).map((p) => p.caseNumber).filter(Boolean) as string[]
  );
  const canBackfillCaseNumber = Boolean(
    sms.matchedMatter &&
      parsed.caseNumbers.some((n) => !usedCaseNumbers.has(n)) &&
      sms.matchedMatter.procedures.some((p) => !p.caseNumber)
  );

  const onExtractAttachments = () =>
    startTransition(async () => {
      try {
        const res = await extractSmsAttachments({ id: sms.id });
        const downloaded = res.attachmentResults.filter((r) => r.status === "DOWNLOADED").length;
        const needsManual = res.attachmentResults.filter((r) => r.status === "LOGIN_REQUIRED").length;
        Toast.success(downloaded > 0
            ? `已提取 ${downloaded} 个附件`
            : needsManual > 0
              ? "送达入口需要人工处理"
              : "附件提取已完成");
      } catch (e) {
        Notification.error({ title: e instanceof Error ? actionErrorMessage(e) : "提取失败", duration: 6 });
      }
    });

  return (
    <div id={domId} className="ll-surface rounded-lg border border-border p-4">
      {/* 头：类型徽 + 法院 + 案号 + 时间 + 来源标 */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ background: `${accent}1A`, color: accent }}
        >
          {SMS_TYPE_CN[sms.smsType]}
        </span>
        {sms.processingState && sms.processingState !== "READY_FOR_REVIEW" && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: `${SMS_STATE_ACCENT[sms.processingState]}14`, color: SMS_STATE_ACCENT[sms.processingState] }}
          >
            {SMS_STATE_CN[sms.processingState]}
          </span>
        )}
        {parsed.court && <span className="text-foreground/80">{parsed.court}</span>}
        {parsed.caseNumbers.length > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {parsed.caseNumbers.join("、")}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {formatDateTime(new Date(sms.receivedAt))}
        </span>
      </div>

      {/* 摘要 + AI 增强字段 */}
      <div className="mt-2 space-y-1">
        <div className="flex items-start gap-2">
          {parsed.aiEnriched && (
            <span
              className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
              title="AI 增强解析"
            >
              <Sparkles className="h-3 w-3" />
              AI
            </span>
          )}
          <p className="line-clamp-2 text-[13px] text-foreground/85">{parsed.summary}</p>
        </div>
        {parsed.action && (
          <div className="flex items-baseline gap-1.5 text-[12px]">
            <ArrowRight className="h-3 w-3 shrink-0 text-primary/70" />
            <span className="text-muted-foreground">应对：</span>
            <span className="text-foreground/90">{parsed.action}</span>
            {parsed.urgency && <UrgencyBadge level={parsed.urgency} />}
          </div>
        )}
      </div>

      {/* 字段栏 */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {parsed.hearingDate && (
          <Field icon={<Gavel className="h-3 w-3" />}>开庭：{parsed.hearingDate}</Field>
        )}
        {parsed.courtRoom && <Field>{parsed.courtRoom}</Field>}
        {parsed.judge && <Field>法官：{parsed.judge}</Field>}
        {parsed.clerk && <Field>书记员：{parsed.clerk}</Field>}
        {parsed.phones.map((p) => (
          <Field key={p} icon={<Phone className="h-3 w-3" />}>
            <a href={`tel:${p}`} className="hover:text-foreground">
              {p}
            </a>
          </Field>
        ))}
        {parsed.appealDeadline && <Field>上诉期：{parsed.appealDeadline}</Field>}
        {parsed.judgmentDate && <Field>判决日：{parsed.judgmentDate}</Field>}
        {parsed.urls.length > 0 &&
          parsed.urls.map((u, i) => (
            <Field key={u} icon={<ExternalLink className="h-3 w-3" />}>
              <a
                href={u}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {parsed.platforms[i] ?? `链接 ${i + 1}`}
              </a>
            </Field>
          ))}
      </div>

      {parsed.importantItems.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
            <CalendarClock className="h-3.5 w-3.5 text-primary" />
            重要事项
          </div>
          <div className="grid gap-1.5 md:grid-cols-2">
            {parsed.importantItems.slice(0, 4).map((item, i) => (
              <div
                key={`${item.kind}-${item.dateText ?? i}-${i}`}
                className="rounded-md border border-border/70 bg-muted/20 px-2.5 py-2"
              >
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="font-medium text-foreground/85">{item.title}</span>
                  {item.dateText && (
                    <span className="font-mono text-[10px] text-primary">{item.dateText}</span>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">
                  {item.sourceText}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* B1 来件文件清单：自动取件与人工补传统一列出，逐件状态（v3 §3.2「文件」块） */}
      {sms.inboundFiles?.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
            <FileCheck2 className="h-3.5 w-3.5 text-primary" />
            来件文件（{sms.inboundFiles.filter(f => f.state === "FILED").length}/{sms.inboundFiles.length} 已入卷）
          </div>
          <div className="space-y-1">
            {sms.inboundFiles.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-2.5 py-1.5 text-[11px]">
                <span className="font-medium text-foreground/85">{f.displayName ?? f.originalName}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{SMS_FILE_STATE_CN[f.state]}</span>
                <span className="text-[10px] text-muted-foreground">{SMS_FILE_SOURCE_CN[f.uploadSource]}</span>
                {f.analysisState && f.analysisState !== "PENDING" && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] ${f.analysisState === "ANALYZED" ? "bg-emerald-50 text-emerald-700" : f.analysisState === "NEEDS_OCR" || f.analysisState === "FAILED" ? "bg-amber-50 text-amber-700" : "bg-muted text-muted-foreground"}`} title={f.analysisError ?? undefined}>{SMS_ANALYSIS_CN[f.analysisState] ?? f.analysisState}{f.docType ? ` · ${f.docType}` : ""}</span>
                )}
                <span className="font-mono text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{formatDateTime(f.downloadedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <SmsSuggestions sms={sms} busy={pending || uploading} />

      {/* B1 人工接续：需登录/验证码平台的来件，律师平台下载后补传回本条（v3 §4.2） */}
      {(sms.processingState === "NEEDS_MANUAL_FETCH" || sms.inboundFiles.some(file => !file.documentId && ["PENDING_REVIEW", "FAILED"].includes(file.state))) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-[11px] text-muted-foreground">
            收件人可把实际取得的原件补传回本条来件；同内容补传可接续尚未入卷的文件。
          </span>
          <Button htmlType="button" theme="outline" type="tertiary" size="small" disabled={uploading || pending} loading={uploading} icon={<Upload className="h-3 w-3" />} onClick={() => uploadInput.current?.click()}>
            补传文件
          </Button>
            <input
              ref={uploadInput}
              aria-label="补传来件原件"
              type="file"
              multiple
              disabled={uploading || pending}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (!files.length) return;
                setUploading(true);
                const fd = new FormData();
                fd.set("smsId", sms.id);
                files.forEach((f) => fd.append("files", f));
                uploadSmsInboundFile(fd)
                  .then((res) => {
                    if (res.saved.length || res.replenished.length) Toast.success(`新增 ${res.saved.length} 个，补存原件 ${res.replenished.length} 个，入卷 ${res.filedFiles} 个`);
                    if (res.skippedDuplicates.length) Toast.info(`重复跳过：${res.skippedDuplicates.join("、")}`);
                    for (const failure of res.failed) Notification.error({ title: `${failure.name}：${failure.message}`, duration: 6 });
                    if (res.warning) Toast.warning(res.warning);
                    startTransition(() => router.refresh());
                  })
                  .catch((err) => Notification.error({ title: err instanceof Error ? actionErrorMessage(err) : "补传失败", duration: 6 }))
                  .finally(() => setUploading(false));
              }}
            />
        </div>
      )}

      {(parsed.documentLinks.length > 0 || parsed.credentials.length > 0 || parsed.attachmentResults.length > 0) && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {parsed.documentLinks.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/80">
                <FileDown className="h-3.5 w-3.5 text-primary" />
                电子送达
              </div>
              {parsed.documentLinks.map((link, i) => (
                <div
                  key={`${link.url}-${i}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground"
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {link.platform ?? `送达链接 ${i + 1}`}
                  </a>
                  {link.requiresLogin && (
                    <span className="rounded bg-[var(--semi-color-warning-light-default)] px-1.5 py-0.5 text-[10px] text-[var(--semi-color-warning)]">
                      需登录/校验
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {parsed.credentials.length > 0 && (
            <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1 text-foreground/75">
                <KeyRound className="h-3 w-3 text-primary" />
                已识别凭证
              </span>
              {parsed.credentials.map((cred, i) => (
                <span
                  key={`${cred.kind}-${cred.valuePreview}-${i}`}
                  className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px]"
                >
                  {cred.label}：{cred.valuePreview}
                </span>
              ))}
            </div>
          )}

          {parsed.attachmentResults.length > 0 && (
            <div className="space-y-1">
              {parsed.attachmentResults.map((result, i) => (
                <AttachmentResultRow key={`${result.url}-${i}`} result={result} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 关联案件 + 操作行 */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {sms.matchedMatter ? (
          <Link
            href={matterHref(sms.matchedMatter)}
            className="group inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] hover:bg-primary/10"
          >
            <Briefcase className="h-3 w-3 text-primary" />
            <span className="font-mono text-[10px] text-muted-foreground">
              {sms.matchedMatter.internalCode}
            </span>
            <span className="truncate font-medium">{sms.matchedMatter.title}</span>
            {sms.matchedBy === "AUTO_CASE_NUMBER" && (
              <span className="ml-0.5 rounded bg-muted/60 px-1 text-[9px] text-muted-foreground">
                自动
              </span>
            )}
          </Link>
        ) : (
          <MatterPicker sms={sms} matters={matters} />
        )}

        <Button htmlType="button" size="small" theme="borderless" type="tertiary" onClick={() => setShowRaw(v => !v)}>
          {showRaw ? "收起原文" : "查看原文"}
        </Button>

        <div className="ml-auto flex items-center gap-2">
          {!sms.processed && sms.matchedMatter && (
            <>
              {sms.smsType === "HEARING_NOTICE" && (
                <Button
                  size="small"
                  theme="outline" type="tertiary"
                  onClick={onGenerateHearing}
                  className="h-7 gap-1 text-[11px]"
                >
                  <Gavel className="h-3 w-3" />
                  生成开庭
                </Button>
              )}
              <Button
                size="small"
                theme="outline" type="tertiary"
                onClick={onGenerateDeadline}
                className="h-7 gap-1 text-[11px]"
              >
                <Clock className="h-3 w-3" />
                生成期限
              </Button>
              {canBackfillCaseNumber && (
                <Button
                  size="small"
                  theme="outline" type="tertiary"
                  onClick={onBackfillCaseNumber}
                  className="h-7 gap-1 text-[11px]"
                  title="把短信解析出的案号回填到缺案号的程序"
                >
                  <FileDigit className="h-3 w-3" />
                  回填案号
                </Button>
              )}
            </>
          )}
          {parsed.urls.length > 0 && (
            <Button
              size="small"
              theme="outline" type="tertiary"
              onClick={onExtractAttachments}
              disabled={pending}
              className="h-7 gap-1 text-[11px]"
              title="提取短信中的送达附件（未匹配案件时文件入私有来件暂存，匹配后再转正）"
            >
              {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileDown className="h-3 w-3" />}
              提取附件
            </Button>
          )}
          {!sms.processed && (
            <Button
              size="small"
              theme="borderless" type="tertiary"
              onClick={onMarkProcessed}
              disabled={pending}
              className="h-7 gap-1 text-[11px]"
            >
              <CheckCircle2 className="h-3 w-3" />
              标为已处理
            </Button>
          )}
          <Button
            htmlType="button"
            theme="borderless"
            type="danger"
            size="small"
            onClick={onDelete}
            disabled={pending}
            aria-label="删除短信"
            icon={<Trash2 className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      {showRaw && (
        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-3 font-sans text-[11px] leading-relaxed text-foreground/80">
          {sms.rawText}
        </pre>
      )}
    </div>
  );
}

function Field({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {icon && <span className="text-muted-foreground/70">{icon}</span>}
      {children}
    </span>
  );
}

function normalizeParsedJson(sms: SmsRow): ParsedJson {
  const raw = (sms.parsedJson ?? {}) as Partial<ParsedJson>;
  return {
    smsType: raw.smsType ?? sms.smsType,
    caseNumbers: Array.isArray(raw.caseNumbers) ? raw.caseNumbers : [],
    court: raw.court ?? null,
    dates: Array.isArray(raw.dates) ? raw.dates : [],
    hearingDate: raw.hearingDate ?? null,
    filingDate: raw.filingDate ?? null,
    judgmentDate: raw.judgmentDate ?? null,
    appealDeadline: raw.appealDeadline ?? null,
    courtRoom: raw.courtRoom ?? null,
    judge: raw.judge ?? null,
    clerk: raw.clerk ?? null,
    phones: Array.isArray(raw.phones) ? raw.phones : [],
    amounts: Array.isArray(raw.amounts) ? raw.amounts : [],
    urls: Array.isArray(raw.urls) ? raw.urls : [],
    platforms: Array.isArray(raw.platforms) ? raw.platforms : [],
    importantItems: Array.isArray(raw.importantItems) ? raw.importantItems : [],
    credentials: Array.isArray(raw.credentials) ? raw.credentials : [],
    documentLinks: Array.isArray(raw.documentLinks) ? raw.documentLinks : [],
    attachmentResults: Array.isArray(raw.attachmentResults) ? raw.attachmentResults : [],
    summary: raw.summary ?? sms.rawText.slice(0, 80),
    aiEnriched: raw.aiEnriched,
    action: raw.action ?? null,
    urgency: raw.urgency ?? null
  };
}

function AttachmentResultRow({ result }: { result: ParsedJson["attachmentResults"][number] }) {
  const meta = {
    DOWNLOADED: { label: "已保存", color: "text-[var(--semi-color-success)]", bg: "bg-[var(--semi-color-success-light-default)]" },
    ALREADY_DOWNLOADED: { label: "已存在", color: "text-[var(--semi-color-success)]", bg: "bg-[var(--semi-color-success-light-default)]" },
    LOGIN_REQUIRED: { label: "待人工", color: "text-[var(--semi-color-warning)]", bg: "bg-[var(--semi-color-warning-light-default)]" },
    SKIPPED_NO_MATTER: { label: "未关联", color: "text-[var(--semi-color-warning)]", bg: "bg-[var(--semi-color-warning-light-default)]" },
    NO_FILE_FOUND: { label: "未发现", color: "text-muted-foreground", bg: "bg-muted/50" },
    UNSUPPORTED_TYPE: { label: "不支持", color: "text-muted-foreground", bg: "bg-muted/50" },
    FAILED: { label: "失败", color: "text-destructive", bg: "bg-destructive/10" },
    PENDING: { label: "待提取", color: "text-muted-foreground", bg: "bg-muted/50" }
    // parsedJson 来自 DB JSON，status 可能是历史版本写入的未知值，需兜底
  }[result.status] ?? { label: "未知", color: "text-muted-foreground", bg: "bg-muted/50" };

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span className={cn("rounded px-1.5 py-0.5 text-[10px]", meta.bg, meta.color)}>
        {meta.label}
      </span>
      {result.documentId ? (
        <a
          href={`/api/documents/${result.documentId}/download`}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <FileCheck2 className="h-3 w-3" />
          {result.documentName ?? "已保存附件"}
        </a>
      ) : (
        <span className="line-clamp-1">{result.message}</span>
      )}
      {result.documentId && <span className="line-clamp-1">{result.message}</span>}
    </div>
  );
}

function UrgencyBadge({ level }: { level: "HIGH" | "MEDIUM" | "LOW" }) {
  const meta = {
    HIGH: { label: "紧急", color: "#B42318", bg: "rgb(248 113 113 / 0.12)" },
    MEDIUM: { label: "本周", color: "#96650B", bg: "rgb(252 211 77 / 0.15)" },
    LOW: { label: "知悉", color: "#68747F", bg: "rgb(229 229 229 / 0.5)" }
  }[level];
  return (
    <span
      className="ml-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]"
      style={{ background: meta.bg, color: meta.color }}
    >
      <AlertCircle className="h-2.5 w-2.5" />
      {meta.label}
    </span>
  );
}

// 保留失败时的选择供重试；已关联案件仍只取服务端确认后的记录。
function MatterPicker({ sms, matters }: { sms: SmsRow; matters: MatterOption[] }) {
  const labelId = useId();
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onPick = (matterId: string) => {
    setTargetId(matterId);
    setError(null);
    startTransition(async () => {
      try {
        await matchSmsToMatter({ smsId: sms.id, matterId });
        Toast.success("已关联案件");
      } catch (e) {
        setError(e instanceof Error ? actionErrorMessage(e) : "关联失败，请重试");
      }
    });
  };

  return <div className="space-y-1"><span id={labelId} className="sr-only">指派案件</span><Select
    aria-labelledby={labelId}
    placeholder="指派案件"
    searchPlaceholder="搜索编号或案件名..."
    prefix={<LinkIcon className="h-3 w-3" />}
    style={{ width: 320 }}
    filter
    motion={false}
    value={targetId || undefined}
    loading={pending}
    disabled={pending}
    emptyContent="未找到"
    optionList={matters.map(matter => ({ value: matter.id, label: `${matter.internalCode} ${matter.title}` }))}
    onChange={value => { if (typeof value === "string") onPick(value); }}
  />
    {error && <div className="flex items-center gap-2">
      <p role="alert" className="text-xs text-destructive">{error}</p>
      <Button htmlType="button" size="small" theme="borderless" onClick={() => onPick(targetId)} disabled={pending}>重试关联</Button>
    </div>}
  </div>;
}
