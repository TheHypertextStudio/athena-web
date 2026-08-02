/**
 * `@docket/api` — a minimal RFC 6455 server for the one socket Docket must accept.
 *
 * @remarks
 * ## Why this is hand-written rather than a dependency
 *
 * Docket has exactly one inbound WebSocket: Twilio ConversationRelay, which requires a `wss://`
 * endpoint and speaks small JSON text frames over it. That workload uses a narrow slice of the
 * protocol — text frames, continuation frames, ping/pong, close — and the slice is small enough
 * to implement correctly and test exhaustively, which the codec tests do. Weighed against adding
 * a socket library to the API's dependency surface for a single endpoint, the tested 200 lines
 * won.
 *
 * What is deliberately **not** supported, so nobody discovers it the hard way:
 * `permessage-deflate` (never negotiated — we do not advertise it, and a client that sends the
 * `rsv1` bit is closed), binary frames (ConversationRelay sends none; a binary frame is closed
 * with 1003), and fragmentation of control frames (forbidden by the spec anyway).
 *
 * ## The invariants that matter
 *
 * - Client-to-server frames **must** be masked (RFC 6455 §5.1). An unmasked one is a protocol
 *   violation and the connection is closed with 1002 rather than parsed, because an unmasked
 *   client frame is the signature of a proxy-poisoning attempt, not a bug.
 * - Server-to-client frames are **never** masked.
 * - A payload longer than {@link MAX_MESSAGE_BYTES} is refused with 1009 instead of being
 *   buffered, so a hostile length header cannot turn into memory pressure.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/** The GUID RFC 6455 §1.3 mandates in the handshake accept value. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** Largest message this server will assemble. ConversationRelay messages are a few kilobytes. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

/** Opcodes this server understands. */
const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Compute the `Sec-WebSocket-Accept` value for a client's `Sec-WebSocket-Key`. */
export function acceptKey(key: string): string {
  return createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

/**
 * Encode one server-to-client frame.
 *
 * @remarks
 * Unmasked, always FIN. Exported so the codec can be tested against the decoder without a socket.
 *
 * @param opcode - The frame opcode.
 * @param payload - The frame payload.
 */
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  let header: Buffer;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

/** One decoded frame. */
export interface DecodedFrame {
  readonly fin: boolean;
  readonly opcode: number;
  readonly payload: Buffer;
  /** Total bytes consumed from the buffer. */
  readonly size: number;
}

/** Why a frame stream was rejected, as a WebSocket close code. */
export type FrameError = 1002 | 1003 | 1009;

/**
 * Decode the first complete frame in `buffer`.
 *
 * @remarks
 * Returns `null` when the buffer does not yet hold a whole frame — the caller keeps reading. A
 * number is a fatal protocol error and the connection must be closed with that code.
 *
 * @param buffer - Bytes received so far.
 */
export function decodeFrame(buffer: Buffer): DecodedFrame | null | FrameError {
  if (buffer.length < 2) return null;
  const first = buffer[0] ?? 0;
  const second = buffer[1] ?? 0;
  // rsv1/2/3 must be zero: we never negotiate an extension that would set them.
  if ((first & 0x70) !== 0) return 1002;
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  if (!masked) return 1002;

  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(MAX_MESSAGE_BYTES)) return 1009;
    length = Number(big);
    offset += 8;
  }
  if (length > MAX_MESSAGE_BYTES) return 1009;
  if (buffer.length < offset + 4 + length) return null;

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 1) {
    payload[i] = (buffer[offset + i] ?? 0) ^ (mask[i % 4] ?? 0);
  }
  return { fin, opcode, payload, size: offset + length };
}

/** Callbacks a socket owner supplies. */
export interface SocketHandlers {
  /** One complete text message arrived. */
  onMessage(text: string): void | Promise<void>;
  /** The socket closed, for any reason. */
  onClose(code: number): void | Promise<void>;
}

/**
 * A live WebSocket connection.
 *
 * @remarks
 * Owns the frame state machine for one socket: reassembling fragmented text messages, answering
 * pings, and closing cleanly. Nothing about voice or telephony lives here.
 */
