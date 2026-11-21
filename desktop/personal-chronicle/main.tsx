import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router/dom"

import "@fontsource-variable/hanken-grotesk"
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/500.css"
import "@fontsource/jetbrains-mono/600.css"
import "./app/globals.css"
import { THEME } from "@/config/theme"
import { bootCustomizer } from "@/kit/customizer/customizer-script"
import { connectPersonalChannel } from "@/features/matters/personal-client"
import { router } from "./routes"

bootCustomizer(THEME)
const root = createRoot(document.getElementById("root")!)
void connectPersonalChannel().then(
  () => root.render(<RouterProvider router={router} />),
  () => root.render(<main className="p-8" role="alert">无法连接本机工作区。请关闭窗口后重新打开。</main>),
)
