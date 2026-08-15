/** Protocol constants shared by Docket's Notion adapters. */

/**
 * The Notion API version Docket's adapters speak.
 *
 * @remarks
 * Notion versioning changes request and response shapes. Keeping this constant in Connections
 * makes linked and Docket-designed database adapters use one deliberate protocol boundary.
 */
export const NOTION_API_VERSION = '2026-03-11';
