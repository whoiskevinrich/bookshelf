import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { ThemeToggle } from "../components/icons/ThemeIcons";

interface AppHeaderProps {
  activePage: "shelf" | "wishlist";
}

export function AppHeader({ activePage }: AppHeaderProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/", { replace: true });
  }

  const activeLinkClass = "text-sm font-medium text-slate-900 dark:text-white";
  const inactiveLinkClass =
    "text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white";

  return (
    <header className="border-b border-slate-100 dark:border-slate-800 px-6 py-4 flex items-center justify-between bg-white dark:bg-slate-900 transition-colors">
      <span className="font-semibold text-lg tracking-tight dark:text-white">Bookshelf</span>
      <nav className="flex items-center gap-4">
        <Link to="/shelf" className={activePage === "shelf" ? activeLinkClass : inactiveLinkClass}>
          My Shelf
        </Link>
        <Link
          to="/wishlist"
          className={activePage === "wishlist" ? activeLinkClass : inactiveLinkClass}
        >
          Wishlist
        </Link>
        <span className="text-xs text-slate-500 dark:text-slate-400">{user?.username}</span>
        <Button variant="ghost" size="sm" onClick={() => void handleSignOut()}>
          Sign out
        </Button>
        <ThemeToggle />
      </nav>
    </header>
  );
}
