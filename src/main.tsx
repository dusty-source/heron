import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { StatusBar } from '@capacitor/status-bar'
import { mountViewportReadout } from './utils/viewportDiagnostic'

// Edge-to-edge (overlay the status bar) + light icons over black. This is what
// lets web content paint underneath the iOS status bar / home indicator. It is
// a no-op when running in a plain browser (Capacitor not present).
try {
  if (StatusBar) {
    StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
    StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {})
    StatusBar.setBackgroundColor({ color: '#000000' }).catch(() => {})
  }
} catch {
  /* browser / no native */
}

// On-device diagnostics (only active with ?debug / window.__HERON_DEBUG).
mountViewportReadout(() => '')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
