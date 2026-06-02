import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
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

  return (
    <header className="border-b border-gray-100 dark:border-zinc-800 px-6 py-4 flex items-center justify-between bg-white dark:bg-zinc-900 transition-colors">
      <span className="font-semibold text-lg tracking-tight dark:text-white">Bookshelf</span>
      <nav className="flex items-center gap-4">
        <Link
          to="/shelf"
          className={`text-sm ${activePage === "shelf" ? "font-medium text-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-white"}`}
        >
          My Shelf
        </Link>
        <Link
          to="/wishlist"
          className={`text-sm ${activePage === "wishlist" ? "font-medium text-gray-900 dark:text-white" : "text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-white"}`}
        >
          Wishlist
        </Link>
        <span className="text-xs text-gray-500 dark:text-zinc-400">{user?.username}</span>
        <button
          onClick={() => void handleSignOut()}
          className="text-xs text-gray-500 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-white"
        >
          Sign out
        </button>
        <ThemeToggle />
      </nav>
    </header>
  );
}
