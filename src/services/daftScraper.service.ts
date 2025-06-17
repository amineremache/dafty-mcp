import axios from 'axios';
import * as cheerio from 'cheerio';
import { URLSearchParams } from 'url';
import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import type { SearchRentalPropertiesParams } from '../types.js';
import {
  parsePrice,
  parseBeds,
  slugify,
  extractLatLng,
  formatBer,
  generateDaftLocationSlug,
} from '../utils/parser.utils.js';

import { ParsedBedsResult } from '../types.js';
import { config } from '../config.js';

import logger from '../logger.js';

// Helper function to introduce a delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_PAGES_TO_FETCH = 5; // Safety limit for pagination

interface Property {
  address: string;
  url: string;
  id: string;
  tagline: string;
  priceString: string;
  parsedPrice: number | null;
  priceType: 'numeric' | 'on_application' | 'unknown';
  bedsString: string;
  parsedBeds: ParsedBedsResult | null;
  bathsString: string;
  propertyTypeString: string;
  ber?: string;
  latitude?: number;
  longitude?: number;
  units?: Unit[];
}

interface Unit {
  address: string;
  url: string;
  id: string;
  priceString: string;
  parsedPrice: number | null;
  priceType: 'numeric' | 'on_application' | 'unknown';
  bedsString: string;
  parsedBeds: ParsedBedsResult | null;
  bathsString: string;
  propertyTypeString: string;
  ber?: string;
  tagline: string;
}

