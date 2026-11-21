import { createElement, type ReactNode } from "react"
import type { Root } from "react-dom/client"
import { MemoryRouter } from "react-router"

export function renderWithRouter(root: Root, element: ReactNode) {
  root.render(createElement(MemoryRouter, null, element))
}
