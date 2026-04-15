/**
 * @file app.js
 * @description CineSearch — OMDB Movie Search SPA
 *   Vanilla ES6+ JavaScript. No external dependencies.
 *
 *   Architecture:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  CONFIG      — API keys, base URLs, magic constants      │
 *   │  STATE       — Single source of truth for app state      │
 *   │  CACHE       — In-memory request cache                   │
 *   │  STORAGE     — localStorage read/write helpers           │
 *   │  API         — Fetch wrappers for OMDB endpoints         │
 *   │  RENDER      — Pure DOM-construction functions           │
 *   │  UI          — Show/hide sections, update status         │
 *   │  MODAL       — Open / close / populate detail modal      │
 *   │  PAGINATION  — Build & render page controls              │
 *   │  SEARCH      — Orchestrates a full search flow           │
 *   │  EVENTS      — All addEventListener bindings             │
 *   │  INIT        — Bootstrap on DOMContentLoaded             │
 *   └─────────────────────────────────────────────────────────┘
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════════════════ */

/** @constant {string} OMDB API key */
const API_KEY = '388cf871';

/** @constant {string} Base URL for OMDB API */
const BASE_URL = 'https://www.omdbapi.com/';

/** @constant {number} Results returned per page by the OMDB API */
const RESULTS_PER_PAGE = 10;

/** @constant {number} Max page buttons to show around current page */
const MAX_PAGE_BUTTONS = 5;

/** @constant {string} localStorage key for persisting search state */
const STORAGE_KEY = 'cinesearch_last_state';

/** @constant {number} Debounce delay in ms to prevent rapid duplicate fetches */
const DEBOUNCE_DELAY = 400;

/** @constant {string} Placeholder used by OMDB when no poster is available */
const NO_POSTER_VALUE = 'N/A';


/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */

/**
 * @typedef {Object} AppState
 * @property {string}   query       - Current search query
 * @property {string}   type        - Content type filter ('', 'movie', 'series', 'episode')
 * @property {string}   year        - Release year filter ('' or 4-digit string)
 * @property {number}   page        - Current page (1-indexed)
 * @property {number}   totalResults - Total results returned by last search
 * @property {Array}    results     - Current page of results
 * @property {boolean}  isLoading   - Whether a search is in progress
 */

/** @type {AppState} */
const state = {
  query:        '',
  type:         '',
  year:         '',
  page:         1,
  totalResults: 0,
  results:      [],
  isLoading:    false,
};

/**
 * Updates state and optionally persists it.
 * @param {Partial<AppState>} patch
 * @param {boolean} [persist=false] - Whether to save to localStorage
 */
function setState(patch, persist = false) {
  Object.assign(state, patch);
  if (persist) saveStateToStorage();
}


/* ═══════════════════════════════════════════════════════════
   CACHE
═══════════════════════════════════════════════════════════ */

/**
 * Simple in-memory cache keyed by "<query>_<type>_<year>_<page>".
 * @type {Map<string, {totalResults: number, results: Array}>}
 */
const searchCache = new Map();

/**
 * Builds a cache key from search parameters.
 * @param {string} query
 * @param {string} type
 * @param {string} year
 * @param {number} page
 * @returns {string}
 */
function buildCacheKey(query, type, year, page) {
  return `${query.toLowerCase()}_${type}_${year}_${page}`;
}

/**
 * Returns cached search results, or null if not cached.
 * @param {string} key
 * @returns {{totalResults: number, results: Array}|null}
 */
function getCached(key) {
  return searchCache.get(key) ?? null;
}

/**
 * Stores search results in the cache.
 * @param {string} key
 * @param {{totalResults: number, results: Array}} data
 */
function setCached(key, data) {
  searchCache.set(key, data);
}


/* ═══════════════════════════════════════════════════════════
   STORAGE  (localStorage)
═══════════════════════════════════════════════════════════ */

/**
 * Saves the current search state (query, type, year, page, results) to
 * localStorage so it can be restored after a page refresh.
 */
