import { DurableObject } from 'cloudflare:workers';

const CONTAINER_PORT = 8080;
const STARTUP_ATTEMPTS = 25;
const STARTUP_DELAY_MS = 400;

function collectContainerEnv(env) {
  const out = {
    NODE_ENV: 'production',
    PORT: String(CONTAINER_PORT),
  };
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && value.length > 0) {
      out[key] = value;
    }
  }
  return out;
}

async function waitForContainerPort(port) {
  for (let attempt = 0; attempt < STARTUP_ATTEMPTS; attempt += 1) {
    try {
      const probe = await port.fetch(new Request('http://container/v1/health'));
      await probe.body?.cancel();
      if (probe.status > 0) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, STARTUP_DELAY_MS));
    }
  }
}

/** Durable Object managing the Node 24 Docket API container on Cloudflare Containers. */
export class DocketApiContainer extends DurableObject {
  readyPromise = undefined;

  async ensureRunning() {
    const container = this.ctx.container;
    if (!container) {
      throw new Error('Cloudflare Container binding is not attached to DocketApiContainer');
    }
    const port = container.getTcpPort(CONTAINER_PORT);
    if (!container.running) {
      this.readyPromise = (async () => {
        await container.start({
          enableInternet: true,
          env: collectContainerEnv(this.env),
        });
        await waitForContainerPort(port);
      })();
    }
    if (this.readyPromise) {
      try {
        await this.readyPromise;
      } catch (error) {
        this.readyPromise = undefined;
        throw error;
      }
    }
    return port;
  }

  /** Forward incoming HTTP traffic to the containerized Hono API server on port 8080. */
  async fetch(request) {
    const port = await this.ensureRunning();
    const incomingUrl = new URL(request.url);
    const targetUrl = new URL(request.url);
    targetUrl.protocol = 'http:';
    targetUrl.host = 'container';

    const headers = new Headers(request.headers);
    if (!headers.has('x-forwarded-host')) {
      headers.set('x-forwarded-host', incomingUrl.host);
    }
    if (!headers.has('x-forwarded-proto')) {
      headers.set('x-forwarded-proto', incomingUrl.protocol.slice(0, -1));
    }

    const forwarded = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
      redirect: 'manual',
    });
    return port.fetch(forwarded);
  }
}

/** Worker entrypoint routing production API traffic into the Docket API container. */
export default {
  async fetch(request, env) {
    const id = env.DOCKET_API_CONTAINER.idFromName('primary');
    const stub = env.DOCKET_API_CONTAINER.get(id);
    return stub.fetch(request);
  },
};
