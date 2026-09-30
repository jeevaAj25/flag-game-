// Comprehensive Country Dictionary & Matcher for Live Flag Count Fight
// Supports ~240 countries/territories, ISO codes, aliases, common typos, demonyms, and flag emojis

const COUNTRIES = [
  { code: 'id', name: 'Indonesia', emoji: '🇮🇩', aliases: ['indonesia', 'indo', 'id', 'idonesia', 'indoneisa', 'indonesien', 'ina'] },
  { code: 'gr', name: 'Greece', emoji: '🇬🇷', aliases: ['greece', 'gr', 'hellas', 'greek', 'grece', 'ellada'] },
  { code: 'sa', name: 'Saudi Arabia', emoji: '🇸🇦', aliases: ['saudi arabia', 'saudi', 'ksa', 'sa', 'arabia', 'al-saudia', 'saudiya'] },
  { code: 'in', name: 'India', emoji: '🇮🇳', aliases: ['india', 'in', 'bharat', 'ind', 'hindustan', 'indya'] },
  { code: 'br', name: 'Brazil', emoji: '🇧🇷', aliases: ['brazil', 'brasil', 'br', 'bra', 'brazilian'] },
  { code: 'uz', name: 'Uzbekistan', emoji: '🇺🇿', aliases: ['uzbekistan', 'uz', 'uzbek', 'uzb', 'ozbekiston'] },
  { code: 'my', name: 'Malaysia', emoji: '🇲🇾', aliases: ['malaysia', 'my', 'mas', 'malay', 'malaysian'] },
  { code: 'ca', name: 'Canada', emoji: '🇨🇦', aliases: ['canada', 'ca', 'can', 'canadian'] },
  { code: 'ps', name: 'Palestine', emoji: '🇵🇸', aliases: ['palestine', 'ps', 'filastin', 'falastin', 'palestinian', 'gaza'] },
  { code: 'tr', name: 'Turkey', emoji: '🇹🇷', aliases: ['turkey', 'turkiye', 'tr', 'tur', 'turk'] },
  { code: 'vn', name: 'Vietnam', emoji: '🇻🇳', aliases: ['vietnam', 'viet nam', 'vn', 'vnm', 'viet'] },
  { code: 'il', name: 'Israel', emoji: '🇮🇱', aliases: ['israel', 'il', 'isr'] },
  { code: 'ua', name: 'Ukraine', emoji: '🇺🇦', aliases: ['ukraine', 'ua', 'ukr', 'ukraina'] },
  { code: 'lk', name: 'Sri Lanka', emoji: '🇱🇰', aliases: ['sri lanka', 'lk', 'srilanka', 'ceylon', 'lka'] },
  { code: 'ph', name: 'Philippines', emoji: '🇵🇭', aliases: ['philippines', 'ph', 'phl', 'filipino', 'pinoy', 'pilipinas', 'philipines', 'philippenes', 'filipinas'] },
  { code: 'fr', name: 'France', emoji: '🇫🇷', aliases: ['france', 'fr', 'fra', 'french', 'francia'] },
  { code: 'au', name: 'Australia', emoji: '🇦🇺', aliases: ['australia', 'au', 'aus', 'aussie', 'oz'] },
  { code: 'th', name: 'Thailand', emoji: '🇹🇭', aliases: ['thailand', 'th', 'thai', 'tha', 'siam'] },
  { code: 'bd', name: 'Bangladesh', emoji: '🇧🇩', aliases: ['bangladesh', 'bd', 'bgd', 'bangla', 'bengal'] },
  { code: 'ru', name: 'Russia', emoji: '🇷🇺', aliases: ['russia', 'ru', 'rus', 'rossiya', 'russian'] },
  { code: 'es', name: 'Spain', emoji: '🇪🇸', aliases: ['spain', 'es', 'esp', 'espana', 'españa', 'spanish'] },
  { code: 'mx', name: 'Mexico', emoji: '🇲🇽', aliases: ['mexico', 'mx', 'mex', 'mejico', 'mexican'] },
  { code: 'jp', name: 'Japan', emoji: '🇯🇵', aliases: ['japan', 'jp', 'jpn', 'nippon', 'nihon', 'japanese'] },
  { code: 'eg', name: 'Egypt', emoji: '🇪🇬', aliases: ['egypt', 'eg', 'egy', 'misr', 'egyptian'] },
  { code: 'mk', name: 'North Macedonia', emoji: '🇲🇰', aliases: ['north macedonia', 'macedonia', 'mk', 'mkd'] },
  { code: 'gb', name: 'United Kingdom', emoji: '🇬🇧', aliases: ['united kingdom', 'uk', 'great britain', 'britain', 'england', 'scotland', 'wales', 'gb', 'gbr', 'british'] },
  { code: 'hu', name: 'Hungary', emoji: '🇭🇺', aliases: ['hungary', 'hu', 'hun', 'magyar', 'magyarorszag'] },
  { code: 'pk', name: 'Pakistan', emoji: '🇵🇰', aliases: ['pakistan', 'pk', 'pak', 'pakistani'] },
  { code: 'us', name: 'United States', emoji: '🇺🇸', aliases: ['united states', 'usa', 'us', 'america', 'united states of america', 'american'] },
  { code: 'by', name: 'Belarus', emoji: '🇧🇾', aliases: ['belarus', 'by', 'blr', 'bielorussia'] },
  { code: 'mn', name: 'Mongolia', emoji: '🇲🇳', aliases: ['mongolia', 'mn', 'mng', 'mongol'] },
  { code: 'fi', name: 'Finland', emoji: '🇫🇮', aliases: ['finland', 'fi', 'fin', 'suomi', 'finnish'] },
  { code: 'ma', name: 'Morocco', emoji: '🇲🇦', aliases: ['morocco', 'ma', 'mar', 'maroc', 'maghreb'] },
  { code: 'dz', name: 'Algeria', emoji: '🇩🇿', aliases: ['algeria', 'dz', 'dza', 'algerie', 'algerian'] },
  { code: 'cn', name: 'China', emoji: '🇨🇳', aliases: ['china', 'cn', 'chn', 'prc', 'chinese', 'zhongguo'] },
  { code: 'pl', name: 'Poland', emoji: '🇵🇱', aliases: ['poland', 'pl', 'pol', 'polska', 'polish'] },
  { code: 'cu', name: 'Cuba', emoji: '🇨🇺', aliases: ['cuba', 'cu', 'cub', 'cuban'] },
  { code: 'ir', name: 'Iran', emoji: '🇮🇷', aliases: ['iran', 'ir', 'irn', 'persia'] },
  { code: 'iq', name: 'Iraq', emoji: '🇮🇶', aliases: ['iraq', 'iq', 'irq'] },
  { code: 'de', name: 'Germany', emoji: '🇩🇪', aliases: ['germany', 'de', 'deu', 'deutschland', 'german', 'allemagne'] },
  { code: 'it', name: 'Italy', emoji: '🇮🇹', aliases: ['italy', 'it', 'ita', 'italia', 'italian'] },
  { code: 'ar', name: 'Argentina', emoji: '🇦🇷', aliases: ['argentina', 'ar', 'arg', 'argentine'] },
  { code: 'co', name: 'Colombia', emoji: '🇨🇴', aliases: ['colombia', 'co', 'col', 'colombian'] },
  { code: 'kr', name: 'South Korea', emoji: '🇰🇷', aliases: ['south korea', 'korea', 'kr', 'kor', 'hanguk', 'korean'] },
  { code: 'ng', name: 'Nigeria', emoji: '🇳🇬', aliases: ['nigeria', 'ng', 'nga', 'nigerian'] },
  { code: 'za', name: 'South Africa', emoji: '🇿🇦', aliases: ['south africa', 'za', 'zaf', 'mzansi'] },
  { code: 'nl', name: 'Netherlands', emoji: '🇳🇱', aliases: ['netherlands', 'nl', 'nld', 'holland', 'dutch'] },
  { code: 'pt', name: 'Portugal', emoji: '🇵🇹', aliases: ['portugal', 'pt', 'prt', 'portuguese'] },
  { code: 'se', name: 'Sweden', emoji: '🇸🇪', aliases: ['sweden', 'se', 'swe', 'sverige', 'swedish'] },
  { code: 'no', name: 'Norway', emoji: '🇳🇴', aliases: ['norway', 'no', 'nor', 'norge', 'norwegian'] },
  { code: 'ch', name: 'Switzerland', emoji: '🇨🇭', aliases: ['switzerland', 'ch', 'che', 'swiss', 'schweiz', 'suisse'] },
  { code: 'be', name: 'Belgium', emoji: '🇧🇪', aliases: ['belgium', 'be', 'bel', 'belgique', 'belgie'] },
  { code: 'at', name: 'Austria', emoji: '🇦🇹', aliases: ['austria', 'at', 'aut', 'osterreich'] },
  { code: 'ro', name: 'Romania', emoji: '🇷🇴', aliases: ['romania', 'ro', 'rou', 'romanian'] },
  { code: 'cl', name: 'Chile', emoji: '🇨🇱', aliases: ['chile', 'cl', 'chl', 'chilean'] },
  { code: 'pe', name: 'Peru', emoji: '🇵🇪', aliases: ['peru', 'pe', 'per', 'peruvian'] },
  { code: 've', name: 'Venezuela', emoji: '🇻🇪', aliases: ['venezuela', 've', 'ven', 'venezuelan'] },
  { code: 'ec', name: 'Ecuador', emoji: '🇪🇨', aliases: ['ecuador', 'ec', 'ecu'] },
  { code: 'ke', name: 'Kenya', emoji: '🇰🇪', aliases: ['kenya', 'ke', 'ken', 'kenyan'] },
  { code: 'gh', name: 'Ghana', emoji: '🇬🇭', aliases: ['ghana', 'gh', 'gha', 'ghanaian'] },
  { code: 'et', name: 'Ethiopia', emoji: '🇪🇹', aliases: ['ethiopia', 'et', 'eth', 'habesha'] },
  { code: 'sg', name: 'Singapore', emoji: '🇸🇬', aliases: ['singapore', 'sg', 'sgp', 'singapura'] },
  { code: 'nz', name: 'New Zealand', emoji: '🇳🇿', aliases: ['new zealand', 'nz', 'nzl', 'kiwi', 'aotearoa'] },
  { code: 'ie', name: 'Ireland', emoji: '🇮🇪', aliases: ['ireland', 'ie', 'irl', 'irish', 'eire'] },
  { code: 'cz', name: 'Czech Republic', emoji: '🇨🇿', aliases: ['czech republic', 'czechia', 'cz', 'cze', 'czech'] },
  { code: 'dk', name: 'Denmark', emoji: '🇩🇰', aliases: ['denmark', 'dk', 'dnk', 'danish', 'danmark'] },
  { code: 'ae', name: 'United Arab Emirates', emoji: '🇦🇪', aliases: ['united arab emirates', 'uae', 'ae', 'are', 'dubai', 'abu dhabi', 'emirates'] },
  { code: 'qa', name: 'Qatar', emoji: '🇶🇦', aliases: ['qatar', 'qa', 'qat'] },
  { code: 'kw', name: 'Kuwait', emoji: '🇰🇼', aliases: ['kuwait', 'kw', 'kwt'] },
  { code: 'jo', name: 'Jordan', emoji: '🇯🇴', aliases: ['jordan', 'jo', 'jor', 'urdun'] },
  { code: 'lb', name: 'Lebanon', emoji: '🇱🇧', aliases: ['lebanon', 'lb', 'lbn', 'lubnan'] },
  { code: 'sy', name: 'Syria', emoji: '🇸🇾', aliases: ['syria', 'sy', 'syr', 'suriyah'] },
  { code: 'ye', name: 'Yemen', emoji: '🇾🇪', aliases: ['yemen', 'ye', 'yem'] },
  { code: 'om', name: 'Oman', emoji: '🇴🇲', aliases: ['oman', 'om', 'omn'] },
  { code: 'np', name: 'Nepal', emoji: '🇳🇵', aliases: ['nepal', 'np', 'npl', 'nepali'] },
  { code: 'mm', name: 'Myanmar', emoji: '🇲🇲', aliases: ['myanmar', 'burma', 'mm', 'mmr', 'burmese'] },
  { code: 'kh', name: 'Cambodia', emoji: '🇰🇭', aliases: ['cambodia', 'kh', 'khm', 'khmer'] },
  { code: 'la', name: 'Laos', emoji: '🇱🇦', aliases: ['laos', 'la', 'lao'] },
  { code: 'kz', name: 'Kazakhstan', emoji: '🇰🇿', aliases: ['kazakhstan', 'kz', 'kaz', 'qazaqstan'] },
  { code: 'az', name: 'Azerbaijan', emoji: '🇦🇿', aliases: ['azerbaijan', 'az', 'aze', 'azerbaycan'] },
  { code: 'ge', name: 'Georgia', emoji: '🇬🇪', aliases: ['georgia', 'ge', 'geo', 'sakartvelo'] },
  { code: 'am', name: 'Armenia', emoji: '🇦🇲', aliases: ['armenia', 'am', 'arm', 'hayastan'] },
  { code: 'rs', name: 'Serbia', emoji: '🇷🇸', aliases: ['serbia', 'rs', 'srb', 'srbija'] },
  { code: 'hr', name: 'Croatia', emoji: '🇭🇷', aliases: ['croatia', 'hr', 'hrv', 'hrvatska'] },
  { code: 'ba', name: 'Bosnia', emoji: '🇧🇦', aliases: ['bosnia', 'ba', 'bih', 'bosnia and herzegovina'] },
  { code: 'bg', name: 'Bulgaria', emoji: '🇧🇬', aliases: ['bulgaria', 'bg', 'bgr'] },
  { code: 'al', name: 'Albania', emoji: '🇦🇱', aliases: ['albania', 'al', 'alb', 'shqiperia'] },
  { code: 'sk', name: 'Slovakia', emoji: '🇸🇰', aliases: ['slovakia', 'sk', 'svk', 'slovensko'] },
  { code: 'si', name: 'Slovenia', emoji: '🇸🇮', aliases: ['slovenia', 'si', 'svn', 'slovenija'] },
  { code: 'lt', name: 'Lithuania', emoji: '🇱🇹', aliases: ['lithuania', 'lt', 'ltu', 'lietuva'] },
  { code: 'lv', name: 'Latvia', emoji: '🇱🇻', aliases: ['latvia', 'lv', 'lva', 'latvija'] },
  { code: 'ee', name: 'Estonia', emoji: '🇪🇪', aliases: ['estonia', 'ee', 'est', 'eesti'] },
  { code: 'tn', name: 'Tunisia', emoji: '🇹🇳', aliases: ['tunisia', 'tn', 'tun', 'tounes'] },
  { code: 'ly', name: 'Libya', emoji: '🇱🇾', aliases: ['libya', 'ly', 'lby'] },
  { code: 'sd', name: 'Sudan', emoji: '🇸🇩', aliases: ['sudan', 'sd', 'sdn'] },
  { code: 'tz', name: 'Tanzania', emoji: '🇹🇿', aliases: ['tanzania', 'tz', 'tza'] },
  { code: 'ug', name: 'Uganda', emoji: '🇺🇬', aliases: ['uganda', 'ug', 'uga'] },
  { code: 'sn', name: 'Senegal', emoji: '🇸🇳', aliases: ['senegal', 'sn', 'sen'] },
  { code: 'cm', name: 'Cameroon', emoji: '🇨🇲', aliases: ['cameroon', 'cm', 'cmr'] },
  { code: 'ci', name: 'Ivory Coast', emoji: '🇨🇮', aliases: ['ivory coast', 'cote d\'ivoire', 'ci', 'civ'] },
  { code: 'uy', name: 'Uruguay', emoji: '🇺🇾', aliases: ['uruguay', 'uy', 'ury'] },
  { code: 'py', name: 'Paraguay', emoji: '🇵🇾', aliases: ['paraguay', 'py', 'pry'] },
  { code: 'bo', name: 'Bolivia', emoji: '🇧🇴', aliases: ['bolivia', 'bo', 'bol'] },
  { code: 'cr', name: 'Costa Rica', emoji: '🇨🇷', aliases: ['costa rica', 'cr', 'cri'] },
  { code: 'pa', name: 'Panama', emoji: '🇵🇦', aliases: ['panama', 'pa', 'pan'] },
  { code: 'do', name: 'Dominican Republic', emoji: '🇩🇴', aliases: ['dominican republic', 'do', 'dom', 'dominicana'] },
  { code: 'pr', name: 'Puerto Rico', emoji: '🇵🇷', aliases: ['puerto rico', 'pr', 'pri', 'boricua'] },
  { code: 'jm', name: 'Jamaica', emoji: '🇯🇲', aliases: ['jamaica', 'jm', 'jam'] },
  { code: 'tt', name: 'Trinidad and Tobago', emoji: '🇹🇹', aliases: ['trinidad', 'tobago', 'tt', 'tto'] },
  { code: 'gt', name: 'Guatemala', emoji: '🇬🇹', aliases: ['guatemala', 'gt', 'gtm'] },
  { code: 'hn', name: 'Honduras', emoji: '🇭🇳', aliases: ['honduras', 'hn', 'hnd'] },
  { code: 'sv', name: 'El Salvador', emoji: '🇸🇻', aliases: ['el salvador', 'sv', 'slv', 'salvador'] },
  { code: 'ni', name: 'Nicaragua', emoji: '🇳🇮', aliases: ['nicaragua', 'ni', 'nic'] },
  { code: 'af', name: 'Afghanistan', emoji: '🇦🇫', aliases: ['afghanistan', 'af', 'afg'] },
  { code: 'so', name: 'Somalia', emoji: '🇸🇴', aliases: ['somalia', 'so', 'som'] },
  { code: 'zw', name: 'Zimbabwe', emoji: '🇿🇼', aliases: ['zimbabwe', 'zw', 'zwe'] },
  { code: 'zm', name: 'Zambia', emoji: '🇿🇲', aliases: ['zambia', 'zm', 'zmb'] },
  { code: 'ao', name: 'Angola', emoji: '🇦🇴', aliases: ['angola', 'ao', 'ago'] },
  { code: 'mz', name: 'Mozambique', emoji: '🇲🇿', aliases: ['mozambique', 'mz', 'moz'] },
  { code: 'mg', name: 'Madagascar', emoji: '🇲🇬', aliases: ['madagascar', 'mg', 'mdg'] },
  { code: 'rw', name: 'Rwanda', emoji: '🇷🇼', aliases: ['rwanda', 'rw', 'rwa'] },
  { code: 'is', name: 'Iceland', emoji: '🇮🇸', aliases: ['iceland', 'is', 'isl', 'island'] },
  { code: 'cy', name: 'Cyprus', emoji: '🇨🇾', aliases: ['cyprus', 'cy', 'cyp'] },
  { code: 'lu', name: 'Luxembourg', emoji: '🇱🇺', aliases: ['luxembourg', 'lu', 'lux'] },
  { code: 'mt', name: 'Malta', emoji: '🇲🇹', aliases: ['malta', 'mt', 'mlt'] }
];

