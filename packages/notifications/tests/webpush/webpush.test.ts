/**
 * Web Push contract tests.
 *
 * @remarks
 * The encryption is verified by *decrypting* — a subscription's private key is generated in the
 * test, the payload is encrypted for its public key, and the ciphertext is unwrapped back to the
 * original bytes following RFC 8291 independently of the encoder. A test that only asserted on the
 * encoder's own output would pass for any self-consistent but wrong implementation.
 */
import {
  createDecipheriv,
  createECDH,
  createVerify,
  hkdfSync,
  randomBytes,
  createPublicKey,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  CaptureWebPushSender,
  WEB_PUSH_MAX_ACTIONS,
  WebPushMessage,
  WebPushSendError,
  WebPushSubscription,
  decodeElicitationAnswerAction,
  elicitationPushActions,
  elicitationPushMessage,
} from '../../src/webpush';
import {
  VapidWebPushSender,
  encryptWebPushPayload,
  vapidAuthorization,
  vapidKeysFromEnv,
  vapidPublicKeyFor,
  type VapidKeys,
} from '../../src/webpush/node';

/** Mint a browser-shaped subscription plus the private key needed to decrypt for it. */
function makeSubscription(endpoint = 'https://push.example/ep/1'): {
  subscription: WebPushSubscription;
  privateKey: Buffer;
  authSecret: Buffer;
} {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    subscription: WebPushSubscription.parse({
      endpoint,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: authSecret.toString('base64url'),
      },
    }),
    privateKey: ecdh.getPrivateKey(),
    authSecret,
  };
}

/** Decrypt an `aes128gcm` Web Push body the way a user agent would. */
function decrypt(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const uaPublic = ecdh.getPublicKey();
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const key = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16),
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12),
  );
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // Strip the RFC 8188 last-record delimiter.
  expect(plaintext[plaintext.length - 1]).toBe(0x02);
  return plaintext.subarray(0, plaintext.length - 1);
}

/** A real VAPID identity, generated per run so no key material is committed. */
function makeVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey().toString('base64url');
  return {
    privateKey,
    publicKey: vapidPublicKeyFor(privateKey),
    subject: 'mailto:ops@example.com',
  };
}

describe('RFC 8291 payload encryption', () => {
  it('round-trips a payload the receiving browser can decrypt', () => {
    const { subscription, privateKey, authSecret } = makeSubscription();
    const payload = Buffer.from(JSON.stringify({ title: 'Send the update?' }), 'utf8');

    const body = encryptWebPushPayload(subscription, payload);

    expect(decrypt(body, privateKey, authSecret).toString('utf8')).toBe(payload.toString('utf8'));
  });

  it('emits the aes128gcm header layout the content-encoding requires', () => {
    const { subscription } = makeSubscription();

    const body = encryptWebPushPayload(subscription, Buffer.from('x'), Buffer.alloc(16, 7));

    expect(body.subarray(0, 16).equals(Buffer.alloc(16, 7))).toBe(true);
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
  });

  it('produces different ciphertext for the same payload on every send', () => {
    const { subscription } = makeSubscription();
    const payload = Buffer.from('same');

    const first = encryptWebPushPayload(subscription, payload);
    const second = encryptWebPushPayload(subscription, payload);

    expect(first.equals(second)).toBe(false);
  });

  it('refuses a subscription whose keys are not the right size', () => {
    const { subscription } = makeSubscription();
    const broken = { ...subscription, keys: { ...subscription.keys, p256dh: 'AAAA' } };

    expect(() => encryptWebPushPayload(broken, Buffer.from('x'))).toThrow(WebPushSendError);
  });
});

