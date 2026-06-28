/**
 * Seeds the dev DynamoDB table with demo shelf data.
 *
 * Usage:
 *   pnpm --filter @bookshelf/api db:seed
 *
 * Reads from .env.local:
 *   DYNAMODB_TABLE_NAME — defaults to bookshelf
 *   LOCAL_DEV_USER_ID   — Cognito userId to seed the shelf under
 *   AWS credentials     — via standard AWS SDK credential chain (env vars, ~/.aws, etc.)
 */
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env["DYNAMODB_TABLE_NAME"] ?? "bookshelf";
const USER_ID = process.env["LOCAL_DEV_USER_ID"];

if (!USER_ID) {
  console.error(
    "LOCAL_DEV_USER_ID is not set in .env.local.\n" +
      "Find your Cognito userId in the AWS Console → Cognito → User Pools → Users,\n" +
      "then add LOCAL_DEV_USER_ID=<your-id> to apps/api/.env.local and re-run.",
  );
  process.exit(1);
}

const raw = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(raw);

// ── Table ──────────────────────────────────────────────────────────────────

async function ensureTable(): Promise<void> {
  try {
    await raw.send(
      new CreateTableCommand({
        TableName: TABLE,
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
        ],
      }),
    );
    console.log(`✓ Created table "${TABLE}"`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`  Table "${TABLE}" already exists — skipping create`);
    } else {
      throw err;
    }
  }

  // Wait until ACTIVE
  for (let i = 0; i < 10; i++) {
    const { Table } = await raw.send(new DescribeTableCommand({ TableName: TABLE }));
    if (Table?.TableStatus === "ACTIVE") break;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ── Seed data ──────────────────────────────────────────────────────────────

interface BookSeed {
  isbn: string;
  title: string;
  authors: string[];
  coverUrl: string;
  publishedYear: number;
  description: string;
  status: "owned" | "want";
}

const BOOKS: BookSeed[] = [
  {
    isbn: "9780441013593",
    title: "Dune",
    authors: ["Frank Herbert"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780441013593-M.jpg",
    publishedYear: 1965,
    description: "A sweeping tale of politics, religion, and ecology on the desert planet Arrakis.",
    status: "owned",
  },
  {
    isbn: "9780441569595",
    title: "Neuromancer",
    authors: ["William Gibson"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780441569595-M.jpg",
    publishedYear: 1984,
    description: "The novel that defined cyberpunk. A washed-up hacker hired for one last job.",
    status: "owned",
  },
  {
    isbn: "9780441478125",
    title: "The Left Hand of Darkness",
    authors: ["Ursula K. Le Guin"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780441478125-M.jpg",
    publishedYear: 1969,
    description: "A lone envoy navigates the politics of a world without fixed gender.",
    status: "owned",
  },
  {
    isbn: "9780593135204",
    title: "Project Hail Mary",
    authors: ["Andy Weir"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780593135204-M.jpg",
    publishedYear: 2021,
    description: "A lone astronaut must save Earth from an extinction-level threat.",
    status: "owned",
  },
  {
    isbn: "9780756404741",
    title: "The Name of the Wind",
    authors: ["Patrick Rothfuss"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780756404741-M.jpg",
    publishedYear: 2007,
    description: "The story of Kvothe, a legendary figure, told in his own words.",
    status: "owned",
  },
  {
    isbn: "9780765326355",
    title: "The Way of Kings",
    authors: ["Brandon Sanderson"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780765326355-M.jpg",
    publishedYear: 2010,
    description: "Epic fantasy set on a world battered by magical storms.",
    status: "want",
  },
  {
    isbn: "9780316229296",
    title: "The Fifth Season",
    authors: ["N.K. Jemisin"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780316229296-M.jpg",
    publishedYear: 2015,
    description: "A world that ends catastrophically on a regular basis. Three women. One fate.",
    status: "want",
  },
  {
    isbn: "9781447273127",
    title: "Children of Time",
    authors: ["Adrian Tchaikovsky"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9781447273127-M.jpg",
    publishedYear: 2015,
    description: "The last remnants of humanity race to claim an ancient terraformed world.",
    status: "want",
  },
  {
    isbn: "9780812515282",
    title: "A Fire Upon the Deep",
    authors: ["Vernor Vinge"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9780812515282-M.jpg",
    publishedYear: 1992,
    description: "In a universe where intelligence depends on location, a rescue mission unfolds.",
    status: "want",
  },
  {
    isbn: "9781635575637",
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    coverUrl: "https://covers.openlibrary.org/b/isbn/9781635575637-M.jpg",
    publishedYear: 2020,
    description: "A man lives in a surreal house of infinite halls and tidal statues.",
    status: "want",
  },
];

async function seed(): Promise<void> {
  const addedAt = new Date().toISOString();
  const items = BOOKS.flatMap((book) => {
    const { isbn, status, title, authors, coverUrl, publishedYear, description } = book;
    return [
      // Shelf entry for the user — ENTRY#<isbn> key with independent owned/want
      // attributes (ADR-019); matches the schema queryBookEntries reads.
      {
        PutRequest: {
          Item: {
            PK: `USER#${USER_ID}`,
            SK: `ENTRY#${isbn}`,
            isbn,
            owned: status === "owned",
            want: status === "want",
            readingStatus: null,
            addedAt,
            notes: null,
          },
        },
      },
      // Book metadata cache
      {
        PutRequest: {
          Item: {
            PK: `BOOK#${isbn}`,
            SK: "METADATA",
            isbn,
            title,
            authors,
            coverUrl,
            publishedYear,
            description,
            cachedAt: addedAt,
          },
        },
      },
    ];
  });

  // BatchWrite in chunks of 25 (DynamoDB limit)
  for (let i = 0; i < items.length; i += 25) {
    await db.send(new BatchWriteCommand({ RequestItems: { [TABLE]: items.slice(i, i + 25) } }));
  }

  console.log(`✓ Seeded ${BOOKS.length} books for user ${USER_ID}`);
  console.log(`  Owned : ${BOOKS.filter((b) => b.status === "owned").length}`);
  console.log(`  Want  : ${BOOKS.filter((b) => b.status === "want").length}`);
}

// ── Run ────────────────────────────────────────────────────────────────────

await ensureTable();
await seed();
console.log("\nDone. Start the API with: pnpm --filter @bookshelf/api dev");
