import { Outlet } from "react-router"
import { NuqsAdapter } from "nuqs/adapters/react-router/v8"

import { AppDataProvider } from "@/components/data-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { THEME } from "@/config/theme"
import { DemoChromeLazy as DemoChrome } from "@/features/demo/demo-chrome-lazy"
import { CustomizerProvider } from "@/kit/customizer/customizer-provider"
import { QueryProvider } from "@/kit/data/query-provider"

export default function RootLayout() {
  return (
    <ThemeProvider defaultTheme="light">
      <NuqsAdapter>
        <QueryProvider>
          <AppDataProvider>
            <CustomizerProvider theme={THEME}>
              <TooltipProvider>
                <Toaster>
                  <Outlet />
                  {import.meta.env.MODE === "demo" && <DemoChrome gtmId={import.meta.env.VITE_GTM_ID} />}
                </Toaster>
              </TooltipProvider>
            </CustomizerProvider>
          </AppDataProvider>
        </QueryProvider>
      </NuqsAdapter>
    </ThemeProvider>
  )
}
