import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { ThemeToggle } from "../components/icons/ThemeIcons";
import { WhatsNewPanel } from "./WhatsNewPanel";
import { MobileMenu, mobileMenuRowClass } from "./MobileMenu";

const activeLinkClass = "text-sm font-medium text-slate-900 dark:text-white";
const inactiveLinkClass =
  "text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? activeLinkClass : inactiveLinkClass;

const panelLinkClass = ({ isActive }: { isActive: boolean }) =>
  `${mobileMenuRowClass}${isActive ? " font-medium text-slate-900 dark:text-white" : ""}`;

// The three shelf views (My Library / Wishlist / Reading list) all live at
// `/shelf`, so NavLink's path-only matching would mark all three active (and set
// aria-current on all three) at once. Distinguish them by query param (ADR-021)
// with plain Links so exactly one is styled and announced as current.
type ShelfView = "library" | "wishlist" | "reading-list";

function activeShelfView(pathname: string, search: string): ShelfView | null {
  if (pathname !== "/shelf") return null;
  const params = new URLSearchParams(search);
  if (params.get("view") === "reading-list") return "reading-list";
  if (params.get("facet") === "want") return "wishlist";
  return "library";
}

export function AppHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const shelfView = activeShelfView(location.pathname, location.search);

  async function handleSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  // Shelf deep-links rendered for both the inline nav and the mobile panel. They
  // share the active-by-query-param logic and differ only in their base styling,
  // so each surface passes its existing link-class fn (navLinkClass / panelLinkClass).
  const shelfLinks: { to: string; label: string; view: ShelfView }[] = [
    { to: "/shelf", label: "My Library", view: "library" },
    { to: "/shelf?facet=want", label: "Wishlist", view: "wishlist" },
    { to: "/shelf?view=reading-list", label: "Reading list", view: "reading-list" },
  ];

  const renderShelfLinks = (linkClass: (state: { isActive: boolean }) => string) =>
    shelfLinks.map(({ to, label, view }) => {
      const isActive = shelfView === view;
      return (
        <Link
          key={view}
          to={to}
          className={linkClass({ isActive })}
          aria-current={isActive ? "page" : undefined}
        >
          {label}
        </Link>
      );
    });

  return (
    <header className="relative border-b border-paper-300 dark:border-slate-800 px-4 sm:px-6 py-4 flex items-center justify-between bg-paper-100 dark:bg-slate-900 transition-colors">
      <span className="font-semibold text-lg tracking-tight dark:text-white">Bookshelf</span>

      {/* Inline nav — sm and up */}
      <nav className="hidden sm:flex items-center gap-4">
        {renderShelfLinks(navLinkClass)}
        <NavLink to="/about" className={navLinkClass}>
          About
        </NavLink>
        {user && (
          <>
            <NavLink to="/account/settings" className={navLinkClass}>
              Account
            </NavLink>
            <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </>
        )}
        <WhatsNewPanel />
        <ThemeToggle />
      </nav>

      {/* Mobile cluster — below sm. ThemeToggle stays visible; links collapse into the menu. */}
      <div className="flex items-center gap-1 sm:hidden">
        <WhatsNewPanel />
        <ThemeToggle />
        <MobileMenu>
          {renderShelfLinks(panelLinkClass)}
          <NavLink to="/about" className={panelLinkClass}>
            About
          </NavLink>
          {user && (
            <>
              <NavLink to="/account/settings" className={panelLinkClass}>
                Account
              </NavLink>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className={`${mobileMenuRowClass} border-t border-paper-300 dark:border-slate-800`}
              >
                Sign out
              </button>
            </>
          )}
        </MobileMenu>
      </div>
    </header>
  );
}
