import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { ThemeToggle } from "../components/icons/ThemeIcons";

const activeLinkClass = "text-sm font-medium text-slate-900 dark:text-white";
const inactiveLinkClass =
  "text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? activeLinkClass : inactiveLinkClass;

export function AppHeader() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  return (
    <header className="border-b border-slate-100 dark:border-slate-800 px-6 py-4 flex items-center justify-between bg-white dark:bg-slate-900 transition-colors">
      <span className="font-semibold text-lg tracking-tight dark:text-white">Bookshelf</span>
      <nav className="flex items-center gap-4">
        <NavLink to="/shelf" className={navLinkClass}>
          My Shelf
        </NavLink>
        <NavLink to="/wishlist" className={navLinkClass}>
          Wishlist
        </NavLink>
        <NavLink to="/about" className={navLinkClass}>
          About
        </NavLink>
        <span className="text-xs text-slate-500 dark:text-slate-400">{user?.username}</span>
        <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
          Sign out
        </Button>
        <ThemeToggle />
      </nav>
    </header>
  );
}