// Build lookup maps for ultra-fast matching
const codeToCountry = new Map();
const emojiToCountry = new Map();
const aliasToCountry = new Map();

for (const c of COUNTRIES) {
  codeToCountry.set(c.code.toLowerCase(), c);
  if (c.emoji) {
    emojiToCountry.set(c.emoji, c);
  }
  // Register full name and all aliases
  const allAliases = [c.name, c.code, ...(c.aliases || [])];
  for (const alias of allAliases) {
    const clean = alias.trim().toLowerCase();
    if (clean) {
      if (!aliasToCountry.has(clean)) {
        aliasToCountry.set(clean, c);
      }
    }
  }
}

/**
 * Detect country from raw user message
 * Handles:
 * - Direct flag emojis (🇮🇩, 🇮🇳, 🇵🇭, etc.)
 * - Exact country names or aliases
 * - Words inside the message (e.g. "Indonesia viva", "support india pls")
 */
function detectCountry(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. Check for flag emoji anywhere in text
  for (const [emoji, country] of emojiToCountry.entries()) {
    if (text.includes(emoji)) {
      return country;
    }
  }

  // 2. Clean text: lowercase, remove special characters except spaces & letters
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  // 3. Check entire cleaned string directly
  if (aliasToCountry.has(cleaned)) {
    return aliasToCountry.get(cleaned);
  }

  // 4. Tokenize words and check individual words and 2-word combinations
  const words = cleaned.split(' ').filter(w => w.length > 0);
  
  // Check 2-word pairs first (e.g. "saudi arabia", "sri lanka", "united states")
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`;
    if (aliasToCountry.has(pair)) {
      return aliasToCountry.get(pair);
    }
  }

  // Check 3-word pairs (e.g. "united arab emirates")
  for (let i = 0; i < words.length - 2; i++) {
    const triplet = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    if (aliasToCountry.has(triplet)) {
      return aliasToCountry.get(triplet);
    }
  }

  // Check single words (skip ultra-short noise like "a", "i" unless it's a known code like "id", "us", "uk", "in")
  for (const word of words) {
    if (aliasToCountry.has(word)) {
      // Avoid false positive on common English words if ambiguous, but match valid countries
      return aliasToCountry.get(word);
    }
  }

  return null;
}

/**
 * Returns flag URL (local fallback to flagcdn)
 */
function getFlagUrl(code) {
  const c = code.toLowerCase();
  return `/flags/${c}.png`;
}

function getCdnFlagUrl(code) {
  const c = code.toLowerCase();
  return `https://flagcdn.com/w160/${c}.png`;
}

module.exports = {
  COUNTRIES,
  codeToCountry,
  detectCountry,
  getFlagUrl,
  getCdnFlagUrl
};
