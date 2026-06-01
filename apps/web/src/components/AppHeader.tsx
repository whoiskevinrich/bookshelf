import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

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
    <header className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
      <span className="font-semibold text-lg tracking-tight">Bookshelf</span>
      <nav className="flex items-center gap-4">
        <Link
          to="/shelf"
          className={`text-sm ${activePage === "shelf" ? "font-medium text-gray-900" : "text-gray-500 hover:text-gray-900"}`}
        >
          My Shelf
        </Link>
        <Link
          to="/wishlist"
          className={`text-sm ${activePage === "wishlist" ? "font-medium text-gray-900" : "text-gray-500 hover:text-gray-900"}`}
        >
          Wishlist
        </Link>
        <span className="text-xs text-gray-400">{user?.username}</span>
        <button
          onClick={() => void handleSignOut()}
          className="text-xs text-gray-500 hover:text-gray-900"
        >
          Sign out
        </button>
      </nav>
    </header>
  );
}
