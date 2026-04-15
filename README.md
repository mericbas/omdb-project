# CineSearch — OMDB Movie & Series Explorer

A fully responsive, feature-rich Single Page Application for searching movies, series and episodes using the [OMDb API](https://www.omdbapi.com/). Built as part of the i2i Systems internship application.

**Live Demo → [mericbas.github.io/omdb-project](https://mericbas.github.io/omdb-project)**

---

## Screenshot

<img width="2551" height="1476" alt="Ekran görüntüsü 2026-04-15 114610" src="https://github.com/user-attachments/assets/4eeba4cd-6f04-4376-8b24-a842ec54cb86" />

---

## Features

| Feature | Detail |
|---|---|
| **Movie Search** | Search by title with real-time results from OMDb API |
| **Advanced Filters** | Filter by type (Movie / Series / Episode) and release year |
| **Results Grid** | Responsive card grid — 1 → 2 → 3 → 4 columns |
| **Poster Handling** | Shows poster image; falls back to a styled placeholder when unavailable |
| **Detail Modal** | Full info overlay: ratings (IMDb / RT / Metascore), plot, cast, awards, box office |
| **Pagination** | Page controls with smart ellipsis; uses API `totalResults` |
| **Search Persistence** | Last search (query, filters, results, page) saved to `localStorage` and restored on reload |
| **In-Memory Cache** | Repeat searches served instantly from JS cache, no extra network requests |
| **Debounce** | Rapid button clicks trigger only one API call |
| **Error Handling** | Distinct messages for empty query, no results, and network failures |
| **Keyboard & A11y** | ESC closes modal; Enter opens card; ARIA roles; focus management |
| **Dark Theme** | CSS custom properties, smooth transitions, hover effects |
| **Responsive** | Mobile-first; modal goes near-fullscreen on small screens |

---

## Tech Stack

- **HTML5** — semantic markup
- **CSS3** — custom properties, Grid, Flexbox, `clamp()`, `@media`, `@keyframes`
- **JavaScript (ES6+)** — `async/await`, `const/let`, arrow functions, template literals, destructuring, `Map`, `URLSearchParams`
- **OMDb API** — movie data source
- **GitHub Pages** — static hosting

No frameworks, no build tools, no dependencies.

---

## Project Structure

```
omdb-project/
├── index.html        # App shell & markup
├── css/
│   └── style.css     # All styles (dark theme, layout, animations)
├── js/
│   └── app.js        # App logic (state, API, render, cache, storage, events)
└── README.md
```

---

## How to Run Locally

```bash
# Clone the repository
git clone https://github.com/mericbas/omdb-project.git
cd omdb-project

# Option 1 — open directly in browser
open index.html

# Option 2 — serve with any static server (avoids potential CORS quirks)
npx serve .
# or
python -m http.server 8080
```

Then navigate to `http://localhost:8080` (or whatever port your server uses).

---

## Architecture Notes

`app.js` is organised into clearly separated layers:

```
CONFIG       — API key, base URL, constants (no magic numbers)
STATE        — single source-of-truth object + setState()
CACHE        — Map-based in-memory cache keyed by query+type+year+page
STORAGE      — localStorage helpers (save / load)
API          — fetchSearchResults() + fetchTitleDetail() with try/catch
RENDER       — buildMovieCard(), buildModalHTML(), renderResults()
UI HELPERS   — show/hide individual UI regions
MODAL        — openModal(), closeModal()
PAGINATION   — buildPageRange(), renderPagination(), goToPage()
SEARCH       — performSearch() orchestrator + debouncedSearch()
EVENTS       — all addEventListener() bindings in one place
INIT         — DOMContentLoaded bootstrap
```

---

## API Attribution

This product uses the **[OMDb API](https://www.omdbapi.com/)** but is not endorsed or certified by OMDb.
