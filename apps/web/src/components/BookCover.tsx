import { useState, useEffect } from "react";

interface BookCoverProps {
  coverUrl: string | null;
  title: string;
  authors?: string[];
  className?: string;
}

export function BookCover({ coverUrl, title, authors, className = "" }: BookCoverProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [coverUrl]);

  if (!coverUrl || failed) {
    const authorLine = authors?.length ? authors.join(", ") : null;
    return (
      <div
        className={`flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-700 overflow-hidden p-1.5 gap-0.5 ${className}`}
        aria-label={authorLine ? `${title} by ${authorLine}` : title}
      >
        <p className="text-[0.6rem] font-semibold text-slate-700 dark:text-slate-200 text-center leading-tight line-clamp-3 w-full">
          {title}
        </p>
        {authorLine && (
          <p className="text-[0.55rem] text-slate-500 dark:text-slate-400 text-center leading-tight line-clamp-2 w-full">
            {authorLine}
          </p>
        )}
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
