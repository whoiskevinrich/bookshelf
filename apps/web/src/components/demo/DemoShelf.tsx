import { BookCover } from "../BookCover";

interface DemoBook {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string;
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
    isbn: "9780345461612",
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
    isbn: "9780345300553",
    title: "The Elfstones of Shannara",
    authors: ["Terry Brooks"],
    coverUrl: "/demo-covers/elfstones-shannara.jpg",
  },
  {
    isbn: "9780547928227",
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
    isbn: "9780345277122",
    title: "Dragonflight",
    authors: ["Anne McCaffrey"],
    coverUrl: "/demo-covers/dragonflight.jpg",
  },
  {
    isbn: "9780345335487",
    title: "Pawn of Prophecy",
    authors: ["David Eddings"],
    coverUrl: "/demo-covers/pawn-of-prophecy.jpg",
  },
];

const LEADERSHIP: DemoBook[] = [
  {
    isbn: "9780062663986",
    title: "Extreme Ownership",
    authors: ["Jocko Willink", "Leif Babin"],
    coverUrl: "/demo-covers/extreme-ownership.jpg",
  },
  {
    isbn: "9781501156700",
    title: "Leaders Eat Last",
    authors: ["Simon Sinek"],
    coverUrl: "/demo-covers/leaders-eat-last.jpg",
  },
  {
    isbn: "9781591845379",
    title: "Start with Why",
    authors: ["Simon Sinek"],
    coverUrl: "/demo-covers/start-with-why.jpg",
  },
  {
    isbn: "9780062455628",
    title: "The Hard Thing About Hard Things",
    authors: ["Ben Horowitz"],
    coverUrl: "/demo-covers/hard-thing.jpg",
  },
  {
    isbn: "9780062309471",
    title: "The Effective Executive",
    authors: ["Peter F. Drucker"],
    coverUrl: "/demo-covers/effective-executive.jpg",
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
            className="w-full aspect-[2/3] rounded shadow-sm group-hover:scale-105 group-hover:shadow-md transition-all duration-200 ease-out"
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
