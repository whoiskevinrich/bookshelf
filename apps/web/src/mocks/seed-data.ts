import type { ShelfEntry } from "../lib/api-client";

export const MOCK_SHELF: ShelfEntry[] = [
  {
    isbn: "9780593099322",
    status: "owned",
    addedAt: "2024-09-01T10:00:00Z",
    notes: null,
    book: {
      title: "The Way of Kings",
      authors: ["Brandon Sanderson"],
      coverUrl: "https://covers.openlibrary.org/b/isbn/9780593099322-M.jpg",
      publishedYear: 2010,
      description: "An epic fantasy novel set on the storm-ravaged world of Roshar.",
    },
  },
  {
    isbn: "9780765326355",
    status: "owned",
    addedAt: "2024-10-15T08:30:00Z",
    notes: "Great for long flights",
    book: {
      title: "The Name of the Wind",
      authors: ["Patrick Rothfuss"],
      coverUrl: "https://covers.openlibrary.org/b/isbn/9780765326355-M.jpg",
      publishedYear: 2007,
      description: "A hero named Kvothe recounts his extraordinary life.",
    },
  },
  {
    isbn: "9780316346627",
    status: "want",
    addedAt: "2025-01-20T14:00:00Z",
    notes: null,
    book: {
      title: "Words of Radiance",
      authors: ["Brandon Sanderson"],
      coverUrl: "https://covers.openlibrary.org/b/isbn/9780316346627-M.jpg",
      publishedYear: 2014,
      description: "The second book in The Stormlight Archive.",
    },
  },
  {
    isbn: "9780553573404",
    status: "want",
    addedAt: "2025-03-05T09:00:00Z",
    notes: null,
    book: {
      title: "A Game of Thrones",
      authors: ["George R.R. Martin"],
      coverUrl: "https://covers.openlibrary.org/b/isbn/9780553573404-M.jpg",
      publishedYear: 1996,
      description: "The first book in the A Song of Ice and Fire series.",
    },
  },
];
