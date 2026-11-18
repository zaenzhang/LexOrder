"use client";

import { useState, type ReactNode } from "react";
import { Dropdown } from "@douyinfe/semi-ui";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, Settings, ShieldCheck } from "lucide-react";
import { useWorkspaceActor } from "@/components/workspace-actor-provider";
import { canEnterAdminWorkspace } from "@/lib/auth/system-role";
import { roleDisplayName } from "@/lib/roles/catalog";

/** 顶栏和侧栏共用同一组账户入口与当前资格判断。 */
export function WorkspaceAccountMenu({ children, position }: {
  children: ReactNode;
  position: "bottomRight" | "topLeft";
}) {
  const user = useWorkspaceActor();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const personal = user?.runtimeMode === "PERSONAL";
  const name = user?.name || (personal ? "本机操作者" : "");
  const role = personal ? "个人工作区" : user?.role ? roleDisplayName(user) : "";

  return <Dropdown trigger="click" position={position} visible={visible} onVisibleChange={setVisible} onEscKeyDown={() => setVisible(false)} motion={false} render={
    <Dropdown.Menu>
      <Dropdown.Title>{name ? `${name} · ${role}` : "加载中…"}</Dropdown.Title>
      <Dropdown.Divider />
      <Dropdown.Item icon={<Settings size={16} />} onClick={() => { setVisible(false); router.push("/settings/profile"); }}>个人设置</Dropdown.Item>
      {personal || canEnterAdminWorkspace(user ?? undefined) ? <Dropdown.Item
        icon={<ShieldCheck size={16} />}
        onClick={() => { setVisible(false); window.open("/admin", "_blank", "noopener,noreferrer"); }}
      >{personal ? "工作区设置" : "管理后台"}</Dropdown.Item> : null}
      {!personal ? <>
        <Dropdown.Divider />
        <Dropdown.Item type="danger" icon={<LogOut size={16} />} onClick={() => { setVisible(false); void signOut({ callbackUrl: "/login" }); }}>退出登录</Dropdown.Item>
      </> : null}
    </Dropdown.Menu>
  }>{children}</Dropdown>;
}
