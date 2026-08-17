import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from '@/App.jsx'
import '@/index.css'

// basename follows Vite's `base`, so the same code works at /optionsimulator/
// on GitHub Pages and at /member/ on the gammalift site.
//
// The route table itself lives in src/pages/index.jsx. Declaring routes here as
// well would shadow it: a <Routes> that lists only the simulator paths renders
// nothing for any page added later.
ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <App />
  </BrowserRouter>
)
