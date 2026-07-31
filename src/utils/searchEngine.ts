/**
 * Computes exact Levenshtein Edit Distance between two strings.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

/**
 * Common typo & spelling synonym normalization map.
 */
const SPELLING_SYNONYMS: Record<string, string[]> = {
  saloon: ["salon", "salons", "barber", "parlour", "parlor", "beauty", "haircut", "spa"],
  saloons: ["salon", "salons", "barber", "parlour", "parlor", "beauty", "haircut", "spa"],
  salon: ["salon", "salons", "barber", "parlour", "parlor", "beauty", "haircut", "spa"],
  parlor: ["parlour", "salon", "beauty"],
  parlour: ["parlor", "salon", "beauty"],
  eletrician: ["electrician", "electricians", "electrical"],
  electritian: ["electrician", "electricians", "electrical"],
  plumber: ["plumbers", "plumbing"],
  mechanic: ["garage", "repair", "car service"],
  mobiil: ["mobile", "phone", "smartphone"],
  iphne: ["iphone", "apple", "mobile"],
  ipon: ["iphone", "apple", "mobile"],
  bike: ["bikes", "motorcycle", "scooter", "two wheeler"]
};

export interface SearchableItem {
  title: string;
  category?: string | null;
  subCategory?: string | null;
  serviceType?: string | null;
  businessCategory?: string | null;
  tags?: string[] | string | null;
  description?: string | null;
  location?: string | null;
  [key: string]: any;
}

export interface ScoredResult<T> {
  item: T;
  score: number;
  matchReason: string;
  isDirectMatch: boolean;
}

export function scoreTitleMatch(q: string, titleStr: string): number {
  const query = q.toLowerCase().trim();
  const title = titleStr.toLowerCase().trim();

  if (!query || !title) return 0;
  if (title === query) return 100;
  if (title.startsWith(query)) return 90;

  const synonyms = SPELLING_SYNONYMS[query] || [];
  for (const syn of synonyms) {
    if (title === syn) return 95;
    if (title.startsWith(syn)) return 85;
    if (title.includes(syn)) return 75;
  }

  if (title.includes(query)) return 70;
  return 0;
}

/**
 * Calculates strict relevance score for an item against query string q.
 * Categorizes matches as direct title matches vs category/description matches.
 * Returns score = 0 if item is completely unrelated.
 */
export function calculateRelevanceScore(q: string, item: SearchableItem): { score: number; matchReason: string; isDirectMatch: boolean } {
  const query = q.toLowerCase().trim();
  if (!query) return { score: 100, matchReason: "default", isDirectMatch: true };

  const title = (item.title || "").toLowerCase().trim();
  const description = (item.description || "").toLowerCase().trim();
  const category = (item.category || "").toLowerCase().trim();
  const subCategory = (item.subCategory || "").toLowerCase().trim();
  const serviceType = (item.serviceType || item.businessCategory || "").toLowerCase().trim();
  const location = (item.location || "").toLowerCase().trim();

  const querySynonyms = SPELLING_SYNONYMS[query] || [];
  const searchTerms = [query, ...querySynonyms];

  const matchesAny = (field: string) => {
    if (!field) return false;
    return searchTerms.some(term => field.includes(term));
  };

  // 1. Exact Title Match (Score 100)
  if (title === query) {
    return { score: 100, matchReason: "exact_title", isDirectMatch: true };
  }

  // 2. Title Starts With query (Score 95)
  if (title.startsWith(query)) {
    return { score: 95, matchReason: "title_prefix", isDirectMatch: true };
  }

  // 3. Title Contains query or synonym (Score 90 / 85)
  if (matchesAny(title)) {
    return { score: 90, matchReason: "title_match", isDirectMatch: true };
  }

  // 4. Exact Category / Subcategory / Service Type Match (Score 80)
  if (matchesAny(category) || matchesAny(subCategory) || matchesAny(serviceType)) {
    return { score: 80, matchReason: "category_match", isDirectMatch: false };
  }

  // 5. Description Contains query or synonym (Score 65)
  if (matchesAny(description)) {
    return { score: 65, matchReason: "description_match", isDirectMatch: false };
  }

  // 6. Location Contains query (Score 55)
  if (location.includes(query)) {
    return { score: 55, matchReason: "location_match", isDirectMatch: false };
  }

  // 7. Strict Typo / Fuzzy Match in Title (Length >= 4, edit distance <= 1)
  const titleWords = title.split(/[\s,/\-_]+/).filter(w => w && w.length >= 4);
  const queryTokens = query.split(/\s+/).filter(w => w && w.length >= 4);

  for (const qTok of queryTokens) {
    for (const tWord of titleWords) {
      if (Math.abs(qTok.length - tWord.length) <= 1) {
        const dist = editDistance(qTok, tWord);
        if (dist <= 1) {
          return { score: 50, matchReason: "fuzzy_title_match", isDirectMatch: true };
        }
      }
    }
  }

  // UNRELATED ITEMS GET SCORE 0 AND ARE HIDDEN COMPLETELY
  return { score: 0, matchReason: "unrelated", isDirectMatch: false };
}

export function scoreAndFilterItems<T extends SearchableItem>(q: string, items: T[]): ScoredResult<T>[] {
  if (!q || !q.trim()) {
    return items.map(item => ({ item, score: 100, matchReason: "default", isDirectMatch: true }));
  }

  const results: ScoredResult<T>[] = [];

  for (const item of items) {
    const { score, matchReason, isDirectMatch } = calculateRelevanceScore(q, item);
    if (score > 0) {
      results.push({ item, score, matchReason, isDirectMatch });
    }
  }

  // Sort strictly by score descending so exact title matches always appear at index 0
  results.sort((a, b) => b.score - a.score);

  return results;
}
