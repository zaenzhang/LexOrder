import { BellIcon, CreditCardIcon, HistoryIcon, KeyRoundIcon, PaletteIcon, PlugIcon, ShieldCheckIcon, UserIcon, UsersIcon } from "lucide-react"

import type { SettingsGroup } from "@/kit/settings/settings-layout"

/** The settings sections, in menu order. Each one is its own page under /settings. */
export const SETTINGS_NAV: SettingsGroup[] = [
  {
    label: "You",
    items: [
      { title: "Profile", href: "/settings/profile", icon: UserIcon },
      {
        title: "Account and security",
        href: "/settings/account",
        icon: ShieldCheckIcon,
      },
    ],
  },
  {
    label: "Preferences",
    items: [
      { title: "Appearance", href: "/settings/appearance", icon: PaletteIcon },
      {
        title: "Notifications",
        href: "/settings/notifications",
        icon: BellIcon,
      },
    ],
  },
  {
    label: "Workspace",
    items: [{ title: "Connections", href: "/settings/connections", icon: PlugIcon }],
  },
  // The public demo only: previews of screens the paid templates ship (features/demo). Your build never lists them.
  ...(import.meta.env.MODE === "demo"
    ? [
        {
          label: "In the paid templates",
          items: [
            { title: "Team and roles", href: "/settings/team", icon: UsersIcon },
            { title: "Billing and plans", href: "/settings/billing", icon: CreditCardIcon },
            { title: "API keys", href: "/settings/api-keys", icon: KeyRoundIcon },
          ],
        },
      ]
    : []),
]

export const WORKBENCH_SETTINGS_NAV: SettingsGroup[] = [
  {
    label: "个人",
    items: [{ title: "执业资料", href: "/practice/profile", icon: UserIcon }],
  },
  {
    label: "偏好",
    items: [{ title: "外观", href: "/practice/profile/appearance", icon: PaletteIcon }],
  },
  {
    label: "工作区",
    items: [
      { title: "应用 AI", href: "/practice/profile/ai", icon: PlugIcon },
      { title: "操作记录", href: "/practice/profile/audit", icon: HistoryIcon },
    ],
  },
]
