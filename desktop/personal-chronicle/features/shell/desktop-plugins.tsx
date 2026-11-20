import { invoke, isTauri } from "@tauri-apps/api/core"
import { useQuery } from "@tanstack/react-query"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { MatterSection } from "@/features/matters/sections"

type Catalog = {
  plugins: { id: string; name: string; commands: { id: string; title: string; section: MatterSection }[] }[]
  invalid: string[]
}

export function useDesktopPlugins(enabled: boolean) {
  return useQuery({
    queryKey: ["desktop-plugins"],
    enabled: enabled && isTauri(),
    queryFn: () => invoke<Catalog>("read_desktop_plugins"),
    staleTime: 60_000,
  })
}

export function DesktopPlugins() {
  const catalog = useDesktopPlugins(true)
  return <Card>
    <CardHeader><CardTitle>插件</CardTitle></CardHeader>
    <CardContent>
      {!isTauri() && <p>请在桌面工作台查看本机插件。</p>}
      {catalog.isLoading && <p>正在读取插件…</p>}
      {catalog.isError && <p role="alert">无法读取本机插件。</p>}
      {catalog.data?.plugins.length === 0 && <p>尚未安装插件。</p>}
      {catalog.data && <ul>
        {catalog.data.plugins.map(plugin => <li key={plugin.id}>{plugin.name} · {plugin.commands.length} 项案卷命令</li>)}
        {catalog.data.invalid.map(id => <li key={id}>{id} 的清单无效，未加载。</li>)}
      </ul>}
    </CardContent>
  </Card>
}
