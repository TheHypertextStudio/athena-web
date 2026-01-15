/**
 * CalDAV Server Service.
 *
 * Provides CalDAV protocol support for native calendar app integration.
 * Enables iOS/macOS Calendar.app and other CalDAV clients to sync with Athena.
 *
 * @packageDocumentation
 */

export {
  authenticateDav,
  requireDavAuth,
  getDavAuth,
  hashPassword,
  verifyPassword,
  generateAppPassword,
  type DavAuthResult,
} from './auth.js';

export { handlePropfind } from './handlers/propfind.js';
export { handleProppatch } from './handlers/proppatch.js';
export { handleGet } from './handlers/get.js';
export { handlePut } from './handlers/put.js';
export { handleDelete } from './handlers/delete.js';
export { handleReport } from './handlers/report.js';
export { handleMkcalendar } from './handlers/mkcalendar.js';
export { handleMkcol } from './handlers/mkcol.js';
export { handleCopy } from './handlers/copy.js';
export { handleMove } from './handlers/move.js';

export { parseICS, generateICS, type ICSEvent, type ICSAttendee } from './utils/ics.js';

export {
  buildMultistatus,
  buildError,
  parseRequestedProperties,
  parseSyncCollection,
  parseCalendarQuery,
  parseCalendarMultiget,
  detectReportType,
  type MultistatusItem,
  type Propstat,
  type PropValue,
} from './utils/xml.js';
