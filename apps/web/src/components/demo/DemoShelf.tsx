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
    isbn: "9780441569595",
    title: "Neuromancer",
    authors: ["William Gibson"],
    coverUrl: "/demo-covers/neuromancer.jpg",
  },
  {
    isbn: "9780593135204",
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    coverUrl: "/demo-covers/project-hail-mary.jpg",
  },
  {
    isbn: "9781447273127",
    title: "Children of Time",
    authors: ["Adrian Tchaikovsky"],
    coverUrl: "/demo-covers/children-of-time.jpg",
  },
  {
    isbn: "9780812515282",
    title: "A Fire Upon the Deep",
    authors: ["Vernor Vinge"],
    coverUrl: "/demo-covers/fire-upon-the-deep.jpg",
  },
];

const FANTASY: DemoBook[] = [
  {
    isbn: "9780756404741",
    title: "The Name of the Wind",
    authors: ["Patrick Rothfuss"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780756404741-M.jpg",
  },
  {
    isbn: "9780765326355",
    title: "The Way of Kings",
    authors: ["Brandon Sanderson"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780765326355-M.jpg",
  },
  {
    isbn: "9780316229296",
    title: "The Fifth Season",
    authors: ["N.K. Jemisin"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780316229296-M.jpg",
  },
  {
    isbn: "9781635575637",
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    coverUrl: "/demo-covers/piranesi.jpg",
  },
  {
    isbn: "9780441478125",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780441478125-M.jpg",
  },
];

const LEADERSHIP: DemoBook[] = [
  {
    isbn: "9780062663986",
    title: "Extreme Ownership",
    authors: ["Jocko Willink", "Leif Babin"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780062663986-M.jpg",
  },
  {
    isbn: "9781501156700",
    title: "Leaders Eat Last",
    authors: ["Simon Sinek"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9781501156700-M.jpg",
  },
  {
    isbn: "9781591845379",
    title: "Start with Why",
    authors: ["Simon Sinek"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9781591845379-M.jpg",
  },
  {
    isbn: "9780062455628",
    title: "The Hard Thing About Hard Things",
    authors: ["Ben Horowitz"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780062455628-M.jpg",
  },
  {
    isbn: "9780062309471",
    title: "The Effective Executive",
    authors: ["Peter F. Drucker"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780062309471-M.jpg",
  },
];

const SHELVES = [
  { name: "Sci-Fi", books: SCI_FI },
  { name: "Fantasy", books: FANTASY },
  { name: "Leadership", books: LEADERSHIP },
];

const MAX_STAGGER_INDEX = 9;
const STAGGER_STEP_MS = 50;

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 shrink-0">
        {title}
      </h3>
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
      <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-200 dark:bg-slate-800 rounded-full px-2 py-0.5">
        {count}
      </span>
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
            <SectionHeader title={name} count={books.length} />
            <BookGrid books={books} indexOffset={currentOffset} />
          </section>
        );
      })}
    </div>
  );
}
