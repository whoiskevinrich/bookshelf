import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeSmartShelf } from "../../test/utils";
import type { TagCount } from "../../lib/api-client";
import {
  facetLabel,
  buildFilter,
  ruleToActive,
  parseFacet,
  isReadingListEntry,
  FacetBar,
  TagBrowsePanel,
  AuthorBrowsePanel,
  ActiveFilterBar,
  ActiveAuthorBar,
  ReadingListBar,
  LibrarySearchInput,
  SortControl,
  SmartShelvesGroup,
} from "./ShelfFilterControls";

describe("filter helpers", () => {
  it("facetLabel maps facet values to display labels", () => {
    expect(facetLabel("owned")).toBe("Owned");
    expect(facetLabel("finished")).toBe("Read");
    expect(facetLabel("unread")).toBe("Unread");
  });

  it("buildFilter returns null when neither facet nor tag is set", () => {
    expect(buildFilter(null, null)).toBeNull();
  });

  it("buildFilter maps facets to the right query shape", () => {
    expect(buildFilter("owned", null)).toEqual({ owned: true });
    expect(buildFilter("want", null)).toEqual({ want: true });
    expect(buildFilter("reading", null)).toEqual({ readingStatus: "reading" });
    expect(buildFilter("finished", null)).toEqual({ readingStatus: "finished" });
    expect(buildFilter("unread", null)).toEqual({ readingStatus: "unread" });
  });

  it("buildFilter combines a facet and a tag", () => {
    expect(buildFilter("owned", "sci-fi")).toEqual({ owned: true, tag: "sci-fi" });
  });

  it("ruleToActive is the inverse of buildFilter", () => {
    expect(ruleToActive({ owned: true })).toEqual({ facet: "owned", tag: null });
    expect(ruleToActive({ readingStatus: "reading" })).toEqual({ facet: "reading", tag: null });
    expect(ruleToActive({ want: true, tag: "fiction" })).toEqual({ facet: "want", tag: "fiction" });
    expect(ruleToActive({ tag: "fiction" })).toEqual({ facet: null, tag: "fiction" });
  });

  it("parseFacet accepts known facets and rejects anything else", () => {
    expect(parseFacet("want")).toBe("want");
    expect(parseFacet("finished")).toBe("finished");
    expect(parseFacet(null)).toBeNull();
    expect(parseFacet(undefined)).toBeNull();
    expect(parseFacet("")).toBeNull();
    expect(parseFacet("bogus")).toBeNull();
    expect(parseFacet("reading-list")).toBeNull(); // the composite view is not a facet
  });
});

describe("isReadingListEntry", () => {
  it("includes anything currently being read (owned or not)", () => {
    expect(isReadingListEntry({ owned: true, readingStatus: "reading" })).toBe(true);
    expect(isReadingListEntry({ owned: false, readingStatus: "reading" })).toBe(true);
  });

  it("includes owned books that aren't finished", () => {
    expect(isReadingListEntry({ owned: true, readingStatus: "unread" })).toBe(true);
    expect(isReadingListEntry({ owned: true, readingStatus: null })).toBe(true);
  });

  it("excludes finished books and unowned wishlist books", () => {
    expect(isReadingListEntry({ owned: true, readingStatus: "finished" })).toBe(false);
    expect(isReadingListEntry({ owned: false, readingStatus: "unread" })).toBe(false);
    expect(isReadingListEntry({ owned: false, readingStatus: null })).toBe(false);
  });
});

