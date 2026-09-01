/**
 * `GET /healthz` — liveness for the product web app.
 *
 * @remarks
 * The operator console probes every deployed service on a schedule and records the outcome. This
 * app had no route handler at all, so a probe could only ever measure whether *some* HTML came
 * back from the CDN — which stays true through a broken deployment.
 *
 * Deliberately shallow: this app owns no data and calls the API for everything, so a check here
 * that reached the database would report the API's health under the web app's name and make a
 * single failure look like two.
 */
export const dynamic = 'force-dynamic';

/**
 * Report that this deployment is running.
 *
 * @returns a JSON liveness document.
 */
export function GET(): Response {
  return Response.json({ status: 'ok', service: 'docket-web' });
}
