import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import "@/i18n"
import "@/styles/vendor-styles"
import "@/styles/app.css"
import "./desktop.css"

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
