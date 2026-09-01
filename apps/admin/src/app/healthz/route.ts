/**
 * `GET /healthz` — liveness for the operator console itself.
 *
 * @remarks
 * The console probes every deployed service on a schedule, and that has to include the console: a
 * dead admin app is exactly the failure nobody is watching, because the screen that would report it
 * is the one that is down.
 *
 * Deliberately shallow. This app owns no data and reads everything through the API, so a check here
 * that reached the database would report the API's health under the console's name and make one
 * failure look like two.
 */
export const dynamic = 'force-dynamic';

/**
 * Report that this deployment is running.
 *
 * @returns a JSON liveness document.
 */
export function GET(): Response {
  return Response.json({ status: 'ok', service: 'docket-admin' });
}
