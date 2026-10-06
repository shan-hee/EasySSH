import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nextProvider } from "react-i18next"
import App from './App'
import { i18n } from "@/i18n"
import { ResourceBoundary } from "@/components/resource-boundary"
import { AppLoadingScreen } from "@/components/app-loading"
import "@/styles/vendor-styles"
import "./styles.css"

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
