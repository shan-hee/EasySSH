import React from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "@/app"
import { ResourceBoundary } from "@/components/resource-boundary"
import { AppLoadingScreen } from "@/components/app-loading"
import "@/i18n"
import "@/styles/vendor-styles"
import "@/styles/globals.css"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element #root was not found")
}

createRoot(rootElement).render(
  <React.StrictMode>
    <ResourceBoundary listenForResourceErrors>
      <React.Suspense fallback={<AppLoadingScreen />}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.Suspense>
    </ResourceBoundary>
  </React.StrictMode>,
)
