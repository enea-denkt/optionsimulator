import { Route, Routes } from 'react-router-dom';
import Layout from './Layout.jsx';
import OptionsSimulator from './OptionsSimulator';
import ChainInsights from './ChainInsights';
import TickerComparison from './TickerComparison';
import DealerExposure from './DealerExposure';

/**
 * Routes are relative to Vite's `base` (applied as the router basename in
 * main.jsx), so the same table serves /optionsimulator/ on GitHub Pages and
 * /member/ on the gammalift site.
 *
 * The .html routes are legacy entry points kept so existing links stay alive.
 */
export default function Pages() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<OptionsSimulator />} />
        <Route path="/OptionsSimulator" element={<OptionsSimulator />} />
        <Route path="/index.html" element={<OptionsSimulator />} />
        <Route path="/simulatorapp.html" element={<OptionsSimulator />} />
        <Route path="/insights" element={<ChainInsights />} />
        <Route path="/compare" element={<TickerComparison />} />
        <Route path="/exposure" element={<DealerExposure />} />
        {/* Unknown paths fall back to the simulator rather than a blank page. */}
        <Route path="*" element={<OptionsSimulator />} />
      </Routes>
    </Layout>
  );
}
