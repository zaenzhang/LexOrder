import { useEffect, useMemo } from "react"
import { Link as RouterLink, useLocation, useNavigate, useParams, useSearchParams as useRouterSearchParams } from "react-router"

import type { InlineScriptProps, KitLink, KitRouter } from "./types"

export type { InlineScriptProps, KitLink, KitLinkProps, KitParams, KitRouter, KitSearchParams } from "./types"
export { useParams }

export const Link: KitLink = ({ href, ...props }) => <RouterLink to={href} {...props} />

export function usePathname() {
  return useLocation().pathname
}

export function useSearchParams() {
  return useRouterSearchParams()[0]
}

export function useRouter(): KitRouter {
  const navigate = useNavigate()
  return useMemo(() => ({
    push: href => { void navigate(href) },
    replace: href => { void navigate(href, { replace: true }) },
    back: () => { void navigate(-1) },
  }), [navigate])
}

export function useBasePath() {
  return import.meta.env.MODE === "demo" ? import.meta.env.BASE_URL.replace(/\/$/, "") : ""
}

export function InlineScript({ id, children }: InlineScriptProps) {
  useEffect(() => {
    if (document.getElementById(id)) return
    const script = document.createElement("script")
    script.id = id
    script.text = children
    document.head.append(script)
  }, [id, children])
  return null
}
