import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { URLSearchParams } from 'url';
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
// Import the Zod-inferred type from index.ts (or a future shared types.ts)
import type { SearchRentalPropertiesParams } from "./index.js";

export interface ParsedPriceResult {
  value: number | null;
  type: "numeric" | "on_application" | "unknown";
}

// Helper function to parse price strings (e.g., "€2,500 per month", "€500 per week")
export const parsePrice = (priceString: string | undefined): ParsedPriceResult => {
  if (!priceString || typeof priceString !== 'string') return { value: null, type: "unknown" };

  const priceStrNormalized = priceString.toLowerCase();

  // Check for "Price on Application" or similar non-numeric prices
  if (priceStrNormalized.includes('price on application') || priceStrNormalized.includes('contact agent')) {
    return { value: null, type: "on_application" };
  }

  // Regex to capture amount and an optional period (month/week), including variations like "p/m", "p/w"
  const match = priceStrNormalized.match(/(?:€\s*)?([\d,]+(?:\.\d{2})?)\s*(?:(?:per\s*)?(month|week|mth|wk|pm|p\/m|pw|p\/w|perweek))?/i);

  if (match && match[1]) { // If we at least found a number that looks like an amount
    let amount = parseFloat(match[1].replace(/,/g, ''));
    if (isNaN(amount)) return { value: null, type: "unknown" };

    let periodWord = match[2] ? match[2].toLowerCase() : undefined;

    if (periodWord) { // If a period was explicitly found
      if (periodWord.startsWith('week') || periodWord.startsWith('wk') || periodWord === 'pw' || periodWord === 'p/w' || periodWord === 'perweek') {
        amount = Math.round((amount * 52) / 12); // Convert weekly to monthly
      }
      // Otherwise, assume monthly (includes 'month', 'mth', 'pm', 'p/m')
      return { value: amount, type: "numeric" };
    } else if (priceStrNormalized.includes('€')) {
      // No explicit period, but has '€', assume it's a direct (likely monthly) price
      return { value: amount, type: "numeric" };
    }
    // If no period and no euro symbol, it's ambiguous, fall through to stricter checks or return null
  }
  
  // Fallback for simple numbers that might be prices but didn't match the main regex structure
  // (e.g. "1500 per month" where "per month" wasn't captured by the optional group logic if it's too far)
  // This section needs to be careful not to misinterpret address numbers.
  const stricterMatchForStandaloneNumbers = priceStrNormalized.match(/^([\d,]+(?:\.\d{2})?)\s*(?:per\s*)?(month|week|mth|wk|pm|p\/m|pw|p\/w|perweek)$/i);
  if (stricterMatchForStandaloneNumbers && stricterMatchForStandaloneNumbers[1]) {
    let amount = parseFloat(stricterMatchForStandaloneNumbers[1].replace(/,/g, ''));
    if (isNaN(amount)) return { value: null, type: "unknown" };
    let periodWord = stricterMatchForStandaloneNumbers[2] ? stricterMatchForStandaloneNumbers[2].toLowerCase() : 'month';
     if (periodWord.startsWith('week') || periodWord.startsWith('wk') || periodWord === 'pw' || periodWord === 'p/w' || periodWord === 'perweek') {
        amount = Math.round((amount * 52) / 12);
    }
    return { value: amount, type: "numeric" };
  }


  // Final check for very simple numeric strings that might be prices if they are large enough
  // or if they were missed by above logic but are clearly prices.
  const simpleNumericOnly = priceString.replace(/[^0-9.]/g, '');
  if (simpleNumericOnly.length > 0 && simpleNumericOnly === priceString.replace(/[^0-9€\s.,]/g, '')) {
      const potentialPrice = parseFloat(simpleNumericOnly);
      if (!isNaN(potentialPrice)) {
          if (priceStrNormalized.includes('€') || priceStrNormalized.includes('per month') || priceStrNormalized.includes('per week')) {
              if (priceStrNormalized.includes('€')) return { value: potentialPrice, type: "numeric" };
          }
          if (priceStrNormalized.toLowerCase().includes("dublin") && priceStrNormalized.includes(potentialPrice.toString()) && potentialPrice < 100) {
              return { value: null, type: "unknown" };
          }
          if (potentialPrice < 100 && !priceStrNormalized.includes('€') && !priceStrNormalized.match(/(month|week|mth|wk|pm|pw|p\/m|p\/w)/i) ) {
             return { value: null, type: "unknown" }; // Small number, no indicators
          }
          if (potentialPrice >= 100) return { value: potentialPrice, type: "numeric" }; // Allow larger numbers if they are purely numeric
      }
  }

  return { value: null, type: "unknown" };
};

