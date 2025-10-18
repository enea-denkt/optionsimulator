import Layout from "./Layout.jsx";
import OptionsSimulator from "./OptionsSimulator";
import { Route, Routes, useLocation } from 'react-router-dom';

const PAGES = {
  OptionsSimulator: OptionsSimulator,
};

function _getCurrentPage(url) {
  if (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  let urlLastPart = url.split('/').pop();
  if (urlLastPart.includes('?')) {
    urlLastPart = urlLastPart.split('?')[0];
  }

  const pageName = Object.keys(PAGES).find(
    page => page.toLowerCase() === urlLastPart.toLowerCase()
  );
  return pageName || Object.keys(PAGES)[0];
}

function PagesContent() {
  const location = useLocation();
  const currentPage = _getCurrentPage(location.pathname);

  return (
    <Layout currentPageName={currentPage}>
      <Routes>
        <Route path="/" element={<OptionsSimulator />} />
        <Route path="/OptionsSimulator" element={<OptionsSimulator />} />
        <Route path="/simulatorapp.html" element={<OptionsSimulator />} />
      </Routes>
    </Layout>
  );
}

export default function Pages() {
  return <PagesContent />;
}