function saveStateToStorage() {
  try {
    const snapshot = {
      query:        state.query,
      type:         state.type,
      year:         state.year,
      page:         state.page,
      totalResults: state.totalResults,
      results:      state.results,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (err) {
    // localStorage unavailable or quota exceeded — silently ignore
    console.warn('[Storage] Failed to save state:', err);
  }
}

/**
 * Loads the last search state from localStorage.
 * @returns {AppState|null} The restored state, or null if nothing was stored.
 */
function loadStateFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[Storage] Failed to load state:', err);
    return null;
  }
}


/* ═══════════════════════════════════════════════════════════
   API
═══════════════════════════════════════════════════════════ */

/**
 * Performs a search query against the OMDB API.
 * Returns parsed JSON data or throws on network / API error.
 *
 * @param {string} query   - Search term
 * @param {string} type    - Content type filter ('' | 'movie' | 'series' | 'episode')
 * @param {string} year    - Release year filter ('' or 4-digit string)
 * @param {number} page    - Page number (1-indexed)
 * @returns {Promise<{Search: Array, totalResults: string, Response: string}>}
 * @throws {Error} On network failure or API-level error
 */
async function fetchSearchResults(query, type, year, page) {
  const params = new URLSearchParams({
    apikey: API_KEY,
    s:      query,
    page:   String(page),
  });

  if (type) params.set('type', type);
  if (year) params.set('y', year);

  const url = `${BASE_URL}?${params.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Network error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.Response === 'False') {
    const err = new Error(data.Error ?? 'No results found.');
    err.isApiError = true;
    throw err;
  }

  return data;
}

/**
 * Fetches full details for a specific title by its IMDB ID.
 *
 * @param {string} imdbId - The IMDB ID (e.g. 'tt1375666')
 * @returns {Promise<Object>} Full movie/series detail object
 * @throws {Error} On network failure or API-level error
 */
async function fetchTitleDetail(imdbId) {
  const params = new URLSearchParams({
    apikey: API_KEY,
    i:      imdbId,
    plot:   'full',
  });

  const url = `${BASE_URL}?${params.toString()}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Network error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.Response === 'False') {
    const err = new Error(data.Error ?? 'Title not found.');
    err.isApiError = true;
    throw err;
  }

  return data;
}


/* ═══════════════════════════════════════════════════════════
   RENDER
═══════════════════════════════════════════════════════════ */

/**
 * Returns an HTML badge string for a content type.
 * @param {string} type - 'movie' | 'series' | 'episode' | other
 * @returns {string} HTML string
 */
function renderTypeBadge(type) {
  const normalized = (type ?? '').toLowerCase();
  const labelMap = { movie: 'Movie', series: 'Series', episode: 'Episode', game: 'Game' };
  const label = labelMap[normalized] ?? type;
  return `<span class="card-type-badge">${label}</span>`;
}

/**
 * Returns an HTML badge string (for use inside modal header).
 * @param {string} type
 * @returns {string}
 */
function renderModalBadge(type) {
  const normalized = (type ?? '').toLowerCase();
  const labelMap = { movie: 'Movie', series: 'Series', episode: 'Episode', game: 'Game' };
  const label = labelMap[normalized] ?? type;
  return `<span class="modal-badge">${label}</span>`;
}

/**
 * Builds a movie card DOM element.
 * @param {{imdbID: string, Title: string, Year: string, Type: string, Poster: string}} movie
 * @returns {HTMLElement}
 */
