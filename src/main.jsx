import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from '@/App.jsx'
import '@/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  // basename follows Vite's `base`, so the same code works at /optionsimulator/
  // on GitHub Pages and at /member/ on the gammalift site.
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Routes>
      <Route path="/" element={<App />} />
      <Route path="/index.html" element={<App />} />
      <Route path="/simulatorapp.html" element={<App />} />
    </Routes>
  </BrowserRouter>
)
