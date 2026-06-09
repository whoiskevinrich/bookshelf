# Runbook: Cover Image Sourcing

## Overview

Book cover images come from Google Books (primary) and OpenLibrary (fallback). Both sources have failure modes that require a specific lookup sequence to handle correctly.

## Source hierarchy

1. **Google Books** — returned as `thumbnail` in the Books API response. Already handled by `apps/api/src/lib/books/providers/google-books.ts` (`extractCoverUrl`). Returns `null` when no image is available.
2. **OpenLibrary by cover ID** — most reliable OpenLibrary path; requires a search to get the ID first.
3. **OpenLibrary by ISBN** — fastest OpenLibrary path, but has a silent-failure mode (see below).
4. **Placeholder** — `BookCover` component renders title + author when `coverUrl` is `null` or the image load fails.

## Critical: OpenLibrary silent failure

OpenLibrary's ISBN cover endpoint **always returns HTTP 200**, even when no cover exists. Missing covers return a 43-byte GIF (`GIF89a` header), not a 404.

```
GET https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg
→ 200 OK, 43 bytes  ← means "no cover", not success
→ 200 OK, >1 KB     ← real cover image
```

**Always check `Content-Length` (or the downloaded file size) against a minimum threshold of ~500 bytes before trusting an ISBN-based cover response.**

## Fallback sequence when Google Books returns no cover

```
1. GET https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg
   → if response >= 500 bytes: use it ✓
   → if response < 500 bytes: proceed to step 2

2. GET https://openlibrary.org/search.json
       ?q={title}+{author}&fields=cover_i&limit=1
   → if cover_i present:
       GET https://covers.openlibrary.org/b/id/{cover_i}-L.jpg ✓
   → if no cover_i: coverUrl = null (show placeholder)
```

### Example (curl)

```bash
# Step 1 — try ISBN cover, check size
curl -sI "https://covers.openlibrary.org/b/isbn/9781447273127-L.jpg" | grep content-length
# content-length: 43  ← no cover, proceed to step 2

# Step 2 — find cover_i via search
curl -s "https://openlibrary.org/search.json?q=children+of+time+tchaikovsky&fields=cover_i&limit=1" \
  | jq '.docs[0].cover_i'
# 8264706

# Fetch the real cover
curl -o cover.jpg "https://covers.openlibrary.org/b/id/8264706-L.jpg"
```

## Image size variants

Both endpoints support `-S`, `-M`, `-L` suffixes on the filename:

- `-S` — small (~80px wide)
- `-M` — medium (~180px wide)
- `-L` — large (~400px wide)

Use `-L` when storing to cache; the frontend can resize via CSS.

## Demo shelf covers

`DemoShelf.tsx` uses locally bundled covers from `apps/web/public/demo-covers/` rather than external URLs. This ensures the landing page always renders correctly regardless of OpenLibrary availability. When replacing or adding a demo book, download its cover using the fallback sequence above and store it in that directory.

## No cover found

When all sources fail, `coverUrl` should be stored as `null` in DynamoDB. The `BookCover` component then renders the placeholder (title + author) automatically — no special handling required at call sites.
