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
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780441013593-M.jpg",
  },
  {
    isbn: "9780441569595",
    title: "Neuromancer",
    authors: ["William Gibson"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780441569595-M.jpg",
  },
  {
    isbn: "9780441478125",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780441478125-M.jpg",
  },
  {
    isbn: "9780593135204",
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780593135204-M.jpg",
  },
  {
    isbn: "9780756404741",
    title: "The Name of the Wind",
    authors: ["Patrick Rothfuss"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780756404741-M.jpg",
  },
];

const WANT: DemoBook[] = [
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
    isbn: "9781447273127",
    title: "Children of Time",
    authors: ["Adrian Tchaikovsky"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9781447273127-M.jpg",
  },
  {
    isbn: "9780812515282",
    title: "A Fire Upon the Deep",
    authors: ["Vernor Vinge"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780812515282-M.jpg",
  },
  {
    isbn: "9781635575637",
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9781635575637-M.jpg",
  },
];

function BookGrid({ books }: { books: DemoBook[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
      {books.map((book) => (
        <div key={book.isbn} className="flex flex-col gap-2">
          <BookCover
            coverUrl={book.coverUrl}
            title={book.title}
            className="w-full aspect-[2/3] rounded shadow-sm"
          />
          <div>
            <p className="text-sm font-medium leading-tight">{book.title}</p>
            <p className="text-xs text-gray-500">{book.authors.join(", ")}</p>
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
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">Owned</h3>
        <BookGrid books={OWNED} />
      </section>
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">
          Want to Read
        </h3>
        <BookGrid books={WANT} />
      </section>
    </div>
  );
}
