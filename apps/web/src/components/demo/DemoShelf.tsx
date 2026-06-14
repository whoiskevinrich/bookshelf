import { BookCover } from "../BookCover";

interface DemoBook {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
}

const SCI_FI: DemoBook[] = [
  {
    isbn: "9780441013593",
    title: "Dune",
    authors: ["Frank Herbert"],
    coverUrl: "/demo-covers/dune.jpg",
  },
  {
    isbn: "9780593135204",
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    coverUrl: "/demo-covers/project-hail-mary.jpg",
  },
  {
    isbn: "9780330518543",
    title: "Pandora's Star",
    authors: ["Peter F. Hamilton"],
    coverUrl: "/demo-covers/pandoras-star.jpg",
  },
  {
    isbn: "9780345303066",
    title: "2010: Odyssey Two",
    authors: ["Arthur C. Clarke"],
    coverUrl: "/demo-covers/2010-odyssey-two.jpg",
  },
  {
    isbn: "9780451228734",
    title: "Daemon",
    authors: ["Daniel Suarez"],
    coverUrl: "/demo-covers/daemon.jpg",
  },
];

const FANTASY: DemoBook[] = [
  {
    isbn: "9780593725443",
    title: "The Elfstones of Shannara",
    authors: ["Terry Brooks"],
    coverUrl: "/demo-covers/elfstones-shannara.jpg",
  },
  {
    isbn: "9780547951973",
    title: "The Hobbit",
    authors: ["J.R.R. Tolkien"],
    coverUrl: "/demo-covers/hobbit.jpg",
  },
  {
    isbn: "9780312367541",
    title: "A Wrinkle in Time",
    authors: ["Madeleine L'Engle"],
    coverUrl: "/demo-covers/wrinkle-in-time.jpg",
  },
  {
    isbn: "9780345484260",
    title: "Dragonflight",
    authors: ["Anne McCaffrey"],
    coverUrl: "/demo-covers/dragonflight.jpg",
  },
  {
    isbn: "9780552168335",
    title: "Pawn of Prophecy",
    authors: ["David Eddings"],
    coverUrl: "/demo-covers/pawn-of-prophecy.jpg",
  },
];

const LEADERSHIP: DemoBook[] = [
  {
    isbn: "9780241373668",
    title: "Leadership is Language",
    authors: ["L. David Marquet"],
    coverUrl: "/demo-covers/leadership-is-language.jpg",
  },
  {
    isbn: "9780241250945",
    title: "Turn the Ship Around!",
    authors: ["L. David Marquet"],
    coverUrl: "/demo-covers/turn-the-ship-around.jpg",
  },
  {
    isbn: "9780999743508",
    title: "Supportive Accountability",
    authors: ["Sylvia Melena"],
    coverUrl: "/demo-covers/supportive-accountability.jpg",
  },
  {
    isbn: "9781639015078",
    title: "Serve Up, Coach Down",
    authors: ["Nathan Jamail"],
    coverUrl: "/demo-covers/serve-up-coach-down.jpg",
  },
  {
    isbn: "9788178082530",
    title: "The Mythical Man-Month",
    authors: ["Frederick P. Brooks Jr."],
    coverUrl: "/demo-covers/mythical-man-month.jpg",
  },
];

const SHELVES = [
  { name: "Leadership", books: LEADERSHIP },
  { name: "Sci-Fi", books: SCI_FI },
  { name: "Fantasy", books: FANTASY },
];

const MAX_STAGGER_INDEX = 9;
const STAGGER_STEP_MS = 50;

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0">
        {title}
      </h3>
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
    </div>
  );
}

function BookGrid({ books, indexOffset = 0 }: { books: DemoBook[]; indexOffset?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
      {books.map((book, index) => (
        <div
          key={book.isbn}
          className="group flex flex-col gap-2 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors duration-200 animate-fade-up"
          style={{
            animationDelay: `${Math.min(indexOffset + index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS}ms`,
          }}
        >
          <BookCover
            key={book.coverUrl}
            coverUrl={book.coverUrl}
            title={book.title}
            authors={book.authors}
            className="h-44 sm:h-52 md:h-60 w-auto mx-auto rounded shadow-sm group-hover:scale-105 group-hover:shadow-md transition-all duration-200 ease-out"
          />
          <div>
            <p className="text-sm font-medium leading-tight dark:text-white">{book.title}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{book.authors.join(", ")}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function DemoShelf() {
  let offset = 0;
  return (
    <div className="space-y-8">
      {SHELVES.map(({ name, books }) => {
        const currentOffset = offset;
        offset += books.length;
        return (
          <section key={name}>
            <SectionHeader title={name} />
            <BookGrid books={books} indexOffset={currentOffset} />
          </section>
        );
      })}
    </div>
  );
}
