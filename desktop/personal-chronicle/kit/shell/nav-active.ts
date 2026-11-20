import type { NavLink } from "./types"

/** A link is active on its own page and on any page below it. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/"
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * The most specific link that matches the pathname, so "/products/inventory"
 * highlights Inventory, not All products.
 */
export function activeHref(pathname: string, links: NavLink[]): string | null {
  let best: string | null = null
  let longest = 0
  const visit = (items: NavLink[]) => {
    for (const link of items) {
      for (const path of [link.href, ...(link.activePaths ?? [])]) {
        if (path.length > longest && isActive(pathname, path)) {
          best = link.href
          longest = path.length
        }
      }
      if (link.items) {
        visit(link.items)
      }
    }
  }
  visit(links)
  return best
}
