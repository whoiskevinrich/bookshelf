import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { ThemeToggle } from "../components/icons/ThemeIcons";
import { MobileMenu, mobileMenuRowClass } from "./MobileMenu";

const activeLinkClass = "text-sm font-medium text-slate-900 dark:text-white";
const inactiveLinkClass =
  "text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? activeLinkClass : inactiveLinkClass;

const panelLinkClass = ({ isActive }: { isActive: boolean }) =>
  `${mobileMenuRowClass}${isActive ? " font-medium text-slate-900 dark:text-white" : ""}`;

export function AppHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  return (
    <header className="relative border-b border-paper-300 dark:border-slate-800 px-4 sm:px-6 py-4 flex items-center justify-between bg-paper-100 dark:bg-slate-900 transition-colors">
      <span className="font-semibold text-lg tracking-tight dark:text-white">Bookshelf</span>

      {/* Inline nav — sm and up */}
      <nav className="hidden sm:flex items-center gap-4">
        <NavLink to="/shelf" className={navLinkClass}>
          My Library
        </NavLink>
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
        <ThemeToggle />
      </nav>

      {/* Mobile cluster — below sm. ThemeToggle stays visible; links collapse into the menu. */}
      <div className="flex items-center gap-1 sm:hidden">
        <ThemeToggle />
        <MobileMenu>
          <NavLink to="/shelf" className={panelLinkClass}>
            My Library
          </NavLink>
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
