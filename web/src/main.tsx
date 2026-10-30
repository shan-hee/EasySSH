import React from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router-dom"
import { installPlatformTransport } from "@easyssh/app/contracts/platform-transport"
import { browserTransport } from "./platform/http-transport"
import { createAppRouter } from "./router"
import { ResourceBoundary } from "@easyssh/app/components/resource-boundary"
import { AppLoadingScreen } from "@easyssh/app/components/app-loading"
import "@easyssh/app/i18n"
import "@easyssh/app/styles/vendor-styles"
import "./styles/app.css"

installPlatformTransport(browserTransport)

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element #root was not found")
}

const router = createAppRouter()

createRoot(rootElement).render(
  <React.StrictMode>
    <ResourceBoundary listenForResourceErrors>
      <React.Suspense fallback={<AppLoadingScreen />}>
        <RouterProvider router={router} />
      </React.Suspense>
    </ResourceBoundary>
  </React.StrictMode>,
)