function buildMovieCard(movie) {
  const card = document.createElement('article');
  card.className = 'movie-card';
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${movie.Title} (${movie.Year})`);
  card.dataset.imdbId = movie.imdbID;

  const hasPoster = movie.Poster && movie.Poster !== NO_POSTER_VALUE;

  const posterHTML = hasPoster
    ? `<img
         class="card-poster"
         src="${escapeAttr(movie.Poster)}"
         alt="Poster for ${escapeAttr(movie.Title)}"
         loading="lazy"
         decoding="async"
       />`
    : `<div class="card-poster-placeholder">
         <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
           <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
           <line x1="7" y1="2" x2="7" y2="22"></line>
           <line x1="17" y1="2" x2="17" y2="22"></line>
           <line x1="2" y1="12" x2="22" y2="12"></line>
           <line x1="2" y1="7" x2="7" y2="7"></line>
           <line x1="2" y1="17" x2="7" y2="17"></line>
           <line x1="17" y1="7" x2="22" y2="7"></line>
           <line x1="17" y1="17" x2="22" y2="17"></line>
         </svg>
         <span class="placeholder-text">No poster</span>
       </div>`;

  card.innerHTML = `
    <div class="card-poster-wrapper">
      ${posterHTML}
      ${renderTypeBadge(movie.Type)}
    </div>
    <div class="card-body">
      <h2 class="card-title">${escapeHtml(movie.Title)}</h2>
      <span class="card-year">${escapeHtml(movie.Year)}</span>
    </div>
  `;

  return card;
}

/**
 * Renders movie cards into the results grid.
 * @param {Array} movies - Array of OMDB search result objects
 */
function renderResults(movies) {
  const grid = document.getElementById('resultsGrid');
  grid.innerHTML = '';

  if (!movies || movies.length === 0) return;

  const fragment = document.createDocumentFragment();
  movies.forEach(movie => {
    fragment.appendChild(buildMovieCard(movie));
  });
  grid.appendChild(fragment);
}

/**
 * Builds the HTML string for the modal detail view.
 * @param {Object} detail - Full OMDB detail object
 * @returns {string} HTML string
 */
function buildModalHTML(detail) {
  const hasPoster = detail.Poster && detail.Poster !== NO_POSTER_VALUE;

  const posterHTML = hasPoster
    ? `<img
         class="modal-poster"
         src="${escapeAttr(detail.Poster)}"
         alt="Poster for ${escapeAttr(detail.Title)}"
       />`
    : `<div class="modal-poster-placeholder">
         <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
           <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
           <line x1="7" y1="2" x2="7" y2="22"></line>
           <line x1="17" y1="2" x2="17" y2="22"></line>
           <line x1="2" y1="12" x2="22" y2="12"></line>
           <line x1="2" y1="7" x2="7" y2="7"></line>
           <line x1="2" y1="17" x2="7" y2="17"></line>
           <line x1="17" y1="7" x2="22" y2="7"></line>
           <line x1="17" y1="17" x2="22" y2="17"></line>
         </svg>
         <span>No poster available</span>
       </div>`;

  // Ratings strip
  const imdbRating   = detail.imdbRating   || NO_POSTER_VALUE;
  const metascore    = detail.Metascore     || NO_POSTER_VALUE;
  const rtRating     = (detail.Ratings ?? []).find(r => r.Source === 'Rotten Tomatoes')?.Value ?? NO_POSTER_VALUE;

  /** @param {string} val @param {string} label @param {string} cls */
  const ratingBadge = (val, label, cls) => {
    if (val === NO_POSTER_VALUE) {
      return `<div class="rating-item">
        <span class="rating-label">${label}</span>
        <span class="rating-badge rating-badge-na">--</span>
      </div>`;
    }
    return `<div class="rating-item">
      <span class="rating-label">${label}</span>
      <span class="rating-badge ${cls}">${escapeHtml(val)}</span>
    </div>`;
  };

  const ratingsHTML = `
    <div class="ratings-strip">
      ${ratingBadge(imdbRating, 'IMDb', 'rating-badge-imdb')}
      ${ratingBadge(rtRating, 'RT', 'rating-badge-rt')}
      ${ratingBadge(metascore, 'Meta', 'rating-badge-meta')}
    </div>
  `;

  // Genre tags
  const genres = (detail.Genre && detail.Genre !== NO_POSTER_VALUE)
    ? detail.Genre.split(', ').map(g =>
        `<span class="genre-tag">${escapeHtml(g.trim())}</span>`
      ).join('')
    : '';

  // Build detail rows — only include rows with actual data
  const rows = [
    { label: 'Director',  value: detail.Director  },
    { label: 'Writer',    value: detail.Writer     },
    { label: 'Cast',      value: detail.Actors     },
    { label: 'Language',  value: detail.Language   },
    { label: 'Country',   value: detail.Country    },
    { label: 'Awards',    value: detail.Awards     },
    { label: 'Box Office',value: detail.BoxOffice  },
    { label: 'Released',  value: detail.Released   },
  ];

  const detailRowsHTML = rows
    .filter(r => r.value && r.value !== NO_POSTER_VALUE)
    .map(r => `
      <div class="detail-row">
        <span class="detail-label">${r.label}</span>
        <span class="detail-value">${escapeHtml(r.value)}</span>
      </div>
    `).join('');

  const plotHTML = (detail.Plot && detail.Plot !== NO_POSTER_VALUE)
    ? `<p class="modal-plot">${escapeHtml(detail.Plot)}</p>`
    : '';

  const year    = detail.Year    || '';
  const runtime = detail.Runtime || '';
  const rated   = detail.Rated   || '';

  const metaItems = [year, runtime, rated]
    .filter(v => v && v !== NO_POSTER_VALUE)
    .map((v, i, arr) => {
      const escaped = `<span>${escapeHtml(v)}</span>`;
      return i < arr.length - 1 ? escaped + `<span class="modal-divider">&middot;</span>` : escaped;
    }).join('');

  return `
    <div class="modal-layout">
      <div class="modal-poster-wrapper">
        ${posterHTML}
      </div>
      <div class="modal-details">
        <h2 class="modal-title" id="modalTitle">${escapeHtml(detail.Title)}</h2>

        <div class="modal-meta-row">
          ${renderModalBadge(detail.Type)}
          ${metaItems}
        </div>

        ${ratingsHTML}

        <div class="genre-tags">
          ${genres}
        </div>

        ${plotHTML}

        <div class="detail-list">
          ${detailRowsHTML}
        </div>
      </div>
    </div>
  `;
}


/* ═══════════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════════ */

/**
 * Shows or hides the loading overlay.
 * @param {boolean} visible
 */
function setLoadingVisible(visible) {
  document.getElementById('loadingOverlay').hidden = !visible;
}

/**
 * Displays an error message box.
 * @param {string} title
 * @param {string} body
 */
function showError(title, body) {
  const box = document.getElementById('errorBox');
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorBody').textContent  = body;
  box.hidden = false;
}

/** Hides the error box. */
function hideError() {
  document.getElementById('errorBox').hidden = true;
}

/** Shows the "no results" empty state. */
function showEmptyState(query) {
  const box = document.getElementById('emptyBox');
  document.getElementById('emptyBody').textContent =
    `No results for "${query}". Try a different title or adjust your filters.`;
  box.hidden = false;
}

/** Hides the empty state box. */
function hideEmptyState() {
  document.getElementById('emptyBox').hidden = true;
}

/** Hides the welcome/initial state. */
function hideWelcomeState() {
  document.getElementById('welcomeState').hidden = true;
}

/** Shows the welcome/initial state. */
function showWelcomeState() {
  document.getElementById('welcomeState').hidden = false;
}

/**
 * Updates the status bar text.
 * @param {number} total   - Total results from API
 * @param {string} query   - Search query
 * @param {number} page    - Current page
 * @param {number} totalPages - Total pages
 */
function updateStatusBar(total, query, page, totalPages) {
  const bar  = document.getElementById('statusBar');
  const text = document.getElementById('statusText');

  if (total === 0) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  text.innerHTML =
    `<strong>${total.toLocaleString()}</strong> result${total !== 1 ? 's' : ''} for
     "<strong>${escapeHtml(query)}</strong>"
     — page <strong>${page}</strong> of <strong>${totalPages}</strong>`;
}

/** Shows a small helper message when filters are used without query. */
function showFilterQueryHint() {
  const bar = document.getElementById('statusBar');
  const text = document.getElementById('statusText');
  bar.hidden = false;
  text.textContent = 'To use filters, enter a movie or series title first.';
}

/**
 * Clears all result-related UI regions.
 */
function clearResultsUI() {
  document.getElementById('resultsGrid').innerHTML = '';
  document.getElementById('pagination').hidden = true;
  document.getElementById('pagination').innerHTML = '';
  document.getElementById('statusBar').hidden = true;
  hideError();
  hideEmptyState();
}


/* ═══════════════════════════════════════════════════════════
   PAGINATION
═══════════════════════════════════════════════════════════ */

/**
 * Calculates the total number of pages.
 * @param {number} total - Total result count
 * @returns {number}
 */
function calcTotalPages(total) {
  return Math.ceil(total / RESULTS_PER_PAGE);
}

/**
 * Generates the list of page numbers / ellipsis tokens to render.
 * E.g. for page 5 of 12: [1, '…', 3, 4, 5, 6, 7, '…', 12]
 *
 * @param {number} current    - Current page
 * @param {number} total      - Total pages
 * @returns {Array<number|string>}
 */
function buildPageRange(current, total) {
  if (total <= MAX_PAGE_BUTTONS + 2) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const half  = Math.floor(MAX_PAGE_BUTTONS / 2);
  let start   = Math.max(2, current - half);
  let end     = Math.min(total - 1, current + half);

  // Shift window if too close to edges
  if (current - half < 2)          end   = Math.min(total - 1, MAX_PAGE_BUTTONS);
  if (current + half > total - 1)  start = Math.max(2, total - MAX_PAGE_BUTTONS);

  const pages = [1];
  if (start > 2)       pages.push('…');
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push('…');
  pages.push(total);

  return pages;
}

/**
 * Renders pagination controls.
 * @param {number} currentPage
 * @param {number} totalResults
 */
function renderPagination(currentPage, totalResults) {
  const nav        = document.getElementById('pagination');
  const totalPages = calcTotalPages(totalResults);

  if (totalPages <= 1) {
    nav.hidden = true;
    return;
  }

  nav.hidden = false;
  nav.innerHTML = '';

  const prevBtn = createPageButton('prev', currentPage === 1);
  prevBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
    <span>Prev</span>
  `;
  prevBtn.addEventListener('click', () => goToPage(currentPage - 1));
  nav.appendChild(prevBtn);

  const range = buildPageRange(currentPage, totalPages);
  range.forEach(item => {
    if (item === '…') {
      const ellipsis = document.createElement('span');
      ellipsis.className = 'page-ellipsis';
      ellipsis.textContent = '…';
      nav.appendChild(ellipsis);
    } else {
      const btn = createPageButton(String(item), false);
      btn.textContent = String(item);
      if (item === currentPage) btn.classList.add('active');
      btn.addEventListener('click', () => goToPage(item));
      nav.appendChild(btn);
    }
  });

  const nextBtn = createPageButton('next', currentPage === totalPages);
  nextBtn.innerHTML = `
    <span>Next</span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  `;
  nextBtn.addEventListener('click', () => goToPage(currentPage + 1));
  nav.appendChild(nextBtn);
}

