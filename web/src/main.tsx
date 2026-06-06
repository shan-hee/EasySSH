import React from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "@/app"
import "@/i18n"
import "@/styles/vendor-styles"
import "@/styles/app.css"

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
