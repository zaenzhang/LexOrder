"use client"

import { SETTINGS_NAV, WORKBENCH_SETTINGS_NAV } from "@/config/settings-nav"
import { SettingsLayout } from "@/kit/settings/settings-layout"

/** The settings frame with Chronicle's sections. A client component, because the section icons are components. */
export function SettingsFrame({ children }: { children: React.ReactNode }) {
  return (
    <SettingsLayout
      groups={SETTINGS_NAV}
      description="Your profile, how Chronicle looks and which alerts reach you."
    >
      {children}
    </SettingsLayout>
  )
}

export function WorkbenchSettingsFrame({ children }: { children: React.ReactNode }) {
  return (
    <SettingsLayout
      groups={WORKBENCH_SETTINGS_NAV}
      title="设置"
      description="管理执业资料、界面外观和本机工作区。"
      navigationLabel="设置分区"
    >
      {children}
    </SettingsLayout>
  )
}
