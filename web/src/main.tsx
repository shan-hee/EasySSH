import React from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { router } from "@/router"
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
        <RouterProvider router={router} />
      </React.Suspense>
    </ResourceBoundary>
  </React.StrictMode>,
)
