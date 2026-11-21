import { Link, type KitLinkProps } from "@/kit/framework"

type Query = Record<string, string | number | boolean | undefined>
type WorkspaceLinkProps = Omit<KitLinkProps, "href"> & { href: string | { pathname: string; query?: Query } }

export default function WorkspaceLink({ href, ...props }: WorkspaceLinkProps) {
  if (typeof href === "string") return <Link href={href} {...props} />
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(href.query ?? {})) {
    if (value !== undefined) query.set(name, String(value))
  }
  const search = query.toString()
  return <Link href={href.pathname + (search ? "?" + search : "")} {...props} />
}
