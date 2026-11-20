"use client"

import { PaletteIcon } from "lucide-react"
import { lazy, Suspense } from "react"

import { Button } from "@/components/ui/button"

/**
 * The Kit customizer for the landing page, loaded after the page is
 * interactive so the first paint carries none of it. Until then the same
 * button holds its place.
 */
const CustomizerPanel = lazy(async () => ({ default: (await import("@/kit/customizer/customizer-panel")).CustomizerPanel }))

export function LandingCustomizer() {
  return <Suspense fallback={<Button variant="ghost" size="icon" aria-label="Customize theme" disabled><PaletteIcon /></Button>}>
    <CustomizerPanel />
  </Suspense>
}
