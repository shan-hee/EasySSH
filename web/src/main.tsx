import React from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "@/app"
import "@/i18n"
import "@fontsource-variable/cascadia-code/wght.css"
import "@fontsource-variable/fira-code/wght.css"
import "@fontsource-variable/inter/wght.css"
import "@fontsource-variable/jetbrains-mono/wght.css"
import "@fontsource-variable/source-code-pro/wght.css"
import "@fontsource/noto-sans-sc/400.css"
import "@fontsource/noto-sans-sc/500.css"
import "@fontsource/noto-sans-sc/600.css"
import "@fontsource/noto-sans-sc/700.css"
import "katex/dist/katex.min.css"
import "@/styles/globals.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element #root was not found")
}

createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
