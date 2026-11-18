'use client';

import { Tag as SemiTag } from "@/components/patterns/semi-surfaces";
import { Button as SemiButton } from "@douyinfe/semi-ui";
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TextArea, Toast } from "@douyinfe/semi-ui";
import { IconShield as ShieldAlert } from "@douyinfe/semi-icons";
import { runMatterReview, decideMatterReview } from '@/server/conflicts/matter-actions';
import type { readMatterReview } from '@/server/conflicts/matter-review';
import { conflictConclusionLabel } from '@/lib/enums';
import { formatDateTime } from '@/lib/utils';
import { actionErrorMessage } from "@/lib/action-error";

/** 侧栏常驻的动态冲突复核卡（2026-09-20 用户确认：仅在待复核时渲染，放侧栏不占主视觉）。
 *  是新增程序、委托合同、补充协议生效三处写路径门禁（assertMatterReviewCurrent）的操作出口。 */
export function MatterConflictReview({ matterId, data, canWrite }: { matterId: string; data: Awaited<ReturnType<typeof readMatterReview>>; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (!data || !data.needsReview) return null;

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      await work();
      router.refresh();
      Toast.success('冲突核查已保存');
    } catch (e) {
      Toast.error(e instanceof Error ? actionErrorMessage(e) : '核查失败');
    } finally {
      setBusy(false);
    }
  }

  const latest = data.checks[0];
  return (
    <div className="card" aria-label="利益冲突复核">
      <div className="rail-sec-head">
        <ShieldAlert aria-hidden className="h-[15px] w-[15px] text-[var(--semi-color-warning)]" />
        利益冲突复核
        <SemiTag size="small" color="amber">待复核</SemiTag>
      </div>
      <div className="panel-body space-y-2">
        <p className="t-xs t-mute">{data.reviewReason}</p>
        {canWrite ? (
          <SemiButton disabled={busy} theme="outline" type="tertiary" className="w-full" onClick={() => void run(() => runMatterReview(matterId))}>
            按当前主体重新检索
          </SemiButton>
        ) : null}
        {data.checks.map((c) => (
          <article key={c.id} className="border-t pt-2 text-xs">
            <b>{formatDateTime(c.checkedAt)} · {c.conclusion === 'DIFFERENT' && !c.decisionRecorded ? '待人工核对' : conflictConclusionLabel[c.conclusion]}{!c.current ? ' · 主体或范围已变化' : ''}</b>
            <p className="t-mute">{c.note} {c.conclusion !== 'DIFFERENT' || c.decisionRecorded ? c.decidedBy : null}</p>
            {c.hits.map((h) => (
              <p key={h.id} className="t-mute">{h.reason} · {h.matchedValue}</p>
            ))}
          </article>
        ))}
        {canWrite && latest?.current ? (
          <div className="space-y-2 border-t pt-2">
            <TextArea aria-label="冲突复核理由" placeholder="排除冲突的依据，或存在冲突后的处理措施" value={note} onChange={inputValue => setNote(inputValue)} rows={3} />
            <div className="flex flex-wrap gap-2">
              {(['DIFFERENT', 'SAME_SUBJECT', 'NEED_INFO'] as const).map((conclusion) => (
                <SemiButton key={conclusion} disabled={busy || !note.trim()} theme="outline" type="tertiary" onClick={() => void run(() => decideMatterReview({ matterId, checkId: latest.id, expectedDecidedAt: latest.decidedAt, conclusion, note }))}>
                  {conflictConclusionLabel[conclusion]}
                </SemiButton>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