export class VoiceWebSocket {
  private buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOpcode = 0;
  private closed = false;

  private readonly handlers: SocketHandlers;

  constructor(
    private readonly socket: Duplex,
    handlers: SocketHandlers | ((connection: VoiceWebSocket) => SocketHandlers),
  ) {
    this.handlers = typeof handlers === 'function' ? handlers(this) : handlers;
    socket.on('data', (chunk: Buffer) => {
      this.ingest(chunk);
    });
    socket.on('close', () => {
      this.finish(1006);
    });
    socket.on('error', () => {
      this.finish(1006);
    });
  }

  /** Send one text message. */
  send(text: string): void {
    if (this.closed) return;
    this.socket.write(encodeFrame(OP_TEXT, Buffer.from(text, 'utf8')));
  }

  /** Close the connection with a status code. */
  close(code = 1000): void {
    if (this.closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code, 0);
    this.socket.write(encodeFrame(OP_CLOSE, payload));
    this.socket.end();
    this.finish(code);
  }

  private ingest(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = decodeFrame(this.buffer);
      if (frame === null) return;
      if (typeof frame === 'number') {
        this.close(frame);
        return;
      }
      this.buffer = this.buffer.subarray(frame.size);
      this.handleFrame(frame);
      if (this.closed) return;
    }
  }

  private handleFrame(frame: DecodedFrame): void {
    switch (frame.opcode) {
      case OP_PING:
        this.socket.write(encodeFrame(OP_PONG, frame.payload));
        return;
      case OP_PONG:
        return;
      case OP_CLOSE: {
        const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1005;
        this.close(code === 1005 ? 1000 : code);
        return;
      }
      case OP_BINARY:
        // Nothing in this protocol sends binary. Refusing is honest; silently dropping it would
        // look like a hang to whoever sent it.
        this.close(1003);
        return;
      case OP_TEXT:
      case OP_CONTINUATION: {
        if (frame.opcode === OP_TEXT) {
          this.fragments = [];
          this.fragmentOpcode = OP_TEXT;
        }
        this.fragments.push(frame.payload);
        const total = this.fragments.reduce((sum, part) => sum + part.length, 0);
        if (total > MAX_MESSAGE_BYTES) {
          this.close(1009);
          return;
        }
        if (!frame.fin) return;
        const text = Buffer.concat(this.fragments).toString('utf8');
        this.fragments = [];
        if (this.fragmentOpcode !== OP_TEXT) return;
        void this.handlers.onMessage(text);
        return;
      }
      default:
        this.close(1002);
    }
  }

  private finish(code: number): void {
    if (this.closed) return;
    this.closed = true;
    void this.handlers.onClose(code);
  }
}

/**
 * Complete the HTTP upgrade handshake and return the live socket.
 *
 * @remarks
 * Returns `null` — after writing a `400` and destroying the socket — for anything that is not a
 * well-formed version-13 WebSocket upgrade. There is no fallback path: a request that reaches
 * this function and is not a WebSocket upgrade is a misconfiguration, not a browser.
 *
 * Handlers are supplied as a factory because they almost always need to talk back on the same
 * socket, and a factory is how that circularity is expressed without a mutable placeholder.
 *
 * @param request - The upgrade request.
 * @param socket - The raw socket.
 * @param handlers - Builds the message/close callbacks for the connection being created.
 */
export function acceptUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  handlers: (connection: VoiceWebSocket) => SocketHandlers,
): VoiceWebSocket | null {
  const key = request.headers['sec-websocket-key'];
  const version = request.headers['sec-websocket-version'];
  if (typeof key !== 'string' || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '',
      '',
    ].join('\r\n'),
  );
  // Nagle's algorithm delays the small frames this protocol is made of; disabling it is the
  // difference between conversational and sluggish. Guarded because `Duplex` does not promise it.
  if ('setNoDelay' in socket && typeof socket.setNoDelay === 'function') {
    (socket as { setNoDelay: (flag: boolean) => void }).setNoDelay(true);
  }
  return new VoiceWebSocket(socket, handlers);
}