export async function handleSearchRentalPropertiesScraping({
  location,
  min_price,
  max_price,
  num_beds,
  property_type,
}: SearchRentalPropertiesParams): Promise<{ content: TextContent[]; isError?: boolean }> {
  logger.info('--- daftScraper.service.ts: handleSearchRentalPropertiesScraping CALLED (with pagination) ---');
  const receivedParams = { location, min_price, max_price, num_beds, property_type };
  logger.info('[daftScraper.service.ts] Received parameters:', receivedParams);

  try {
    // 1. Construct Base Search URL (without page parameter initially)
    let urlPath = `/property-for-rent/ireland`;
    const queryParams = new URLSearchParams();

    const locations = Array.isArray(location) ? location : location ? [location] : [];

    if (locations.length === 1) {
      const locationSlug = generateDaftLocationSlug(locations[0]);
      if (locationSlug) {
        urlPath = `/property-for-rent/${locationSlug}`;
      }
    } else if (locations.length > 1) {
      locations.forEach((loc) => {
        if (loc && loc.trim() !== '') {
          const locationSlug = generateDaftLocationSlug(loc);
          if (locationSlug) {
            queryParams.append('location', locationSlug);
          }
        }
      });
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

    if (min_price) queryParams.append('rentalPrice_from', min_price.toString());
    if (max_price) queryParams.append('rentalPrice_to', max_price.toString());
    // Only add bed filters if num_beds is specified by the user
    if (num_beds !== undefined) {
      queryParams.append('numBeds_from', num_beds.toString());
      queryParams.append('numBeds_to', num_beds.toString()); // Search for the exact number of beds specified
    }

    const queryString = queryParams.toString();
    const baseSearchUrl = `${config.daft.baseUrl}${urlPath}${queryString ? '?' + queryString : ''}`;
    logger.info(`[daftScraper.service.ts] Constructed base search URL: ${baseSearchUrl}`);

    const propertyPromises: Promise<Property[]>[] = [];
    let currentPage = 1;
    let totalPages = 1;
    const resultsPerPage = 20; // Daft.ie seems to use 20 results per page

    // Helper function for fetching and parsing a single page's HTML
    const MAX_FETCH_RETRIES = config.scraping.maxFetchRetries; // Number of retries for fetching a page
    const RETRY_DELAY_MS = config.scraping.retryDelayMs; // Delay between retries

    async function fetchPageHTML(pageNumber: number): Promise<string | null> {
      const pageUrlSuffix = pageNumber === 1 ? '' : `${baseSearchUrl.includes('?') ? '&' : '?'}page=${pageNumber}`;
      const fullPageUrl = pageNumber === 1 ? baseSearchUrl : `${baseSearchUrl}${pageUrlSuffix}`;

      for (let attempt = 1; attempt <= MAX_FETCH_RETRIES + 1; attempt++) {
        logger.info(
          `[daftScraper.service.ts] Fetching HTML for page ${pageNumber} from ${fullPageUrl} (Attempt ${attempt})`
        );
        try {
          const response = await axios.get(fullPageUrl, {
            headers: {
              'User-Agent': config.scraping.userAgent,
              Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Accept-Language': 'en-US,en;q=0.9',
              Referer: 'https://www.google.com/',
            },
            timeout: config.scraping.requestTimeout, // 10 second timeout for the request
          });
          logger.info(
            `[daftScraper.service.ts] HTML fetched successfully for page ${pageNumber}. Status: ${response.status}`
          );
          return response.data;
        } catch (pageError) {
          let errorMsg = `Error fetching page ${pageNumber} from ${fullPageUrl} (Attempt ${attempt})`;
          if (axios.isAxiosError(pageError)) {
            errorMsg = `Axios error fetching page ${pageNumber} (Attempt ${attempt}): ${pageError.message}. Status: ${pageError.response?.status}. URL: ${pageError.config?.url}`;
          } else if (pageError instanceof Error) {
            errorMsg = `Generic error fetching page ${pageNumber} (Attempt ${attempt}): ${pageError.message}`;
          }
          logger.error(`[daftScraper.service.ts] ${errorMsg}`);
          if (attempt > MAX_FETCH_RETRIES) {
            logger.error(`[daftScraper.service.ts] Max retries reached for page ${pageNumber}. Giving up.`);
            return null;
          }
          logger.warn(`[daftScraper.service.ts] Retrying page ${pageNumber} in ${RETRY_DELAY_MS / 1000}s...`);
          await delay(RETRY_DELAY_MS);
        }
      }
      return null; // Should be unreachable if loop logic is correct
    }

    // Main pagination loop
    do {
      if (currentPage > 1) {
        logger.info(`[daftScraper.service.ts] Adding delay before fetching page ${currentPage}...`);
        await delay(1500); // 1.5 second delay between page fetches
      }

      const htmlData = await fetchPageHTML(currentPage);
      if (!htmlData) {
        if (currentPage === 1) {
          // Critical failure if first page fails
          logger.error(
            `[daftScraper.service.ts] Critical failure: Failed to fetch initial page for location: "${location}" using URL: ${baseSearchUrl}`
          );
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    errorType: 'NetworkError',
                    sourceFunction: 'handleSearchRentalPropertiesScraping.fetchPageHTML',
                    message: `Failed to fetch initial page for location: "${location}".`,
                    details: {
                      attemptedUrl: baseSearchUrl, // Log the specific URL tried
                      locationParam: location,
                      receivedParams: receivedParams,
                    },
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
        }
        logger.error(`[daftScraper.service.ts] Failed to fetch page ${currentPage}, stopping pagination.`);
        break; // Stop if a subsequent page fails
      }

      const $ = cheerio.load(htmlData);

      // On the first page, try to determine total number of pages
      if (currentPage === 1) {
        const totalResultsString = $('span.sc-4c172e97-0.ioLdWh').first().text();
        logger.info(`[daftScraper.service.ts] Found total results string: "${totalResultsString}"`);
        if (totalResultsString) {
          const match = totalResultsString.match(/of\s*([\d,]+)\s*total results/i); // Allow for comma in number
          if (match && match[1]) {
            const totalResultsRaw = match[1].replace(/,/g, ''); // Remove commas
            const totalResults = parseInt(totalResultsRaw, 10);
            if (!isNaN(totalResults)) {
              const calculatedPages = Math.ceil(totalResults / resultsPerPage);
              totalPages = Math.min(calculatedPages, MAX_PAGES_TO_FETCH);
              if (calculatedPages > MAX_PAGES_TO_FETCH) {
                logger.warn(
                  `[daftScraper.service.ts] Calculated total pages (${calculatedPages}) exceeds MAX_PAGES_TO_FETCH (${MAX_PAGES_TO_FETCH}). Capping at ${MAX_PAGES_TO_FETCH}.`
                );
              }
              logger.info(
                `[daftScraper.service.ts] Extracted total results: ${totalResults}, calculated pages: ${calculatedPages}, effective total pages: ${totalPages}`
              );
            } else {
              logger.error(
                `[daftScraper.service.ts] Failed to parse number from totalResultsRaw: "${totalResultsRaw}". Assuming 1 page.`
              );
              totalPages = 1;
            }
          } else {
            logger.error(
              `[daftScraper.service.ts] Could not parse total results from string via regex: "${totalResultsString}". Assuming 1 page for safety.`
            );
            totalPages = 1;
          }
        } else {
          logger.error('[daftScraper.service.ts] Total results string element not found. Assuming 1 page.');
          totalPages = 1;
        }
      }

      const resultsList = $('ul[data-testid="results"]');
      if (resultsList.length === 0) {
        logger.warn(
          `[daftScraper.service.ts] Could not find results list (ul[data-testid="results"]) on page ${currentPage}. Stopping pagination for this search.`
        );
        if (currentPage === 1) {
          logger.warn(`[daftScraper.service.ts] No results found on the first page.`);
        }
        break;
      }

      const propertyItems = resultsList.find('li[data-testid^="result-"]');
      logger.info(`[daftScraper.service.ts] Found ${propertyItems.length} property items on page ${currentPage}.`);
      if (propertyItems.length === 0 && currentPage > 1) {
        // No items on a subsequent page
        logger.info(
          `[daftScraper.service.ts] No more property items found on page ${currentPage}. Assuming end of results for this search.`
        );
        break;
      } else if (propertyItems.length === 0 && currentPage === 1) {
        // No items on the very first page
        logger.info(`[daftScraper.service.ts] No property items found on the first page (page ${currentPage}).`);
        if (totalPages > 1) break;
      }

      propertyItems.each((index, element) => {
        const $element = $(element);
        const property: Partial<Property> = {};

        property.address = $element.find('div[data-tracking="srp_address"] p').first().text().trim();

        let mainLink = $element.find('a[data-testid="card-link"]').first();
        if (mainLink.length === 0) {
          mainLink = $element.find('a.sc-e4e4a161-16.dukjos').first();
        }
        const relativeUrl = mainLink.attr('href');
        if (relativeUrl) {
          property.url = `${config.daft.baseUrl}${relativeUrl}`;
          const urlParts = relativeUrl.split('/');
          property.id = urlParts[urlParts.length - 1];
        }

        if (!property.id) {
          const dataTestId = $element.attr('data-testid');
          if (dataTestId) property.id = dataTestId.replace('result-', '');
        }

        if (!property.url && property.id && property.address) {
          const addressSlug = slugify(property.address);
          property.url = `${config.daft.baseUrl}/for-rent/${addressSlug}/${property.id}`;
        }
        property.tagline = $element.find('div[data-tracking="srp_tagline"] p').first().text().trim();

        let mainPriceString = '';
        const priceSelectors = [
          'p[data-testid="price"]',
          '[class*="TitleBlock__StyledSpan"][class*="price"]',
          'p.csEcJw',
          'div[data-testid="card-price"] p',
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
            if (
              potentialPriceText.includes('€') ||
              /per (month|week)/i.test(potentialPriceText) ||
              /POA|price on application/i.test(potentialPriceText)
            ) {
              mainPriceString = potentialPriceText;
            }
          }
        }
        property.priceString = mainPriceString;
        const parsedPriceResult = parsePrice(mainPriceString);
        property.parsedPrice = parsedPriceResult.value;
        property.priceType = parsedPriceResult.type;

        let mainBedsString = $element.find('[data-testid="beds"]').text().trim();
        const mainBathsString = $element.find('[data-testid="baths"]').text().trim();
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
          property.ber = formatBer(ber);
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
            const unitDetails: Partial<Unit> = {};

            const unitRelativeUrl = $unit.attr('href');
            if (unitRelativeUrl) {
              unitDetails.url = `${config.daft.baseUrl}${unitRelativeUrl}`;
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
              bedsString = spans
                .filter((i, el) => $(el).attr('data-testid') === 'mc-details-first-item')
                .text()
                .trim();
              bathsString = spans
                .filter((i, el) => $(el).attr('data-testid') === 'mc-details-second-item')
                .text()
                .trim();
              propertyTypeString = spans
                .filter((i, el) => $(el).attr('data-testid') === 'mc-details-third-item')
                .text()
                .trim();
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
              if (
                property.units &&
                unitDetails.id &&
                unitDetails.url &&
                unitDetails.priceString &&
                unitDetails.bedsString &&
                unitDetails.bathsString &&
                unitDetails.propertyTypeString
              ) {
                property.units.push(unitDetails as Unit);
              }
            }
          });

          if (property.units.length > 0) {
            const firstUnit = property.units[0];
            if (property.priceType === 'unknown' || !property.parsedPrice) {
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
              if (property.address && property.url && property.id) {
                return [property as Property];
              }
              return [];
            }
            logger.info(`[daftScraper.service.ts] Processing detail page for: ${property.url}`);
            try {
              const { data: htmlData } = await axios.get(property.url, {
                headers: {
                  'User-Agent': config.scraping.userAgent,
                },
                timeout: config.scraping.requestTimeout,
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
              logger.info(`[daftScraper.service.ts] Found ${subUnitElements.length} sub-units for ${property.url}`);
              if (subUnitElements.length > 0) {
                // This is a development page. We will parse its sub-units and return them as individual properties,
                // discarding the parent "development" property which is not a rentable unit itself.
                const subProperties: Property[] = [];
                subUnitElements.each((index, element) => {
                  const $unit = $(element);
                  const unitDetails: Partial<Property> = {
                    // Inherit from parent property
                    address: property.address,
                    tagline: property.tagline,
                    latitude: property.latitude,
                    longitude: property.longitude,
                  };

                  const relativeUrl = $unit.attr('href');
                  if (!relativeUrl) return; // Skip if no URL

                  unitDetails.url = `${config.daft.baseUrl}${relativeUrl}`;
                  const urlParts = relativeUrl.split('/');
                  unitDetails.id = urlParts[urlParts.length - 1];

                  unitDetails.priceString = $unit.find('p[data-testid="mc-title"]').text().trim();
                  const parsedPrice = parsePrice(unitDetails.priceString);
                  unitDetails.parsedPrice = parsedPrice.value;
                  unitDetails.priceType = parsedPrice.type;

                  const detailsContainer = $unit.find('div[class*="eKLMRy"]');
                  const spans = detailsContainer.find('span');
                  unitDetails.bedsString = spans
                    .filter((i, el) => $(el).attr('data-testid') === 'mc-details-first-item')
                    .text()
                    .trim();
                  unitDetails.bathsString = spans
                    .filter((i, el) => $(el).attr('data-testid') === 'mc-details-second-item')
                    .text()
                    .trim();
                  unitDetails.propertyTypeString = spans
                    .filter((i, el) => $(el).attr('data-testid') === 'mc-details-third-item')
                    .text()
                    .trim();

                  unitDetails.parsedBeds = parseBeds(unitDetails.bedsString);
                  if (unitDetails.parsedBeds?.isStudio && !unitDetails.propertyTypeString) {
                    unitDetails.propertyTypeString = 'Studio';
                  }

                  const berElement = $unit.find('div[data-testid="mc-ber"] div');
                  if (berElement.length > 0) {
                    const berAriaLabel = berElement.attr('aria-label');
                    if (berAriaLabel) {
                      unitDetails.ber = formatBer(berAriaLabel);
                    }
                  }

                  // Ensure we have a valid property before adding it
                  if (unitDetails.id && unitDetails.url && unitDetails.address && unitDetails.priceString) {
                    subProperties.push(unitDetails as Property);
                  } else {
                    const missingData = [];
                    if (!unitDetails.id) missingData.push('id');
                    if (!unitDetails.url) missingData.push('url');
                    if (!unitDetails.address) missingData.push('address');
                    if (!unitDetails.priceString) missingData.push('priceString');
                    logger.warn(
                      `[daftScraper.service.ts] Skipping sub-unit due to missing essential data: [${missingData.join(
                        ', '
                      )}]. URL: ${unitDetails.url}`
                    );
                  }
                });

                logger.info(
                  `[daftScraper.service.ts] Replaced development page ${property.url} with ${subProperties.length} sub-properties.`
                );
                return subProperties;
              } else {
                logger.info(
                  `[daftScraper.service.ts] No sub-units found for ${property.url}. Treating as single property.`
                );
                // This is a regular page, enhance the original property with any missing details
                if (!property.ber) {
                  let detailBer = $detail('div[data-testid="callout-container"] [aria-label^="BER"]').attr(
                    'aria-label'
                  );
                  if (!detailBer) {
                    detailBer = $detail('p[data-testid="ber"]').text().trim();
                  }
                  if (!detailBer) {
                    detailBer = $detail('div[data-testid="ber-container"] p').text().trim();
                  }
                  if (detailBer) {
                    property.ber = formatBer(detailBer);
                  }
                }
                // Lat/lng was already set above
                if (property.address && property.url && property.id) {
                  return [property as Property];
                }
                return [];
              }
            } catch (err) {
              logger.error(
                `[daftScraper.service.ts] Failed to process detail page for ${property.url}: ${(err as Error).message}`
              );
              if (property.address && property.url && property.id) {
                return [property as Property];
              }
              return [];
            }
          })()
        );
      });

      currentPage++;
    } while (currentPage <= totalPages);

    const allPropertiesArrays = await Promise.all(propertyPromises);
    const allScrapedProperties = allPropertiesArrays.flat();

    logger.info(`[daftScraper.service.ts] Total properties scraped from all pages: ${allScrapedProperties.length}`);
    logger.info(
      `[daftScraper.service.ts] BEFORE filtering - allScrapedProperties (${allScrapedProperties.length} items):`,
      allScrapedProperties
    );

    let filterLogCount = 0;
    const filteredProperties = allScrapedProperties.filter((p) => {
      const noFiltersActive =
        receivedParams.min_price === undefined &&
        receivedParams.max_price === undefined &&
        receivedParams.num_beds === undefined &&
        receivedParams.property_type === undefined;

      if (filterLogCount < 1 && allScrapedProperties.length > 0) {
        logger.info(
          `[daftScraper.service.ts] FILTER CHECK (first item ID ${p.id || 'N/A'}): noFiltersActive = ${noFiltersActive}. Params: min_price=${receivedParams.min_price}, max_price=${receivedParams.max_price}, num_beds=${receivedParams.num_beds}, property_type=${receivedParams.property_type}`
        );
        filterLogCount++;
      }

      if (noFiltersActive) {
        return true;
      }

      // Apply active filters

      // Price filter
      if (receivedParams.min_price !== undefined || receivedParams.max_price !== undefined) {
        // Only filter by numeric prices. If price is 'on_application' or 'unknown', it won't match price range.
        if (p.priceType !== 'numeric' || p.parsedPrice === null) return false;
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

      // Location filter: handles single or multiple locations
      if (receivedParams.location) {
        const requestedLocations = (
          Array.isArray(receivedParams.location) ? receivedParams.location : [receivedParams.location]
        )
          .map((l) => l.toLowerCase().trim())
          .filter((l) => l !== '');

        if (requestedLocations.length > 0) {
          const propertyAddressLower = p.address ? p.address.toLowerCase() : '';

          if (!propertyAddressLower) {
            return false; // Must have an address to filter by location
          }

          let locationMatchFound = false;
          for (const requestedLocationLower of requestedLocations) {
            let singleMatchFound = false;
            if (requestedLocationLower === 'ringsend') {
              const ringsendSynonyms = [
                'ringsend',
                'irishtown',
                'grand canal dock',
                'dublin 4',
                'dublin 2',
                ' d4',
                ' d2',
              ];
              for (const term of ringsendSynonyms) {
                if (propertyAddressLower.includes(term)) {
                  singleMatchFound = true;
                  break;
                }
              }
              if (
                !singleMatchFound &&
                (propertyAddressLower.match(/\bd4\b/i) || propertyAddressLower.match(/\bd2\b/i))
              ) {
                singleMatchFound = true;
              }
            } else {
              // Original logic for non-Ringsend locations
              if (propertyAddressLower.includes(requestedLocationLower)) {
                singleMatchFound = true;
              } else {
                // Fallback for Dublin postal codes if the input was like "Dublin X"
                const postalCodeMatch = requestedLocationLower.match(/dublin\s*(\d+)/i);
                if (postalCodeMatch && postalCodeMatch[1]) {
                  const postalCodeFull = `dublin ${postalCodeMatch[1]}`;
                  const postalCodeShort = `d${postalCodeMatch[1]}`; // e.g., d4, d2
                  if (
                    propertyAddressLower.includes(postalCodeFull) ||
                    propertyAddressLower.match(new RegExp(`\\b${postalCodeShort}\\b`, 'i'))
                  ) {
                    singleMatchFound = true;
                  }
                }
              }
            }
            if (singleMatchFound) {
              locationMatchFound = true;
              break; // Found a match for one of the locations, so we can stop checking locations for this property
            }
          }
          if (!locationMatchFound) return false;
        }
      }

      return true;
    });

    logger.info(
      `[daftScraper.service.ts] Found ${allScrapedProperties.length} raw scraped items from all pages, ${filteredProperties.length} after applying user filters.`
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(filteredProperties, null, 2),
        },
      ],
    };
  } catch (error) {
    let coreMessage = `Error during scraping Daft.ie for "${location}"`;
    let errorType = 'ScrapingError';
    const errorDetails: Record<string, unknown> = {
      locationParam: location,
      receivedParams: receivedParams,
    };

    if (axios.isAxiosError(error)) {
      errorType = 'NetworkError';
      coreMessage = `Axios error while scraping Daft.ie for "${location}": ${error.message}`;
      errorDetails.url = error.config?.url;
      errorDetails.status = error.response?.status;
      errorDetails.axiosErrorCode = error.code;
    } else if (error instanceof Error) {
      errorType = 'GenericScrapingError';
      coreMessage = `Generic error while scraping Daft.ie for "${location}": ${error.message}`;
      if (error.stack) {
        errorDetails.stack = error.stack.split('\n').slice(0, 5).join('\n'); // Include a short stack trace
      }
    }

    const fullErrorMessage = `${errorType}: ${coreMessage}`;
    logger.error(`[daftScraper.service.ts] ${fullErrorMessage} | Details: ${JSON.stringify(errorDetails)}`);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              errorType: errorType,
              sourceFunction: 'handleSearchRentalPropertiesScraping',
              message: coreMessage,
              details: errorDetails,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}
