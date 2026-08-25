import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* GitHub Pages（リポジトリ名直下）でも SPA ルーティングが動くよう HashRouter を使用 */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
