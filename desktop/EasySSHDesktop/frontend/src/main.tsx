import React from 'react'
import ReactDOM from 'react-dom/client'
import { Call } from "@wailsio/runtime"
import { I18nextProvider } from "react-i18next"
import { i18n, preloadNamespaces } from "@/i18n"
import { createPreloadableComponent } from "@/lib/preloadable-component"
import { ResourceBoundary } from "@/components/resource-boundary"
import { AppLoadingScreen } from "@/components/app-loading"
import "@/styles/vendor-styles"
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
  await Call.ByName("main.DesktopActivationService.WaitForStartup")
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
