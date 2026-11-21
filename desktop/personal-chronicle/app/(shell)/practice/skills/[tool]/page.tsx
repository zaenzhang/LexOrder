import { useParams } from "react-router"

import NotFound from "@/app/not-found"
import { ResourcesDesk } from "@/features/practice/resources-desk"

export const metadata = { title: "工具" }

export default function Page() {
  const { tool } = useParams()
  if (tool === "templates" || tool === "resources" || tool === "reports") return <ResourcesDesk key={tool} view={tool} />
  return <NotFound />
}