describe("FacetBar", () => {
  it("renders All + every facet as a status group", () => {
    render(<FacetBar facet={null} onSelect={() => {}} />);
    const group = screen.getByRole("group", { name: "Filter by status" });
    expect(group).toBeInTheDocument();
    for (const label of ["All", "Owned", "Wishlist", "Reading", "Read", "Unread"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the active facet with aria-pressed", () => {
    render(<FacetBar facet="owned" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Owned" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
  });

  it("selecting a facet reports it; re-selecting it toggles back to null", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(<FacetBar facet={null} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: "Owned" }));
    expect(onSelect).toHaveBeenLastCalledWith("owned");

    rerender(<FacetBar facet="owned" onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: "Owned" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe("TagBrowsePanel", () => {
  const tags: TagCount[] = [
    { tag: "fiction", count: 12 },
    { tag: "sci-fi", count: 5 },
    { tag: "non-fiction", count: 3 },
  ];

  it("prompts to add tags when there are none", () => {
    render(<TagBrowsePanel tags={[]} activeTag={null} onPick={() => {}} />);
    expect(screen.getByText(/Add tags to your books/i)).toBeInTheDocument();
  });

  it("renders each tag with its count and reports picks", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<TagBrowsePanel tags={tags} activeTag={null} onPick={onPick} />);

    expect(screen.getByRole("button", { name: /^fiction/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /sci-fi/ }));
    expect(onPick).toHaveBeenCalledWith("sci-fi");
  });

  it("filters tags by the search box (case-insensitive substring)", async () => {
    const user = userEvent.setup();
    render(<TagBrowsePanel tags={tags} activeTag={null} onPick={() => {}} />);

    await user.type(screen.getByRole("textbox", { name: "Filter by tag" }), "SCI");
    expect(screen.getByRole("button", { name: /sci-fi/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^fiction/ })).not.toBeInTheDocument();
  });

  it("shows a no-match message when the query matches nothing", async () => {
    const user = userEvent.setup();
    render(<TagBrowsePanel tags={tags} activeTag={null} onPick={() => {}} />);
    await user.type(screen.getByRole("textbox", { name: "Filter by tag" }), "zzz");
    expect(screen.getByText(/No tags match/)).toBeInTheDocument();
  });
});

describe("LibrarySearchInput", () => {
  it("renders a labelled search box and reports typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LibrarySearchInput value="" onChange={onChange} matchCount={null} />);

    const box = screen.getByRole("searchbox", { name: "Search your library" });
    expect(box).toBeInTheDocument();
    await user.type(box, "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("shows a clear button only when there is a value, and clears on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <LibrarySearchInput value="" onChange={onChange} matchCount={null} />,
    );
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    rerender(<LibrarySearchInput value="dune" onChange={onChange} matchCount={2} />);
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("renders no count when idle and a pluralized count otherwise", () => {
    const { rerender } = render(
      <LibrarySearchInput value="" onChange={() => {}} matchCount={null} />,
    );
    expect(screen.queryByText(/match/)).not.toBeInTheDocument();

    rerender(<LibrarySearchInput value="dune" onChange={() => {}} matchCount={1} />);
    expect(screen.getByText("1 match")).toBeInTheDocument();

    rerender(<LibrarySearchInput value="the" onChange={() => {}} matchCount={4} />);
    expect(screen.getByText("4 matches")).toBeInTheDocument();

    rerender(<LibrarySearchInput value="zzz" onChange={() => {}} matchCount={0} />);
    expect(screen.getByText("0 matches")).toBeInTheDocument();
  });
});

describe("AuthorBrowsePanel", () => {
  const authors = [
    { author: "Frank Herbert", count: 3 },
    { author: "Isaac Asimov", count: 1 },
  ];

  it("lists authors with counts and reports the pick", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<AuthorBrowsePanel authors={authors} activeAuthor={null} onPick={onPick} />);

    await user.click(screen.getByRole("button", { name: /Frank Herbert/ }));
    expect(onPick).toHaveBeenCalledWith("Frank Herbert");
  });

  it("filters the list by the typed query", async () => {
    const user = userEvent.setup();
    render(<AuthorBrowsePanel authors={authors} activeAuthor={null} onPick={() => {}} />);

    await user.type(screen.getByRole("textbox", { name: "Filter by author" }), "asimov");
    expect(screen.getByRole("button", { name: /Isaac Asimov/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Frank Herbert/ })).not.toBeInTheDocument();
  });

  it("shows an empty hint when there is no author data", () => {
    render(<AuthorBrowsePanel authors={[]} activeAuthor={null} onPick={() => {}} />);
    expect(screen.getByText(/no author data yet/i)).toBeInTheDocument();
  });
});

describe("ActiveAuthorBar", () => {
  it("shows the author and clears on both affordances", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<ActiveAuthorBar author="Ursula K. Le Guin" count={4} onClear={onClear} />);

    expect(screen.getByText("→ 4 books")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Remove author Ursula K. Le Guin filter" }),
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(2);
  });
});

describe("SortControl", () => {
  it("renders the current selection and reports changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortControl value="added-desc" onChange={onChange} />);

    const select = screen.getByRole("combobox", { name: "Sort books" });
    expect(select).toHaveValue("added-desc");

    await user.selectOptions(select, "title-asc");
    expect(onChange).toHaveBeenCalledWith("title-asc");
  });

  it("groups the options by field", () => {
    render(<SortControl value="added-desc" onChange={() => {}} />);
    // optgroup labels expose the grouping to assistive tech.
    for (const group of ["Date added", "Title", "Author", "Release date"]) {
      expect(screen.getByRole("group", { name: group })).toBeInTheDocument();
    }
  });
});

