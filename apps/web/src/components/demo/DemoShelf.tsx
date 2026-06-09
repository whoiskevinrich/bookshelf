import { BookCover } from "../BookCover";

interface DemoBook {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string;
}

const OWNED: DemoBook[] = [
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
    isbn: "9780441478125",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    coverUrl: "/demo-covers/left-hand.jpg",
  },
  {
    isbn: "9780593135204",
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    coverUrl: "/demo-covers/project-hail-mary.jpg",
  },
  {
    isbn: "9780756404741",
    title: "The Name of the Wind",
    authors: ["Patrick Rothfuss"],
    coverUrl: "/demo-covers/name-of-the-wind.jpg",
  },
];

const WANT: DemoBook[] = [
  {
    isbn: "9780765326355",
    title: "The Way of Kings",
    authors: ["Brandon Sanderson"],
    coverUrl: "/demo-covers/way-of-kings.jpg",
  },
  {
    isbn: "9780316229296",
    title: "The Fifth Season",
    authors: ["N.K. Jemisin"],
    coverUrl: "/demo-covers/fifth-season.jpg",
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
  {
    isbn: "9781635575637",
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    coverUrl: "/demo-covers/piranesi.jpg",
  },
];

// Stagger constants — mirror ShelfBookCard for visual consistency
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
  return (
    <div className="space-y-8">
      <section>
        <SectionHeader title="Owned" count={OWNED.length} />
        <BookGrid books={OWNED} indexOffset={0} />
      </section>
      <section>
        <SectionHeader title="Want to Read" count={WANT.length} />
        {/* Offset by OWNED.length so Want to Read stagger continues from where Owned left off */}
        <BookGrid books={WANT} indexOffset={OWNED.length} />
      </section>
    </div>
  );
}