/**
 * Creates a pagination button element.
 * @param {string}  label    - Accessible label / value
 * @param {boolean} disabled
 * @returns {HTMLButtonElement}
 */
function createPageButton(label, disabled) {
  const btn = document.createElement('button');
  btn.className = 'page-btn';
  btn.setAttribute('aria-label', `Page ${label}`);
  if (disabled) btn.disabled = true;
  return btn;
}

/**
 * Navigates to a specific results page.
 * @param {number} page
 */
async function goToPage(page) {
  if (page === state.page) return;
  await performSearch(state.query, state.type, state.year, page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ═══════════════════════════════════════════════════════════
   MODAL
═══════════════════════════════════════════════════════════ */

/** Opens the detail modal and fetches data for the given IMDB ID. */
async function openModal(imdbId) {
  const backdrop = document.getElementById('modalBackdrop');
  const content  = document.getElementById('modalContent');
  const loading  = document.getElementById('modalLoading');

  content.hidden = true;
  loading.hidden = false;
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';

  // Trap focus
  document.getElementById('modalClose').focus();

  try {
    const detail = await fetchTitleDetail(imdbId);
    content.innerHTML = buildModalHTML(detail);
    content.hidden = false;
    loading.hidden = true;
  } catch (err) {
    loading.hidden = true;
    content.innerHTML = `
      <div class="message-box message-error" style="margin:32px">
        <svg class="message-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
        <div>
          <p class="message-title">Could not load details</p>
          <p class="message-body">${escapeHtml(err.message)}</p>
        </div>
      </div>`;
    content.hidden = false;
  }
}

/** Closes the detail modal. */
function closeModal() {
  const backdrop = document.getElementById('modalBackdrop');
  backdrop.hidden = true;
  document.body.style.overflow = '';
}


/* ═══════════════════════════════════════════════════════════
   SEARCH
═══════════════════════════════════════════════════════════ */

/** Debounce timer handle */
let debounceTimer = null;

/**
 * Debounced entry point — prevents rapid-fire API calls.
 * Delegates to performSearch after DEBOUNCE_DELAY ms.
 *
 * @param {string} query
 * @param {string} type
 * @param {string} year
 * @param {number} [page=1]
 */
function debouncedSearch(query, type, year, page = 1) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    performSearch(query, type, year, page);
  }, DEBOUNCE_DELAY);
}