describe("ActiveFilterBar", () => {
  const handlers = {
    onRemoveFacet: vi.fn(),
    onRemoveTag: vi.fn(),
    onClear: vi.fn(),
    onSave: vi.fn(),
  };

  it("renders facet + tag chips and a pluralized count", () => {
    render(<ActiveFilterBar facet="owned" tag="sci-fi" count={3} {...handlers} canSave />);
    expect(screen.getByText("Owned")).toBeInTheDocument();
    expect(screen.getByText("#sci-fi")).toBeInTheDocument();
    expect(screen.getByText("→ 3 books")).toBeInTheDocument();
  });

  it("singularizes the count for one book", () => {
    render(<ActiveFilterBar facet="owned" tag={null} count={1} {...handlers} canSave={false} />);
    expect(screen.getByText("→ 1 book")).toBeInTheDocument();
  });

  it("hides the save button when canSave is false", () => {
    render(<ActiveFilterBar facet="owned" tag={null} count={2} {...handlers} canSave={false} />);
    expect(screen.queryByRole("button", { name: "Save as smart shelf" })).not.toBeInTheDocument();
  });

  it("wires the remove/clear/save actions", async () => {
    const user = userEvent.setup();
    const fns = {
      onRemoveFacet: vi.fn(),
      onRemoveTag: vi.fn(),
      onClear: vi.fn(),
      onSave: vi.fn(),
    };
    render(<ActiveFilterBar facet="owned" tag="sci-fi" count={2} {...fns} canSave />);

    await user.click(screen.getByRole("button", { name: "Remove Owned filter" }));
    expect(fns.onRemoveFacet).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove tag sci-fi filter" }));
    expect(fns.onRemoveTag).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save as smart shelf" }));
    expect(fns.onSave).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(fns.onClear).toHaveBeenCalled();
  });
});

describe("ReadingListBar", () => {
  it("labels the view and pluralizes the count", () => {
    const { rerender } = render(<ReadingListBar count={3} onClear={() => {}} />);
    expect(screen.getByRole("group", { name: "Reading list" })).toBeInTheDocument();
    expect(screen.getByText("→ 3 books")).toBeInTheDocument();
    rerender(<ReadingListBar count={1} onClear={() => {}} />);
    expect(screen.getByText("→ 1 book")).toBeInTheDocument();
  });

  it("wires the clear action", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<ReadingListBar count={2} onClear={onClear} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe("SmartShelvesGroup", () => {
  it("renders nothing when there are no smart shelves", () => {
    const { container } = render(
      <SmartShelvesGroup shelves={[]} onApply={() => {}} onDelete={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("applies and deletes a smart shelf via its buttons", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onDelete = vi.fn();
    const shelf = makeSmartShelf({ name: "Currently reading", count: 4 });
    render(<SmartShelvesGroup shelves={[shelf]} onApply={onApply} onDelete={onDelete} />);

    await user.click(
      screen.getByRole("button", { name: "Open smart shelf Currently reading (4 books)" }),
    );
    expect(onApply).toHaveBeenCalledWith(shelf);

    await user.click(screen.getByRole("button", { name: "Delete smart shelf Currently reading" }));
    expect(onDelete).toHaveBeenCalledWith(shelf);
  });
});