// Helper function to parse bed strings (e.g., "1 Bed", "2 Beds", "Studio")
// Returns an object { min: number, max: number } or null
interface ParsedBedsResult {
  min: number;
  max: number;
  isStudio?: boolean;
}
export const parseBeds = (bedString: string | undefined): ParsedBedsResult | null => {
  if (!bedString || typeof bedString !== 'string') return null;

  const bedStrNormalized = bedString.toLowerCase();

  if (bedStrNormalized.includes('studio')) {
    return { min: 1, max: 1, isStudio: true };
  }

  const rangeMatch = bedStrNormalized.match(/(\d+)\s*(?:to|-)\s*(\d+)\s*bed/i);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const minBeds = parseInt(rangeMatch[1], 10);
    const maxBeds = parseInt(rangeMatch[2], 10);
    if (!isNaN(minBeds) && !isNaN(maxBeds)) {
      return { min: Math.min(minBeds, maxBeds), max: Math.max(minBeds, maxBeds) };
    }
  }

  const singleMatch = bedStrNormalized.match(/(\d+)\s*bed/i);
  if (singleMatch && singleMatch[1]) {
    const num = parseInt(singleMatch[1], 10);
    if (!isNaN(num)) {
      return { min: num, max: num };
    }
  }
  return null;
};

export const extractLatLng = (html: string, selector: string): { lat: number; lng: number } | null => {
  const $ = cheerio.load(html);
  const link = $(selector).attr('href');

  if (link) {
    const match = link.match(/q=loc:([\d.-]+)\+([\d.-]+)/) || link.match(/viewpoint=([\d.-]+),([\d.-]+)/);
    if (match && match[1] && match[2]) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
};
// Helper function to introduce a delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const slugify = (str: string): string => {
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
};

const MAX_PAGES_TO_FETCH = 1; // Safety limit for pagination