/**
 * Orchestrates a complete search:
 *   1. Validates input
 *   2. Checks cache
 *   3. Fetches from API if needed
 *   4. Updates state + storage
 *   5. Renders results, pagination, status bar
 *
 * @param {string} query
 * @param {string} type
 * @param {string} year
 * @param {number} [page=1]
 */
async function performSearch(query, type, year, page = 1) {
  const trimmed = query.trim();

  if (!trimmed) {
    showError('Empty search', 'Please enter a movie or series title to search.');
    return;
  }

  if (state.isLoading) return;
  setState({ isLoading: true });

  clearResultsUI();
  hideWelcomeState();
  setLoadingVisible(true);

  const cacheKey = buildCacheKey(trimmed, type, year, page);
  const cached   = getCached(cacheKey);

  try {
    let totalResults, results;

    if (cached) {
      ({ totalResults, results } = cached);
    } else {
      const data = await fetchSearchResults(trimmed, type, year, page);
      totalResults = parseInt(data.totalResults, 10);
      results      = data.Search;
      setCached(cacheKey, { totalResults, results });
    }

    setState({ query: trimmed, type, year, page, totalResults, results }, true);

    const totalPages = calcTotalPages(totalResults);
    renderResults(results);
    renderPagination(page, totalResults);
    updateStatusBar(totalResults, trimmed, page, totalPages);

  } catch (err) {
    if (err.isApiError) {
      // OMDB returned Response: False (no results)
      showEmptyState(trimmed);
      setState({ query: trimmed, type, year, page, totalResults: 0, results: [] }, true);
    } else {
      showError('Network error', `Failed to connect to the OMDB API. Please check your internet connection and try again. (${err.message})`);
    }
  } finally {
    setLoadingVisible(false);
    setState({ isLoading: false });
  }
}


