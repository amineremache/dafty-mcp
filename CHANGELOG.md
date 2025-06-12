# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-06-12

### Added
- Web scraping functionality for the `search_rental_properties` tool to fetch data directly from Daft.ie.
  - Constructs search URLs based on location, price, number of beds, and property type.
  - Parses HTML using Cheerio to extract property details (ID, address, URL, price, beds, property type, tagline, image).
  - Implements filtering of scraped results based on user-provided criteria.
- Helper functions `parsePrice` and `parseBeds` for converting scraped string values to numbers (now located in `daftScraper.ts`).
- More robust CSS selectors with fallbacks for extracting property data within the scraper.

### Changed
- **BREAKING CHANGE (for `search_rental_properties` tool):** The `search_rental_properties` tool now uses web scraping instead of the Daft.ie API due to API access restrictions (403 errors, likely requiring an unavailable API key).
- Refactored MCP server code into separate modules:
  - `daftScraper.ts`: Contains all web scraping logic for property searches.
  - `daftApi.ts`: Contains the (likely non-functional) Daft.ie API client and `get_rental_property_details` tool logic. Added comments regarding API key requirements.
  - `index.ts`: Main entry point, handles server setup, Zod schema definitions, and tool registration using imported handlers.
- Updated `index.ts` to correctly use Zod schema `.shape` for tool registration with manual parsing in callbacks, which then call the typed handlers from `daftScraper.ts` and `daftApi.ts`.
- Improved URL construction logic for Daft.ie scraper to more accurately target locations (e.g., "Dublin 2") and property types based on observed Daft.ie URL patterns.
- Logging for `search_rental_properties` (scraper) now uses `console.error` for operational messages, removing verbose file-based and per-item debugging logs for cleaner production output.

### Fixed
- Resolved "Invalid parameters" error for tool calls by correctly identifying that parameters are passed directly in the `extra` argument when using `.shape` for schema registration and implementing manual parsing in the `index.ts` tool registration callbacks.
- Addressed various TypeScript errors related to Zod schema usage with MCP SDK and callback signatures during the refactoring process.
- Corrected `__dirname` usage for ES module compatibility when file logging was temporarily enabled during debugging.
- Fixed build errors in test files (`tools.spec.ts`) by updating calls to `handleGetRentalPropertyDetails` to match its refactored signature (using `as any` for intentionally invalid test inputs).
- Resolved ESLint parsing errors related to `tsconfig.json` inclusion by adjusting `parserOptions.project` in `.eslintrc.cjs` to be an array.