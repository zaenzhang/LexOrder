export const CLIENT_TABS = [
  { value: "clients", label: "客户列表", href: "/practice/clients" },
  { value: "intakes", label: "收案", href: "/practice/intakes" },
  { value: "contacts", label: "外部联系人", href: "/practice/contacts" },
  { value: "conflicts", label: "冲突预检", href: "/practice/conflicts" },
] as const

export type ClientTab = typeof CLIENT_TABS[number]["value"]

export function isClientTab(value: string): value is ClientTab {
  return CLIENT_TABS.some(tab => tab.value === value)
}