/* ═══════════════════════════════════════════════════════════
   FORM HELPERS
═══════════════════════════════════════════════════════════ */

/**
 * Reads the current values from the search form UI.
 * @returns {{ query: string, type: string, year: string }}
 */
function readFormValues() {
  const query = document.getElementById('searchInput').value;
  const type  = document.querySelector('.type-btn.active')?.dataset.value ?? '';
  const year  = document.getElementById('yearInput').value.trim();
  return { query, type, year };
}

/**
 * Syncs the search form UI to reflect the given state values.
 * @param {string} query
 * @param {string} type
 * @param {string} year
 */
function syncFormToState(query, type, year) {
  document.getElementById('searchInput').value = query;
  document.getElementById('yearInput').value   = year;

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === type);
  });

  updateClearFiltersVisibility(type, year);
}

/**
 * Shows/hides the "Clear filters" button based on whether any filter is active.
 * @param {string} type
 * @param {string} year
 */
function updateClearFiltersVisibility(type, year) {
  const btn = document.getElementById('clearFiltersBtn');
  btn.hidden = !type && !year;
}

/**
 * Populates the year dropdown from current year down to 1888.
 */
function populateYearOptions() {
  const yearSelect = document.getElementById('yearInput');
  const selectedYear = yearSelect.value;
  const currentYear = new Date().getFullYear();

  yearSelect.innerHTML = '<option value="">Year</option>';

  for (let year = currentYear; year >= 1888; year--) {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.appendChild(option);
  }

  if (selectedYear) yearSelect.value = selectedYear;
}

