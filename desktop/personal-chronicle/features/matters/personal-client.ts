export type Matter = { id: string; title: string; internalCode: string }

export const evidenceEndpoint = "/api/personal-runtime/evidence-review"

export async function readPersonal<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const result = await response.json().catch(() => null)
    throw new Error(result?.error || (response.status === 403 ? "请从个人桌面预览打开工作区。" : "无法读取个人工作区，请稍后重试。"))
  }
  return response.json() as Promise<T>
}

export function materialUrl(path: string) {
  return path.replace(/^\/api\/documents\//, "/api/personal-runtime/documents/")
}
export const workspaceEndpoint = "/api/personal-runtime/matter-workspace"
