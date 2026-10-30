import React from 'react'
import ReactDOM from 'react-dom/client'
import * as DesktopActivationService from "../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopactivationservice"
import { I18nextProvider } from "react-i18next"
import { i18n, preloadNamespaces } from "@easyssh/app/i18n"
import { createPreloadableComponent } from "@easyssh/app/lib/preloadable-component"
import { ResourceBoundary } from "@easyssh/app/components/resource-boundary"
import { AppLoadingScreen } from "@easyssh/app/components/app-loading"
import "@easyssh/app/styles/vendor-styles"
import "./styles.css"

const desktopApp = createPreloadableComponent(async () => {
  const [module] = await Promise.all([
    import("./App"),
    preloadNamespaces(["common", "desktop", "terminal", "sftp", "servers", "terminalSettings", "headerActions", "settingsManagementBackup"]),
  ])
  return module
})
const App = desktopApp.Component

async function startDesktop() {
  void desktopApp.preload().catch(() => undefined)
  await DesktopActivationService.WaitForStartup()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ResourceBoundary listenForResourceErrors>
        <React.Suspense fallback={<AppLoadingScreen />}>
          <I18nextProvider i18n={i18n}>
            <App />
          </I18nextProvider>
        </React.Suspense>
      </ResourceBoundary>
    </React.StrictMode>,
  )
}

void startDesktop().catch(error => {
  console.error("Desktop startup failed:", error)
  const root = document.getElementById("root")
  if (root) root.textContent = String(error)
})
