import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { URLSearchParams } from 'url';
import type { TextContent } from "@modelcontextprotocol/sdk/types.js";
// Import the Zod-inferred type from index.ts (or a future shared types.ts)
import type { SearchRentalPropertiesParams } from "./index.js";

// Helper function to parse price strings (e.g., "€2,500 per month")
const parsePrice = (priceString: string | undefined): number | null => {
  if (!priceString) return null;
  const match = priceString.replace(/[^0-9]/g, ''); // Remove non-numeric characters
  return match ? parseInt(match, 10) : null;
};

// Helper function to parse bed strings (e.g., "1 Bed", "2 Beds")
const parseBeds = (bedString: string | undefined): number | null => {
  if (!bedString) return null;
  const match = bedString.match(/^(\d+)\s*Bed/i);
  return match && match[1] ? parseInt(match[1], 10) : null;
};

export async function handleSearchRentalPropertiesScraping(
  { location, min_price, max_price, num_beds, property_type }: SearchRentalPropertiesParams
): Promise<{ content: TextContent[]; isError?: boolean }> {
  // Using console.error for primary operational logging as per original scraper
  console.error('--- daftScraper: handleSearchRentalPropertiesScraping CALLED ---');
  const receivedParams = { location, min_price, max_price, num_beds, property_type };
  console.error('[daftScraper] Received parameters:', receivedParams);

  try {
    // 1. Construct Search URL
    const slugify = (str: string) => str.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const locationSlug = slugify(location);
    
    let urlPath = `/property-for-rent/`;
    if (location.toLowerCase() === 'dublin 2') {
      urlPath += 'dublin-2-dublin';
    } else if (location.toLowerCase() === 'dublin city') {
      urlPath += 'dublin-city';
    } else {
      urlPath += locationSlug;
    }

    if (property_type) {
      const propertyTypeSlug = slugify(property_type);
      if (propertyTypeSlug === 'apartment') {
        urlPath += '/apartments';
      } else if (propertyTypeSlug === 'house') {
        urlPath += '/houses';
      } else {
        urlPath += `/${propertyTypeSlug}s`;
      }
    }
    
    const queryParams = new URLSearchParams();
    if (min_price) {
      queryParams.append('rentalPrice_from', min_price.toString());
    }
    if (max_price) {
      queryParams.append('rentalPrice_to', max_price.toString());
    }
    if (num_beds) {
      queryParams.append('numBeds_from', num_beds.toString());
      if (num_beds === 1) {
        queryParams.append('numBeds_to', '2');
      } else {
        queryParams.append('numBeds_to', num_beds.toString());
      }
    }

    const queryString = queryParams.toString();
    const searchUrl = `https://www.daft.ie${urlPath}${queryString ? '?' + queryString : ''}`;
    console.error(`[daftScraper] Constructed search URL: ${searchUrl}`);

    // 2. Fetch HTML
    console.error(`[daftScraper] Fetching HTML from ${searchUrl}`);
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
      }
    });
    console.error(`[daftScraper] HTML fetched successfully. Status: ${response.status}`);

    // 3. Load HTML into Cheerio
    const $ = cheerio.load(response.data);

    // 4. Basic Parsing
    const resultsList = $('ul[data-testid="results"]');
    if (resultsList.length === 0) {
      console.error('[daftScraper] Could not find results list (ul[data-testid="results"]).');
      return {
        content: [{ type: "text", text: `Could not find results list on Daft.ie for ${location}. Page structure might have changed or no results found.` }],
        isError: true,
      };
    }
    
    const propertyItems = resultsList.find('li[data-testid^="result-"]');
    const propertyCount = propertyItems.length;
    console.error(`[daftScraper] Found ${propertyCount} property items on page.`);

    const allScrapedProperties: any[] = [];

    propertyItems.each((index, element) => {
      const $element = $(element);
      const property: any = {};

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
          if (dataTestId) {
              property.id = dataTestId.replace('result-', '');
          }
      }

      property.address = $element.find('div[data-tracking="srp_address"] p').first().text().trim();
      property.tagline = $element.find('div[data-tracking="srp_tagline"] p').first().text().trim();
      property.imageUrl = $element.find('img[data-testid="card-image"]').first().attr('src');

      let mainPriceString = $element.find('p.csEcJw').first().text().trim();
      if (!mainPriceString) {
          mainPriceString = $element.find('p[class^="sc-4c172e97-0"]').first().text().trim();
      }
      // ... (keep other price fallbacks from original index.ts)
      if (!mainPriceString) { mainPriceString = $element.find('p[data-testid="price"]').first().text().trim(); }
      if (!mainPriceString) { mainPriceString = $element.find('div[data-testid="card-price"] p').first().text().trim(); }
      if (!mainPriceString) { mainPriceString = $element.find('[class*="TitleBlock__StyledSpan"][class*="price"]').first().text().trim(); }
      if (!mainPriceString) { mainPriceString = $element.find('.PropertyInformationCommonStyles__PriceAmount-sc-1cjwt21-6').first().text().trim(); }

      property.priceString = mainPriceString;
      property.parsedPrice = parsePrice(mainPriceString);
      
      let mainBedsString = $element.find('p[data-testid="beds"]').first().text().trim();
      if (!mainBedsString) {
          $element.find('p, span, li').each((i, el) => {
              const text = $(el).text().trim();
              if (text.match(/^\d+\s*Bed/i)) {
                  mainBedsString = text;
                  return false; 
              }
          });
      }
      property.bedsString = mainBedsString;
      property.parsedBeds = parseBeds(mainBedsString);
      
      let mainPropertyTypeString = $element.find('p[data-testid="property-type"]').first().text().trim();
      if (!mainPropertyTypeString) {
           $element.find('p, span, li').each((i, el) => {
              const text = $(el).text().trim();
              if (text.toLowerCase() === 'apartment' || text.toLowerCase() === 'house' || text.toLowerCase() === 'studio') {
                  mainPropertyTypeString = text;
                  return false; 
              }
          });
      }
      property.propertyTypeString = mainPropertyTypeString;

      const unitElements = $element.find('div[data-testid="sub-unit-card"]');
      if (unitElements.length > 0) {
        property.units = [];
        unitElements.each((unitIndex, unitElement) => {
          const $unit = $(unitElement);
          const unitDetails: any = {};
          
          let unitPriceString = $unit.find('p[data-testid="sub-unit-price"]').first().text().trim();
          // ... (add unit price fallbacks)
          if (!unitPriceString) { unitPriceString = $unit.find('[class*="SubUnit__Price"]').first().text().trim(); }
          if (!unitPriceString) { unitPriceString = $unit.find('.Subunit__Price-sc-10l08s1-4').first().text().trim(); }

          unitDetails.priceString = unitPriceString;
          unitDetails.parsedPrice = parsePrice(unitPriceString);

          let unitBedsString = $unit.find('p[data-testid="sub-unit-beds"]').first().text().trim();
          // ... (add unit beds fallbacks)
           if (!unitBedsString) { 
              $unit.find('p, span, li').each((i, el) => {
                  const text = $(el).text().trim();
                  if (text.match(/^\d+\s*Bed/i)) {
                      unitBedsString = text;
                      return false; 
                  }
              });
          }
          unitDetails.bedsString = unitBedsString;
          unitDetails.parsedBeds = parseBeds(unitBedsString);
          
          let unitPropertyTypeString = $unit.find('p[data-testid="sub-unit-property-type"]').first().text().trim();
          // ... (add unit type fallbacks)
          if (!unitPropertyTypeString) { 
               $unit.find('p, span, li').each((i, el) => {
                  const text = $(el).text().trim();
                  if (text.toLowerCase() === 'apartment' || text.toLowerCase() === 'house' || text.toLowerCase() === 'studio') {
                      unitPropertyTypeString = text;
                      return false; 
                  }
              });
          }
          unitDetails.propertyTypeString = unitPropertyTypeString;
          
          const unitRelativeUrl = $unit.find('a[data-testid="card-link"]').attr('href');
          if (unitRelativeUrl) {
              unitDetails.url = `https://www.daft.ie${unitRelativeUrl}`;
              const unitUrlParts = unitRelativeUrl.split('/');
              unitDetails.id = unitUrlParts[unitUrlParts.length -1];
          }
          property.units.push(unitDetails);
        });

        if (property.units.length > 0) {
          const firstUnit = property.units[0];
          if (property.parsedPrice === null && firstUnit.parsedPrice !== null) {
            property.parsedPrice = firstUnit.parsedPrice;
            property.priceString = firstUnit.priceString;
          }
          if (property.parsedBeds === null && firstUnit.parsedBeds !== null) {
            property.parsedBeds = firstUnit.parsedBeds;
            property.bedsString = firstUnit.bedsString;
          }
          if (!property.propertyTypeString && firstUnit.propertyTypeString) {
            property.propertyTypeString = firstUnit.propertyTypeString;
          }
        }
      }
      
      if (property.id && property.address) {
          allScrapedProperties.push(property);
      }
    });

    const filteredProperties = allScrapedProperties.filter(p => {
      const isInDublin2 = p.address && p.address.toLowerCase().includes('dublin 2');
      const isApartment = p.propertyTypeString && p.propertyTypeString.toLowerCase().includes('apartment');
      const priceOk = p.parsedPrice !== null && p.parsedPrice < (max_price || Infinity);
      const bedsOk = p.parsedBeds !== null && p.parsedBeds >= 1 && p.parsedBeds <= 2;
      
      return isInDublin2 && isApartment && priceOk && bedsOk;
    });

    console.error(`[daftScraper] Found ${allScrapedProperties.length} raw scraped items on page, ${filteredProperties.length} after applying filters.`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(filteredProperties, null, 2),
        },
      ],
    };
  } catch (error) {
    let errorMessage = `Error during scraping Daft.ie for "${location}"`;
    if (axios.isAxiosError(error)) {
      errorMessage = `Axios error while scraping Daft.ie for "${location}": ${error.message}. Status: ${error.response?.status}. URL: ${error.config?.url}`;
    } else if (error instanceof Error) {
      errorMessage = `Generic error while scraping Daft.ie for "${location}": ${error.message}`;
    }
    console.error(`[daftScraper] ${errorMessage}`);
    return {
      content: [
        {
          type: "text",
          text: `${errorMessage}. Received params: ${JSON.stringify(receivedParams)}`,
        },
      ],
      isError: true,
    };
  }
}