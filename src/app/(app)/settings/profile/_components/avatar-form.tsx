"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconImage as ImageUp, IconDelete as Trash2 } from "@douyinfe/semi-icons";
import { Avatar, Button, Tag, Toast } from "@douyinfe/semi-ui";
import { saveMyAvatar } from "@/server/users/actions";
import { actionErrorMessage } from "@/lib/action-error";

const AVATAR_MAX_BYTES = 180 * 1024;

export function AvatarForm({ name, role, initialAvatar }: { name: string; role?: string; initialAvatar: string | null }) {
  const router = useRouter();
  const [avatar, setAvatar] = useState<string | null>(initialAvatar);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const initial = name ? name.charAt(0) : "?";

  const onPick = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      Toast.error("请选择图片文件（PNG / JPG / WebP / SVG）");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      Toast.error("头像过大，请控制在约 180KB 以内");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      save(dataUrl);
    };
    reader.onerror = () => Toast.error("读取图片失败");
    reader.readAsDataURL(file);
  };

  const save = (value: string | null) => {
    startTransition(async () => {
      try {
        await saveMyAvatar({ avatar: value });
        setAvatar(value);
        Toast.success(value ? "头像已更新" : "头像已清除");
        router.refresh();
      } catch (e) {
        Toast.error(e instanceof Error ? actionErrorMessage(e) : "保存失败");
      }
    });
  };

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" disabled={pending}
        onChange={event => { onPick(event.target.files?.[0]); event.target.value = ""; }} />
      <Button htmlType="button" theme="borderless" type="tertiary" onClick={() => fileRef.current?.click()}
        disabled={pending} aria-label="更换头像" title="点击更换头像" style={{ width: 88, height: 88, padding: 4 }}>
        <Avatar size="extra-large" src={avatar ?? undefined} alt={name}>{initial}</Avatar>
      </Button>
      <div className="flex gap-2">
        <Button htmlType="button" size="small" onClick={() => fileRef.current?.click()} disabled={pending} loading={pending} icon={<ImageUp size="default" aria-hidden />}>上传头像</Button>
        {avatar && <Button htmlType="button" size="small" type="danger" theme="borderless" onClick={() => save(null)} disabled={pending} icon={<Trash2 size="default" aria-hidden />}>清除</Button>}
      </div>
      {role && <Tag color="cyan">{role}</Tag>}
      <p className="text-xs leading-relaxed text-[var(--semi-color-text-2)]">未上传时显示姓名首字「{initial}」<br />建议方形图片，≤ 180KB</p>
    </div>
  );
}