/**
 * Runs a search immediately when a filter changes, if query exists.
 */
function triggerSearchFromFilters() {
  const { query, type, year } = readFormValues();
  updateClearFiltersVisibility(type, year);
  if (!query.trim()) {
    showFilterQueryHint();
    return;
  }
  performSearch(query, type, year, 1);
}


/* ═══════════════════════════════════════════════════════════
   ESCAPE UTILITIES
═══════════════════════════════════════════════════════════ */

/**
 * Escapes a string for safe insertion as HTML text content.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escapes a string for safe use in an HTML attribute value.
 * @param {string} str
 * @returns {string}
 */
function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


/* ═══════════════════════════════════════════════════════════
   EVENTS
═══════════════════════════════════════════════════════════ */

/** Binds all event listeners. */
function bindEvents() {
  /* ── Search form submit ── */
  document.getElementById('searchForm').addEventListener('submit', e => {
    e.preventDefault();
    const { query, type, year } = readFormValues();
    debouncedSearch(query, type, year, 1);
  });

  /* ── Query input clears helper hint once user starts typing ── */
  document.getElementById('searchInput').addEventListener('input', e => {
    if (e.target.value.trim()) document.getElementById('statusBar').hidden = true;
  });

  /* ── Type filter buttons ── */
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      triggerSearchFromFilters();
    });
  });

  /* ── Year select: instant filter ── */
  document.getElementById('yearInput').addEventListener('change', () => {
    triggerSearchFromFilters();
  });

  /* ── Clear filters button ── */
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === '');
    });
    document.getElementById('yearInput').value = '';
    document.getElementById('clearFiltersBtn').hidden = true;

    const query = document.getElementById('searchInput').value.trim();
    if (query) performSearch(query, '', '', 1);
  });

  /* ── Card clicks (event delegation) ── */
  document.getElementById('resultsGrid').addEventListener('click', e => {
    const card = e.target.closest('.movie-card');
    if (card) openModal(card.dataset.imdbId);
  });

  /* ── Card keyboard navigation ── */
  document.getElementById('resultsGrid').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const card = e.target.closest('.movie-card');
      if (card) {
        e.preventDefault();
        openModal(card.dataset.imdbId);
      }
    }
  });

  /* ── Modal close button ── */
  document.getElementById('modalClose').addEventListener('click', closeModal);

  /* ── Modal backdrop click (outside modal box) ── */
  document.getElementById('modalBackdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('modalBackdrop')) closeModal();
  });

  /* ── ESC key closes modal ── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('modalBackdrop').hidden) {
      closeModal();
    }
  });

  /* ── Logo resets to welcome state ── */
  document.getElementById('logoLink').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('searchInput').value = '';
    document.getElementById('yearInput').value   = '';
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.value === '');
    });
    document.getElementById('clearFiltersBtn').hidden = true;
    clearResultsUI();
    showWelcomeState();
    localStorage.removeItem(STORAGE_KEY);
  });
}


/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */

/**
 * Bootstraps the application:
 *   1. Binds all DOM events
 *   2. Attempts to restore the last search from localStorage
 */
function init() {
  populateYearOptions();
  bindEvents();

  const saved = loadStateFromStorage();

  if (saved && saved.query) {
    // Restore UI controls
    syncFormToState(saved.query, saved.type, saved.year);

    // Restore results from saved data (bypasses network on load)
    const { query, type, year, page, totalResults, results } = saved;

    if (results && results.length > 0) {
      setState({ query, type, year, page, totalResults, results });

      hideWelcomeState();
      renderResults(results);
      renderPagination(page, totalResults);
      updateStatusBar(totalResults, query, page, calcTotalPages(totalResults));

      // Also pre-warm the cache so next navigation hits are instant
      const key = buildCacheKey(query, type, year, page);
      setCached(key, { totalResults, results });
    }
  }
}

// Run after DOM is ready
document.addEventListener('DOMContentLoaded', init);
