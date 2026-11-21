import { SettingsRedirect } from "@/features/settings/settings-redirect"

export const metadata = { title: "Settings" }

export default function Page() {
  return <SettingsRedirect to="/settings/profile" />
}
