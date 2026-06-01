import { useState } from "react";

interface BookCoverProps {
  coverUrl: string | null;
  title: string;
  className?: string;
}

export function BookCover({ coverUrl, title, className = "" }: BookCoverProps) {
  const [failed, setFailed] = useState(false);

  if (!coverUrl || failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-100 dark:bg-zinc-700 text-gray-400 dark:text-zinc-400 text-xs text-center p-2 leading-tight ${className}`}
        aria-label={title}
      >
        {title}
      </div>
    );
  }

  return (
    <img
      src={coverUrl}
      alt={title}
      className={`object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