describe('RFC 8292 VAPID authorization', () => {
  it('signs an assertion the push service can verify with the advertised public key', () => {
    const keys = makeVapidKeys();

    const header = vapidAuthorization(keys, 'https://push.example', 1_000_000);

    const token = /vapid t=([^,]+), k=(.+)/.exec(header);
    expect(token).not.toBeNull();
    const [, jwt, advertised] = token!;
    expect(advertised).toBe(keys.publicKey);
    const [headerPart, claimsPart, signaturePart] = jwt!.split('.');
    const claims = JSON.parse(Buffer.from(claimsPart!, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(claims['aud']).toBe('https://push.example');
    expect(claims['sub']).toBe('mailto:ops@example.com');
    expect(claims['exp']).toBe(1_000_000 + 12 * 60 * 60);

    // Verify with a public key rebuilt from the advertised point alone — i.e. exactly what a push
    // service has available.
    const spki = Buffer.concat([
      Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex'),
      Buffer.from(keys.publicKey, 'base64url'),
    ]);
    const verifier = createVerify('sha256');
    verifier.update(Buffer.from(`${headerPart}.${claimsPart}`, 'utf8'));
    expect(
      verifier.verify(
        {
          key: createPublicKey({ key: spki, format: 'der', type: 'spki' }),
          dsaEncoding: 'ieee-p1363',
        },
        Buffer.from(signaturePart!, 'base64url'),
      ),
    ).toBe(true);
  });

  it('reads a complete identity out of env and rejects a mismatched pair', () => {
    const keys = makeVapidKeys();
    const other = makeVapidKeys();

    expect(
      vapidKeysFromEnv({
        WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
        WEB_PUSH_VAPID_SUBJECT: keys.subject,
      }),
    ).toEqual(keys);
    expect(
      vapidKeysFromEnv({
        WEB_PUSH_VAPID_PUBLIC_KEY: other.publicKey,
        WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
        WEB_PUSH_VAPID_SUBJECT: keys.subject,
      }),
    ).toBeNull();
    expect(vapidKeysFromEnv({ WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey })).toBeNull();
  });
});

describe('VapidWebPushSender', () => {
  const message = WebPushMessage.parse({
    title: 'Post the sprint update to the Acme channel',
    tag: 'elicitation:e1',
    url: '/athena',
  });

  it('posts an encrypted body with the spec headers', async () => {
    const { subscription } = makeSubscription();
    const calls: { url: string; headers: Record<string, string>; body: Buffer }[] = [];
    const sender = new VapidWebPushSender(makeVapidKeys(), async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { status: 201, ok: true };
    });

    const sent = await sender.send(subscription, message);

    expect(sent.status).toBe(201);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(subscription.endpoint);
    expect(call.headers['Content-Encoding']).toBe('aes128gcm');
    expect(call.headers['Authorization']).toMatch(/^vapid t=/);
    expect(call.headers['TTL']).toBe('3600');
    expect(call.body.length).toBeGreaterThan(86);
  });

  it('reports a 410 as a gone subscription so the caller can prune it', async () => {
    const { subscription } = makeSubscription();
    const sender = new VapidWebPushSender(makeVapidKeys(), async () => ({
      status: 410,
      ok: false,
    }));

    await expect(sender.send(subscription, message)).rejects.toMatchObject({ code: 'gone' });
  });

  it('reports any other refusal as a push-service failure with its status', async () => {
    const { subscription } = makeSubscription();
    const sender = new VapidWebPushSender(makeVapidKeys(), async () => ({
      status: 429,
      ok: false,
    }));

    await expect(sender.send(subscription, message)).rejects.toMatchObject({
      code: 'push_service',
      status: 429,
    });
  });
});

describe('elicitation notifications', () => {
  it('renders a confirmation as its own two labelled buttons', () => {
    const actions = elicitationPushActions({
      kind: 'confirm',
      confirmLabel: 'Post it',
      declineLabel: 'Hold off',
    });

    expect(actions.map((a) => a.title)).toEqual(['Post it', 'Hold off']);
    expect(decodeElicitationAnswerAction(actions[0]?.action ?? '')).toBe(true);
    expect(decodeElicitationAnswerAction(actions[1]?.action ?? '')).toBe(false);
  });

  it("renders a selection's options as buttons carrying their own values", () => {
    const actions = elicitationPushActions({
      kind: 'select',
      multiple: false,
      options: [
        { value: 'acme', label: 'Acme channel', description: null },
        { value: 'ops', label: 'Ops channel', description: null },
        { value: 'eng', label: 'Eng channel', description: null },
      ],
    });

    expect(actions).toHaveLength(WEB_PUSH_MAX_ACTIONS);
    expect(actions.map((a) => a.title)).toEqual(['Acme channel', 'Ops channel']);
    expect(decodeElicitationAnswerAction(actions[0]?.action ?? '')).toBe('acme');
  });

  it('offers no buttons for an answer that cannot be given by tapping', () => {
    expect(
      elicitationPushActions({
        kind: 'text',
        multiline: false,
        minLength: null,
        maxLength: null,
        placeholder: null,
      }),
    ).toEqual([]);
    expect(
      elicitationPushActions({
        kind: 'form',
        fields: [
          {
            key: 'a',
            label: 'A',
            description: null,
            required: true,
            control: {
              kind: 'text',
              multiline: false,
              minLength: null,
              maxLength: null,
              placeholder: null,
            },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('titles the notification with the action being authorized, not the bare question', () => {
    const message = elicitationPushMessage({
      elicitationId: 'elc_1',
      actionSummary: 'Post the sprint update to the Acme project channel',
      question: 'Should I post it now?',
      spec: { kind: 'confirm', confirmLabel: 'Post it', declineLabel: 'Hold' },
      taskTitle: 'Weekly sprint update',
      url: '/athena?elicitation=elc_1',
      expiresAt: '2026-08-02T18:00:00.000Z',
    });

    expect(message.title).toBe('Post the sprint update to the Acme project channel');
    expect(message.body).toContain('Should I post it now?');
    expect(message.tag).toBe('elicitation:elc_1');
    expect(message.requireInteraction).toBe(true);
    expect(message.data['elicitationId']).toBe('elc_1');
    expect(message.data['answerable']).toBe(true);
    expect(WebPushMessage.parse(message)).toEqual(message);
  });

  it('ignores an action id that is not an encoded answer', () => {
    expect(decodeElicitationAnswerAction('open')).toBeUndefined();
    expect(decodeElicitationAnswerAction('answer:{oops')).toBeUndefined();
  });
});

describe('CaptureWebPushSender', () => {
  it('captures every message and can simulate an expired subscription', async () => {
    const { subscription } = makeSubscription();
    const sender = new CaptureWebPushSender(new Set([subscription.endpoint]));

    await expect(
      sender.send(subscription, WebPushMessage.parse({ title: 't', tag: 'x', url: '/athena' })),
    ).rejects.toMatchObject({ code: 'gone' });

    const live = makeSubscription('https://push.example/ep/2');
    await sender.send(live.subscription, WebPushMessage.parse({ title: 't', tag: 'x', url: '/a' }));
    expect(sender.outbox).toHaveLength(1);
    expect(sender.last()?.title).toBe('t');
  });
});
