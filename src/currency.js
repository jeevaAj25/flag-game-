// Currency Exchange Rate Service for Super Chats
// Cached hourly, with robust offline fallback table

const https = require('https');

// Fallback rates (units per 1 USD)
const FALLBACK_RATES = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.78,
  INR: 84.0,
  IDR: 16200.0,
  PHP: 58.5,
  BRL: 5.5,
  CAD: 1.37,
  AUD: 1.52,
  JPY: 153.0,
  SAR: 3.75,
  AED: 3.67,
  MYR: 4.45,
  THB: 35.8,
  VND: 25400.0,
  KRW: 1380.0,
  MXN: 18.2,
  RUB: 92.0,
  TRY: 33.5,
  EGP: 48.5,
  PKR: 278.0,
  BDT: 118.0,
  NGN: 1600.0,
  ZAR: 18.1,
  SGD: 1.34,
  NZD: 1.66
};

let cachedRates = { ...FALLBACK_RATES };
let lastFetchedTime = 0;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch latest rates from free open exchange rate API
 */
async function refreshRates() {
  const now = Date.now();
  if (now - lastFetchedTime < CACHE_DURATION_MS) {
    return cachedRates;
  }

  return new Promise((resolve) => {
    https.get('https://open.er-api.com/v6/latest/USD', { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.result === 'success' && json.rates) {
            cachedRates = { ...FALLBACK_RATES, ...json.rates };
            lastFetchedTime = now;
            console.log('[Currency] Updated live exchange rates successfully.');
          }
        } catch (e) {
          console.warn('[Currency] Failed to parse exchange rate response, using fallback table.');
        }
        resolve(cachedRates);
      });
    }).on('error', (err) => {
      console.warn('[Currency] Network error fetching exchange rates, using fallback table:', err.message);
      resolve(cachedRates);
    });
  });
}

/**
 * Convert any currency to USD
 * @param {number} amount In major currency units (e.g. 50000 IDR or 5.00 USD)
 * @param {string} currency ISO currency code (e.g. 'IDR', 'USD')
 * @returns {number} Amount in USD
 */
function convertToUsd(amount, currency = 'USD') {
  const code = (currency || 'USD').toUpperCase();
  if (code === 'USD') return amount;

  const rate = cachedRates[code] || FALLBACK_RATES[code] || 1.0;
  return amount / rate;
}

/**
 * Convert amountMicros from YouTube Super Chat into USD
 * @param {string|number} amountMicros e.g. "1000000" for 1.00 USD
 * @param {string} currency e.g. "USD"
 * @returns {number} USD amount with 2 decimal precision
 */
function superChatMicrosToUsd(amountMicros, currency = 'USD') {
  const rawUnits = Number(amountMicros) / 1000000.0;
  const usd = convertToUsd(rawUnits, currency);
  return Math.round(usd * 100) / 100;
}

// Initial fetch attempt
refreshRates().catch(() => {});

module.exports = {
  refreshRates,
  convertToUsd,
  superChatMicrosToUsd,
  FALLBACK_RATES
};