export async function handleSearchRentalPropertiesScraping(
  { location, min_price, max_price, num_beds, property_type }: SearchRentalPropertiesParams
): Promise<{ content: TextContent[]; isError?: boolean }> {
  console.error('--- daftScraper: handleSearchRentalPropertiesScraping CALLED (with pagination) ---');
  const receivedParams = { location, min_price, max_price, num_beds, property_type };
  console.error('[daftScraper] Received parameters:', receivedParams);

  try {
    // 1. Construct Base Search URL (without page parameter initially)
    
    let urlPath = `/property-for-rent/`;
    if (location && location.trim() !== "") {
      const locationSlug = slugify(location); // Slugify only if location is a valid string
      urlPath += locationSlug;
    } else {
      urlPath += 'ireland'; // Default to all Ireland if no location specified
    }

    if (property_type) {
      const propertyTypeSlug = slugify(property_type);
      if (propertyTypeSlug === 'apartment') {
        urlPath += '/apartments';
      } else if (propertyTypeSlug === 'house') {
        urlPath += '/houses';
      } else {
        urlPath += `/${propertyTypeSlug}s`; // Assuming plural 's' for other types
      }
    }
    
    const queryParams = new URLSearchParams();
    if (min_price) queryParams.append('rentalPrice_from', min_price.toString());
    if (max_price) queryParams.append('rentalPrice_to', max_price.toString());
    // Only add bed filters if num_beds is specified by the user
    if (num_beds !== undefined) {
      queryParams.append('numBeds_from', num_beds.toString());
      queryParams.append('numBeds_to', num_beds.toString()); // Search for the exact number of beds specified
    }

    const queryString = queryParams.toString();
    const baseSearchUrl = `https://www.daft.ie${urlPath}${queryString ? '?' + queryString : ''}`;
    console.error(`[daftScraper] Constructed base search URL: ${baseSearchUrl}`);

    const propertyPromises: Promise<any[]>[] = [];
    let currentPage = 1;
    let totalPages = 1;
    const resultsPerPage = 20; // Daft.ie seems to use 20 results per page

    // Helper function for fetching and parsing a single page's HTML
    const MAX_FETCH_RETRIES = 2; // Number of retries for fetching a page
    const RETRY_DELAY_MS = 2000; // Delay between retries

    async function fetchPageHTML(pageNumber: number): Promise<string | null> {
      const pageUrlSuffix = pageNumber === 1 ? '' : `${baseSearchUrl.includes('?') ? '&' : '?'}page=${pageNumber}`;
      const fullPageUrl = pageNumber === 1 ? baseSearchUrl : `${baseSearchUrl}${pageUrlSuffix}`;
      
      for (let attempt = 1; attempt <= MAX_FETCH_RETRIES + 1; attempt++) {
        console.error(`[daftScraper] Fetching HTML for page ${pageNumber} from ${fullPageUrl} (Attempt ${attempt})`);
        try {
          const response = await axios.get(fullPageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://www.google.com/',
            },
            timeout: 10000 // 10 second timeout for the request
          });
          console.error(`[daftScraper] HTML fetched successfully for page ${pageNumber}. Status: ${response.status}`);
          return response.data;
        } catch (pageError) {
          let errorMsg = `Error fetching page ${pageNumber} from ${fullPageUrl} (Attempt ${attempt})`;
          if (axios.isAxiosError(pageError)) {
            errorMsg = `Axios error fetching page ${pageNumber} (Attempt ${attempt}): ${pageError.message}. Status: ${pageError.response?.status}. URL: ${pageError.config?.url}`;
          } else if (pageError instanceof Error) {
            errorMsg = `Generic error fetching page ${pageNumber} (Attempt ${attempt}): ${pageError.message}`;
          }
          console.error(`[daftScraper] ${errorMsg}`);
          if (attempt > MAX_FETCH_RETRIES) {
            console.error(`[daftScraper] Max retries reached for page ${pageNumber}. Giving up.`);
            return null;
          }
          console.warn(`[daftScraper] Retrying page ${pageNumber} in ${RETRY_DELAY_MS / 1000}s...`);
          await delay(RETRY_DELAY_MS);
        }
      }
      return null; // Should be unreachable if loop logic is correct
    }

    // Main pagination loop
    do {
      if (currentPage > 1) {
        console.error(`[daftScraper] Adding delay before fetching page ${currentPage}...`);
        await delay(1500); // 1.5 second delay between page fetches
      }

      const htmlData = await fetchPageHTML(currentPage);
      if (!htmlData) {
        if (currentPage === 1) { // Critical failure if first page fails
          console.error(`[daftScraper] Critical failure: Failed to fetch initial page for location: "${location}" using URL: ${baseSearchUrl}`);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                errorType: "NetworkError",
                sourceFunction: "handleSearchRentalPropertiesScraping.fetchPageHTML",
                message: `Failed to fetch initial page for location: "${location}".`,
                details: {
                  attemptedUrl: baseSearchUrl, // Log the specific URL tried
                  locationParam: location,
                  receivedParams: receivedParams
                }
              }, null, 2)
            }],
            isError: true
          };
        }
        console.error(`[daftScraper] Failed to fetch page ${currentPage}, stopping pagination.`);
        break; // Stop if a subsequent page fails
      }

      const $ = cheerio.load(htmlData);

      // On the first page, try to determine total number of pages
      if (currentPage === 1) {
        const totalResultsString = $('span.sc-4c172e97-0.ioLdWh').first().text();
        console.error(`[daftScraper] Found total results string: "${totalResultsString}"`);
        if (totalResultsString) {
          const match = totalResultsString.match(/of\s*([\d,]+)\s*total results/i); // Allow for comma in number
          if (match && match[1]) {
            const totalResultsRaw = match[1].replace(/,/g, ''); // Remove commas
            const totalResults = parseInt(totalResultsRaw, 10);
            if (!isNaN(totalResults)) {
              const calculatedPages = Math.ceil(totalResults / resultsPerPage);
              totalPages = Math.min(calculatedPages, MAX_PAGES_TO_FETCH);
              if (calculatedPages > MAX_PAGES_TO_FETCH) {
                console.warn(`[daftScraper] Calculated total pages (${calculatedPages}) exceeds MAX_PAGES_TO_FETCH (${MAX_PAGES_TO_FETCH}). Capping at ${MAX_PAGES_TO_FETCH}.`);
              }
              console.error(`[daftScraper] Extracted total results: ${totalResults}, calculated pages: ${calculatedPages}, effective total pages: ${totalPages}`);
            } else {
              console.error(`[daftScraper] Failed to parse number from totalResultsRaw: "${totalResultsRaw}". Assuming 1 page.`);
              totalPages = 1;
            }
          } else {
            console.error(`[daftScraper] Could not parse total results from string via regex: "${totalResultsString}". Assuming 1 page for safety.`);
            totalPages = 1;
          }
        } else {
          console.error('[daftScraper] Total results string element not found. Assuming 1 page.');
          totalPages = 1;
        }
      }

      const resultsList = $('ul[data-testid="results"]');
      if (resultsList.length === 0) {
        console.warn(`[daftScraper] Could not find results list (ul[data-testid="results"]) on page ${currentPage}. Stopping pagination for this search.`);
        if (currentPage === 1) {
             console.warn(`[daftScraper] No results found on the first page.`);
        }
        break;
      }
      
      const propertyItems = resultsList.find('li[data-testid^="result-"]');
      console.error(`[daftScraper] Found ${propertyItems.length} property items on page ${currentPage}.`);
      if (propertyItems.length === 0 && currentPage > 1) { // No items on a subsequent page
        console.info(`[daftScraper] No more property items found on page ${currentPage}. Assuming end of results for this search.`);
        break;
      } else if (propertyItems.length === 0 && currentPage === 1) { // No items on the very first page
        console.info(`[daftScraper] No property items found on the first page (page ${currentPage}).`);
        if (totalPages > 1) break;
      }

      propertyItems.each((index, element) => {
        const $element = $(element);
        const property: any = {};

        property.address = $element.find('div[data-tracking="srp_address"] p').first().text().trim();

        let mainLink = $element.find('a[data-testid="card-link"]').first();
        if (mainLink.length === 0) {
            mainLink = $element.find('a.sc-e4e4a161-16.dukjos').first();
        }
        const relativeUrl = mainLink.attr('href');
        if (relativeUrl) {
          property.url = `https://www.daft.ie${relativeUrl}`;
          const urlParts = relativeUrl.split('/');
          property.id = urlParts[urlParts.length - 1];
        }
        
        if (!property.id) {
            const dataTestId = $element.attr('data-testid');
            if (dataTestId) property.id = dataTestId.replace('result-', '');
        }

        if (!property.url && property.id && property.address) {
          const addressSlug = slugify(property.address);
          property.url = `https://www.daft.ie/for-rent/${addressSlug}/${property.id}`;
        }
        property.tagline = $element.find('div[data-tracking="srp_tagline"] p').first().text().trim();

        let mainPriceString = '';
        const priceSelectors = [
            'p[data-testid="price"]',
            '[class*="TitleBlock__StyledSpan"][class*="price"]',
            'p.csEcJw',
            'div[data-testid="card-price"] p'
        ];
        for (const selector of priceSelectors) {
            const priceElement = $element.find(selector).first();
            if (priceElement.length) {
                mainPriceString = priceElement.text().trim();
                if (mainPriceString) break;
            }
        }
        if (!mainPriceString) {
            const potentialPriceElement = $element.find('p[class^="sc-4c172e97-0"]').first();
            if (potentialPriceElement.length) {
                const potentialPriceText = potentialPriceElement.text().trim();
                if (potentialPriceText.includes('€') || /per (month|week)/i.test(potentialPriceText) || /POA|price on application/i.test(potentialPriceText)) {
                    mainPriceString = potentialPriceText;
                }
            }
        }
        property.priceString = mainPriceString;
        const parsedPriceResult = parsePrice(mainPriceString);
        property.parsedPrice = parsedPriceResult.value;
        property.priceType = parsedPriceResult.type;
        
        let mainBedsString = $element.find('[data-testid="beds"]').text().trim();
        let mainBathsString = $element.find('[data-testid="baths"]').text().trim();
        let mainPropertyTypeString = $element.find('[data-testid="property-type"]').text().trim();

        if (!mainBedsString) {
            $element.find('p, span, li').each((i, el) => {
                const text = $(el).text().trim();
                if (text.match(/^\d+\s*Bed/i) || text.toLowerCase().includes('studio')) {
                    mainBedsString = text;
                    return false;
                }
            });
        }
        property.bedsString = mainBedsString;
        property.parsedBeds = parseBeds(mainBedsString);
        property.bathsString = mainBathsString;
        
        if (!mainPropertyTypeString) {
             $element.find('p, span, li').each((i, el) => {
                const text = $(el).text().trim();
                const lowerText = text.toLowerCase();
                if (lowerText === 'apartment' || lowerText === 'house' || lowerText === 'studio' || lowerText === 'flat') {
                    mainPropertyTypeString = text;
                    return false;
                }
            });
        }
        property.propertyTypeString = mainPropertyTypeString;

        let ber = $element.find('div[data-testid="callout-container"] [aria-label^="BER"]').attr('aria-label');
        if (!ber) {
            ber = $element.find('div[data-tracking="srp_ber"]').attr('aria-label');
        }
        if (!ber) {
          ber = $element.find('p[data-testid="ber"]').text().trim();
        }
        if (ber) {
          property.ber = ber.replace('BER ', '');
        }
        
        const latLngElement = $element.find('div.sc-eb305aa9-35.jfAOAq');
        if (latLngElement.length > 0) {
            const latLng = extractLatLng(latLngElement.html() || '', 'a[data-testid="satelite-button"]');
            if (latLng) {
                property.latitude = latLng.lat;
                property.longitude = latLng.lng;
            }
        }

        const unitContainer = $element.children('div[data-testid="card-container"]');
        const unitElements = unitContainer.find('a[href*="/for-rent/"]');

        if (unitElements.length > 0) {
          property.units = [];
          unitElements.each((unitIndex, unitElement) => {
            const $unit = $(unitElement);
            const unitDetails: any = {};

            const unitRelativeUrl = $unit.attr('href');
            if (unitRelativeUrl) {
              unitDetails.url = `https://www.daft.ie${unitRelativeUrl}`;
              const unitUrlParts = unitRelativeUrl.split('/');
              unitDetails.id = unitUrlParts[unitUrlParts.length - 1];
            } else {
              return;
            }

            const priceElement = $unit.find('p[class*="jmFLnF"]').first();
            unitDetails.priceString = priceElement.text().trim();
            const unitParsedPriceResult = parsePrice(unitDetails.priceString);
            unitDetails.parsedPrice = unitParsedPriceResult.value;
            unitDetails.priceType = unitParsedPriceResult.type;

            let bedsString, bathsString, propertyTypeString;
            const detailsContainer = $unit.find('div[class*="eKLMRy"]');
            if (detailsContainer.length > 0) {
                const spans = detailsContainer.find('span');
                bedsString = spans.filter((i, el) => $(el).attr('data-testid') === 'mc-details-first-item').text().trim();
                bathsString = spans.filter((i, el) => $(el).attr('data-testid') === 'mc-details-second-item').text().trim();
                propertyTypeString = spans.filter((i, el) => $(el).attr('data-testid') === 'mc-details-third-item').text().trim();
            } else {
                const infoSpans = $unit.find('div[class*="kzXTWf"] span');
                if (infoSpans.length > 0) {
                  bedsString = infoSpans.eq(0).text().trim();
                  if (infoSpans.length > 1) {
                    bathsString = infoSpans.eq(1).text().trim();
                  }
                  if (infoSpans.length > 2) {
                    propertyTypeString = infoSpans.eq(2).text().trim();
                  }
                }
            }
            unitDetails.bedsString = bedsString;
            unitDetails.parsedBeds = parseBeds(bedsString);
            unitDetails.bathsString = bathsString;
            unitDetails.propertyTypeString = propertyTypeString;

            if (unitDetails.id) {
              property.units.push(unitDetails);
            }
          });

          if (property.units.length > 0) {
            const firstUnit = property.units[0];
            if (property.priceType === "unknown" || !property.parsedPrice) {
              property.parsedPrice = firstUnit.parsedPrice;
              property.priceString = firstUnit.priceString;
              property.priceType = firstUnit.priceType;
            }
            if (!property.parsedBeds) {
              property.parsedBeds = firstUnit.parsedBeds;
              property.bedsString = firstUnit.bedsString;
            }
            if (!property.propertyTypeString) {
              property.propertyTypeString = firstUnit.propertyTypeString;
            }
          }
        }
        
        propertyPromises.push(
          (async () => {
            if (!property.url) {
              return [property]; // Return as is if no URL
            }

            try {
              const { data: htmlData } = await axios.get(property.url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
                timeout: 10000
              });
              const $detail = cheerio.load(htmlData);

              // First, get the definitive lat/lng for this page
              const latLngElement = $detail('div.sc-eb305aa9-35.jfAOAq');
              if (latLngElement.length > 0) {
                const latLng = extractLatLng($detail.html(latLngElement), 'a[data-testid="satelite-button"]');
                if (latLng) {
                  property.latitude = latLng.lat;
                  property.longitude = latLng.lng;
                }
              }

              const subUnitElements = $detail('a[data-testid="sub-unit"]');

              if (subUnitElements.length > 0) {
                // This is a development page, parse its sub-units and return them instead of the parent
                const units: any[] = [];
                subUnitElements.each((index, element) => {
                  const $unit = $(element);
                  // Each sub-unit inherits address and the parent's location
                  const unitDetails: any = { 
                    address: property.address, 
                    latitude: property.latitude, 
                    longitude: property.longitude 
                  };

                  const relativeUrl = $unit.attr('href');
                  if (!relativeUrl) return;

                  unitDetails.url = `https://www.daft.ie${relativeUrl}`;
                  const urlParts = relativeUrl.split('/');
                  unitDetails.id = urlParts[urlParts.length - 1];

                  unitDetails.priceString = $unit.find('p[data-testid="mc-title"]').text().trim();
                  const parsedPrice = parsePrice(unitDetails.priceString);
                  unitDetails.parsedPrice = parsedPrice.value;
                  unitDetails.priceType = parsedPrice.type;

                  const detailsContainer = $unit.find('div[class*="eKLMRy"]');
                  const spans = detailsContainer.find('span');
                  unitDetails.bedsString = spans.filter((i, el) => $(el).attr('data-testid') === 'mc-details-first-item').text().trim();
                  unitDetails.bathsString = spans.filter((i, el) => $(el).attr('data-testid') === 'mc-details-second-item').text().trim();
                  unitDetails.propertyTypeString = spans.filter((i, el) => $(el).attr('data-testid') === 'mc-details-third-item').text().trim();
                  
                  unitDetails.parsedBeds = parseBeds(unitDetails.bedsString);
                  if (unitDetails.parsedBeds?.isStudio && !unitDetails.propertyTypeString) {
                      unitDetails.propertyTypeString = 'Studio';
                  }
                  
                  const berElement = $unit.find('div[data-testid="mc-ber"] div');
                  if (berElement.length > 0) {
                    const berAriaLabel = berElement.attr('aria-label');
                    if (berAriaLabel) {
                      unitDetails.ber = berAriaLabel.replace('BER ', '');
                    }
                  }

                  if (unitDetails.id) {
                    units.push(unitDetails);
                  }
                });
                console.error(`[daftScraper] Replaced development page ${property.url} with ${units.length} sub-units.`);
                return units; // Return the array of sub-units
              } else {
                // This is a regular page, enhance the original property with any missing details
                if (!property.ber) {
                  let detailBer = $detail('div[data-testid="callout-container"] [aria-label^="BER"]').attr('aria-label');
                  if (!detailBer) { detailBer = $detail('p[data-testid="ber"]').text().trim(); }
                  if (!detailBer) { detailBer = $detail('div[data-testid="ber-container"] p').text().trim(); }
                  if (detailBer) { property.ber = detailBer.replace('BER ', ''); }
                }
                // Lat/lng was already set above
                return [property]; // Return the single, enhanced property
              }
            } catch (err) {
              console.error(`[daftScraper] Failed to process detail page for ${property.url}: ${(err as Error).message}`);
              return [property]; // Return original property on error
            }
          })()
        );
      });
      
      currentPage++;
    } while (currentPage <= totalPages);

    const allPropertiesArrays = await Promise.all(propertyPromises);
    const allScrapedProperties = allPropertiesArrays.flat();

    console.error(`[daftScraper] Total properties scraped from all pages: ${allScrapedProperties.length}`);
    console.error(`[daftScraper] BEFORE filtering - allScrapedProperties (${allScrapedProperties.length} items):`, JSON.stringify(allScrapedProperties.map(p => ({ address: p.address, priceString: p.priceString, bedsString: p.bedsString, bathsString: p.bathsString, propertyTypeString: p.propertyTypeString, id: p.id, ber: p.ber, url: p.url, latitude: p.latitude, longitude: p.longitude })), null, 2));

    let filterLogCount = 0;
    const filteredProperties = allScrapedProperties.filter(p => {
      const noFiltersActive =
        receivedParams.min_price === undefined &&
        receivedParams.max_price === undefined &&
        receivedParams.num_beds === undefined &&
        receivedParams.property_type === undefined;

      if (filterLogCount < 1 && allScrapedProperties.length > 0) {
        console.error(`[daftScraper] FILTER CHECK (first item ID ${p.id || 'N/A'}): noFiltersActive = ${noFiltersActive}. Params: min_price=${receivedParams.min_price}, max_price=${receivedParams.max_price}, num_beds=${receivedParams.num_beds}, property_type=${receivedParams.property_type}`);
        filterLogCount++;
      }

      if (noFiltersActive) {
        return true;
      }

      // Apply active filters

      // Price filter
      if (receivedParams.min_price !== undefined || receivedParams.max_price !== undefined) {
        // Only filter by numeric prices. If price is 'on_application' or 'unknown', it won't match price range.
        if (p.priceType !== "numeric" || p.parsedPrice === null) return false;
        if (receivedParams.min_price !== undefined && p.parsedPrice < receivedParams.min_price) return false;
        if (receivedParams.max_price !== undefined && p.parsedPrice > receivedParams.max_price) return false;
      }

      // Number of beds filter: only apply if num_beds was specified.
      if (receivedParams.num_beds !== undefined) {
        if (p.parsedBeds === null || p.parsedBeds.min === undefined || p.parsedBeds.max === undefined) {
          return false; // Must have valid bed info if bed filter is active
        }
        // Check if the requested number of beds falls within the property's bed range
        if (receivedParams.num_beds < p.parsedBeds.min || receivedParams.num_beds > p.parsedBeds.max) {
          return false;
        }
      }

      // Property type filter (no change from previous correct version)
      if (receivedParams.property_type) {
        if (!p.propertyTypeString) return false;
        if (!p.propertyTypeString.toLowerCase().includes(receivedParams.property_type.toLowerCase())) return false;
      }

      // Location filter: only apply if receivedParams.location is specified.
      if (receivedParams.location && receivedParams.location.trim() !== "") {
        const requestedLocationLower = receivedParams.location.toLowerCase().trim();
        const propertyAddressLower = p.address ? p.address.toLowerCase() : "";

        if (!propertyAddressLower) {
          return false; // Must have an address to filter by location
        }

        let matchFound = false;

        if (requestedLocationLower === "ringsend") {
          const ringsendSynonyms = [
            "ringsend",
            "irishtown",
            "grand canal dock",
            "dublin 4",
            "dublin 2",
            " d4", // space before to avoid matching "d40" etc.
            " d2"  // space before
          ];
          for (const term of ringsendSynonyms) {
            if (propertyAddressLower.includes(term)) {
              matchFound = true;
              break;
            }
          }
          // Also check for D4/D2 without space if it's at the end of a word or string
          if (!matchFound && (propertyAddressLower.match(/\bd4\b/i) || propertyAddressLower.match(/\bd2\b/i))) {
            matchFound = true;
          }

        } else {
          // Original logic for non-Ringsend locations
          if (propertyAddressLower.includes(requestedLocationLower)) {
            matchFound = true;
          } else {
            // Fallback for Dublin postal codes if the input was like "Dublin X"
            const postalCodeMatch = requestedLocationLower.match(/dublin\s*(\d+)/i);
            if (postalCodeMatch && postalCodeMatch[1]) {
              const postalCodeFull = `dublin ${postalCodeMatch[1]}`;
              const postalCodeShort = `d${postalCodeMatch[1]}`; // e.g., d4, d2
              if (propertyAddressLower.includes(postalCodeFull) || propertyAddressLower.match(new RegExp(`\\b${postalCodeShort}\\b`, 'i'))) {
                matchFound = true;
              }
            }
          }
        }
        if (!matchFound) return false;
      }
      
      return true;
    });

    console.error(`[daftScraper] Found ${allScrapedProperties.length} raw scraped items from all pages, ${filteredProperties.length} after applying user filters.`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(filteredProperties, null, 2),
        },
      ],
    };
  } catch (error) {
    let coreMessage = `Error during scraping Daft.ie for "${location}"`;
    let errorType = "ScrapingError";
    const errorDetails: any = {
        locationParam: location,
        receivedParams: receivedParams
    };

    if (axios.isAxiosError(error)) {
      errorType = "NetworkError";
      coreMessage = `Axios error while scraping Daft.ie for "${location}": ${error.message}`;
      errorDetails.url = error.config?.url;
      errorDetails.status = error.response?.status;
      errorDetails.axiosErrorCode = error.code;
    } else if (error instanceof Error) {
      errorType = "GenericScrapingError";
      coreMessage = `Generic error while scraping Daft.ie for "${location}": ${error.message}`;
      if (error.stack) {
        errorDetails.stack = error.stack.split('\n').slice(0, 5).join('\n'); // Include a short stack trace
      }
    }
    
    const fullErrorMessage = `${errorType}: ${coreMessage}`;
    console.error(`[daftScraper] ${fullErrorMessage} | Details: ${JSON.stringify(errorDetails)}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            errorType: errorType,
            sourceFunction: "handleSearchRentalPropertiesScraping",
            message: coreMessage,
            details: errorDetails
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
}