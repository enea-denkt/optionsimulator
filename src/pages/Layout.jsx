import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, LineChart, Activity, Scale, Magnet, Target, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
// Imported rather than referenced from /public so the hash-named build output
// is cache-busted like every other asset.
import profileImage from '@/assets/ENEA.jpg';

/**
 * App shell: profile header, navigation, page slot.
 *
 * Navigation collapses below `md` into a slide-over sheet rather than wrapping
 * onto a second row, so adding a fourth or fifth tool later costs nothing on a
 * phone. Routes are relative to Vite's `base`, which react-router applies via
 * the basename set in main.jsx.
 */

// Adding a tool means adding a row here — the desktop bar and the mobile sheet
// both render from it, so they cannot drift apart.
const NAV_ITEMS = [
  {
    to: '/',
    label: 'Simulator',
    blurb: 'Model an option position',
    icon: Activity,
    // Exact match: every other route also starts with "/".
    match: (path) => path === '/' || /\/(index|simulatorapp)\.html$/.test(path) || /\/optionssimulator$/i.test(path),
  },
  {
    to: '/insights',
    label: 'Chain Insights',
    blurb: 'Read what the option chain is pricing',
    icon: LineChart,
    match: (path) => /\/insights$/i.test(path),
  },
  {
    to: '/finder',
    label: 'Contract Finder',
    blurb: 'Rank every contract against a price view',
    icon: Target,
    match: (path) => /\/finder$/i.test(path),
  },
  {
    to: '/compare',
    label: 'Compare',
    blurb: 'Find which company has the expensive options',
    icon: Scale,
    match: (path) => /\/compare$/i.test(path),
  },
  {
    to: '/exposure',
    label: 'Dealer Exposure',
    blurb: 'See where hedging flows pin or accelerate price',
    icon: Magnet,
    match: (path) => /\/exposure$/i.test(path),
  },
];

function NavLinks({ pathname, onNavigate, variant }) {
  const isSheet = variant === 'sheet';

  return NAV_ITEMS.map((item) => {
    const active = item.match(pathname);
    const Icon = item.icon;

    if (isSheet) {
      return (
        <Link
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
            active
              ? 'border-sky-200 bg-sky-50'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          <Icon className="mt-0.5 h-5 w-5 shrink-0" style={{ color: active ? '#2188e6' : '#94a3b8' }} />
          <span>
            <span className={`block text-sm font-semibold ${active ? 'text-slate-900' : 'text-slate-700'}`}>
              {item.label}
            </span>
            <span className="block text-xs text-slate-500">{item.blurb}</span>
          </span>
        </Link>
      );
    }

    return (
      <Link
        key={item.to}
        to={item.to}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active ? 'bg-sky-50 text-slate-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
        style={active ? { color: '#2188e6' } : undefined}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  });
}

export default function Layout({ children }) {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-2 sm:gap-4">
          {/* Profile links out to X, so it is a plain anchor rather than a
              router Link — and it sits outside the title's Link so tapping the
              name still goes to the dashboard. */}
          <a
            href="https://x.com/EneaDenkt"
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 flex-col items-center gap-1"
          >
            <img
              src={profileImage}
              alt="Enea Denkt"
              className="h-10 w-10 rounded-full border-2 border-black object-cover sm:h-12 sm:w-12"
              style={{ borderRadius: '50%' }}
            />
            <span className="text-xs font-medium text-slate-600">@EneaDenkt</span>
          </a>

          <Link
            to="/"
            className="min-w-0 text-base font-bold tracking-tight text-slate-900 sm:text-xl"
          >
            Enea&apos;s Options Dashboard
          </Link>

          <nav className="ml-2 hidden items-center gap-1 md:flex">
            <NavLinks pathname={pathname} />
          </nav>

          <div className="ml-auto md:hidden">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                aria-label="Open menu"
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </SheetTrigger>
              <SheetContent side="right" className="w-[85vw] max-w-xs">
                <p className="mb-4 mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Tools
                </p>
                <div className="flex flex-col gap-2">
                  <NavLinks pathname={pathname} variant="sheet" onNavigate={() => setMenuOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px]">{children}</main>
    </div>
  );
}
