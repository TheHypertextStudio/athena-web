/**
 * `@docket/api` — the hand-rolled RFC 6455 server: the `VoiceWebSocket` connection state machine
 * and the `acceptUpgrade` handshake.
 *
 * @remarks
 * The frame codec (`encodeFrame`/`decodeFrame`/`acceptKey`) is exercised exhaustively in
 * `tests/routes/voice-telephony-protocol.test.ts`. This file covers what sits on top of the
 * codec: fragment reassembly, ping/pong, close-code negotiation, and the upgrade handshake — all
 * driven through a fake `Duplex` so no real socket or port is involved.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  acceptKey,
  acceptUpgrade,
  decodeFrame,
  encodeFrame,
  MAX_MESSAGE_BYTES,
  VoiceWebSocket,
} from '../../src/routes/voice-websocket';

/** Opcodes, mirrored from the private constants in the module under test. */
const OP_CONTINUATION = 0x0;
const OP_TEXT = 0x1;
const OP_BINARY = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/**
 * A fake `Duplex` exposing only the surface `VoiceWebSocket`/`acceptUpgrade` touch: `on` (via
 * `EventEmitter`), `write`, `end`, `destroy`, and an optional `setNoDelay`.
 */
class FakeSocket extends EventEmitter {
  readonly written: Buffer[] = [];
  ended = false;
  destroyed = false;
  noDelay: boolean | undefined;

  write(chunk: Buffer | string): boolean {
    this.written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    this.destroyed = true;
  }

  setNoDelay(flag: boolean): void {
    this.noDelay = flag;
  }
}

/** A fake `Duplex` that never advertises `setNoDelay`, the way a bare `net.Socket` mock might. */
class BareSocket extends EventEmitter {
  readonly written: Buffer[] = [];
  ended = false;
  destroyed = false;

  write(chunk: Buffer | string): boolean {
    this.written.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  }

  end(): void {
    this.ended = true;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

/** Build a masked client-to-server frame with full control over FIN and opcode. */
function clientFrame(
  opcode: number,
  payload: Buffer,
  opts: { fin?: boolean; mask?: Buffer } = {},
): Buffer {
  const { fin = true, mask = Buffer.from([1, 2, 3, 4]) } = opts;
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
  header[0] = (fin ? 0x80 : 0x00) | opcode;
  header[1] |= 0x80;
  const masked = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    masked[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
  }
  return Buffer.concat([header, mask, masked]);
}

/** Spy handlers structurally matching the module's `SocketHandlers`, but typed with plain function
 * properties (not interface method-shorthand) so asserting on them isn't flagged as an
 * unbound-method access. */
interface MockHandlers {
  onMessage: Mock<(text: string) => void>;
  onClose: Mock<(code: number) => void>;
}

/** Wire up a `VoiceWebSocket` over a `FakeSocket` with spy handlers. */
function connect(): { socket: FakeSocket; connection: VoiceWebSocket; handlers: MockHandlers } {
  const socket = new FakeSocket();
  const handlers: MockHandlers = { onMessage: vi.fn(), onClose: vi.fn() };
  const connection = new VoiceWebSocket(socket as unknown as Duplex, handlers);
  return { socket, connection, handlers };
}

describe('decodeFrame partial reads of the extended length field', () => {
  it('waits for more bytes when a 16-bit extended length is truncated', () => {
    // Length nibble 126 announces a 16-bit extended length, but only 1 of the 2 length bytes
    // (and none of the mask/payload) have arrived yet.
    const header = Buffer.from([0x81, 0x80 | 126, 0x00]);
    expect(decodeFrame(header)).toBeNull();
  });

  it('waits for more bytes when a 64-bit extended length is truncated', () => {
    // Length nibble 127 announces a 64-bit extended length, but only 3 of the 8 length bytes
    // have arrived yet.
    const header = Buffer.from([0x81, 0x80 | 127, 0x00, 0x00, 0x00]);
    expect(decodeFrame(header)).toBeNull();
  });
});

describe('VoiceWebSocket message assembly', () => {
  it('delivers a single unfragmented text message to onMessage', () => {
    const { socket, handlers } = connect();
    socket.emit('data', clientFrame(OP_TEXT, Buffer.from('hello athena', 'utf8')));
    expect(handlers.onMessage).toHaveBeenCalledWith('hello athena');
  });

  it('reassembles a message split across a TEXT frame and a CONTINUATION frame', () => {
    const { socket, handlers } = connect();
    socket.emit('data', clientFrame(OP_TEXT, Buffer.from('hello ', 'utf8'), { fin: false }));
    expect(handlers.onMessage).not.toHaveBeenCalled();
    socket.emit('data', clientFrame(OP_CONTINUATION, Buffer.from('world', 'utf8')));
    expect(handlers.onMessage).toHaveBeenCalledWith('hello world');
    expect(handlers.onMessage).toHaveBeenCalledTimes(1);
  });

  it('processes multiple frames delivered in a single data chunk', () => {
    const { socket, handlers } = connect();
    const chunk = Buffer.concat([
      clientFrame(OP_TEXT, Buffer.from('one', 'utf8')),
      clientFrame(OP_TEXT, Buffer.from('two', 'utf8')),
    ]);
    socket.emit('data', chunk);
    expect(handlers.onMessage).toHaveBeenNthCalledWith(1, 'one');
    expect(handlers.onMessage).toHaveBeenNthCalledWith(2, 'two');
  });

  it('drops a continuation frame that arrives without a leading TEXT frame', () => {
    const { socket, handlers } = connect();
    // A bare CONTINUATION as the first frame never set fragmentOpcode to TEXT, so the
    // reassembled bytes are discarded rather than handed to onMessage.
    socket.emit('data', clientFrame(OP_CONTINUATION, Buffer.from('orphan', 'utf8')));
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });

  it('closes with 1009 when fragments accumulate past MAX_MESSAGE_BYTES', () => {
    const { socket, handlers } = connect();
    const half = Buffer.alloc(Math.ceil(MAX_MESSAGE_BYTES / 2) + 10, 0x61);
    socket.emit('data', clientFrame(OP_TEXT, half, { fin: false }));
    expect(handlers.onMessage).not.toHaveBeenCalled();
    socket.emit('data', clientFrame(OP_CONTINUATION, half));
    expect(handlers.onClose).toHaveBeenCalledWith(1009);
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });

  it('starting a new TEXT frame resets any fragments buffered from a prior message', () => {
    const { socket, handlers } = connect();
    socket.emit('data', clientFrame(OP_TEXT, Buffer.from('stale', 'utf8'), { fin: false }));
    // A fresh TEXT frame (not a CONTINUATION) discards the unfinished 'stale' fragment.
    socket.emit('data', clientFrame(OP_TEXT, Buffer.from('fresh', 'utf8')));
    expect(handlers.onMessage).toHaveBeenCalledTimes(1);
    expect(handlers.onMessage).toHaveBeenCalledWith('fresh');
  });
});

describe('VoiceWebSocket control frames', () => {
  it('answers a PING with a PONG carrying the same payload', () => {
    const { socket } = connect();
    const payload = Buffer.from('ping-payload', 'utf8');
    socket.emit('data', clientFrame(OP_PING, payload));
    expect(socket.written).toHaveLength(1);
    expect(socket.written[0]).toEqual(encodeFrame(OP_PONG, payload));
  });

  it('ignores an incoming PONG frame', () => {
    const { socket, handlers } = connect();
    socket.emit('data', clientFrame(OP_PONG, Buffer.from('pong-payload', 'utf8')));
    expect(socket.written).toHaveLength(0);
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it('normalizes a close frame with no payload (code 1005) to 1000', () => {
    const { socket, handlers } = connect();
    socket.emit('data', clientFrame(OP_CLOSE, Buffer.alloc(0)));
    expect(handlers.onClose).toHaveBeenCalledWith(1000);
    expect(socket.ended).toBe(true);
  });

  it('preserves an explicit close code that is not 1005', () => {
    const { socket, handlers } = connect();
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(4001, 0);
    socket.emit('data', clientFrame(OP_CLOSE, payload));
    expect(handlers.onClose).toHaveBeenCalledWith(4001);
  });

  it('closes a binary frame with 1003 instead of buffering it', () => {
    const { socket, handlers } = connect();
    socket.emit('data', clientFrame(OP_BINARY, Buffer.from([1, 2, 3])));
    expect(handlers.onClose).toHaveBeenCalledWith(1003);
  });

  it('closes an unrecognized opcode with 1002', () => {
    const { socket, handlers } = connect();
    // 0x3 is a reserved, unassigned non-control opcode: nothing in the switch handles it.
    socket.emit('data', clientFrame(0x3, Buffer.from('x', 'utf8')));
    expect(handlers.onClose).toHaveBeenCalledWith(1002);
  });

  it('closes the connection when decodeFrame reports a protocol error', () => {
    const { socket, handlers } = connect();
    // An unmasked frame from a client is a protocol violation decodeFrame flags as 1002.
    const unmasked = encodeFrame(OP_TEXT, Buffer.from('unmasked', 'utf8'));
    socket.emit('data', unmasked);
    expect(handlers.onClose).toHaveBeenCalledWith(1002);
  });

  it('stops processing the buffer once the connection has closed mid-loop', () => {
    const { socket, handlers } = connect();
    // A BINARY frame (closes with 1003) followed by a TEXT frame in the same chunk: the second
    // frame must never reach onMessage because the ingest loop bails out after closing.
    const chunk = Buffer.concat([
      clientFrame(OP_BINARY, Buffer.from([9])),
      clientFrame(OP_TEXT, Buffer.from('too-late', 'utf8')),
    ]);
    socket.emit('data', chunk);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledWith(1003);
    expect(handlers.onMessage).not.toHaveBeenCalled();
  });
});

describe('VoiceWebSocket send/close lifecycle', () => {
  it('send() writes an unmasked text frame', () => {
    const { socket, connection } = connect();
    connection.send('hi there');
    expect(socket.written).toHaveLength(1);
    expect(socket.written[0]).toEqual(encodeFrame(OP_TEXT, Buffer.from('hi there', 'utf8')));
  });

  it('send() is a no-op once the connection is closed', () => {
    const { socket, connection } = connect();
    connection.close();
    const writesAfterClose = socket.written.length;
    connection.send('too late');
    expect(socket.written).toHaveLength(writesAfterClose);
  });

  it('close() writes a close frame, ends the socket, and reports the code once', () => {
    const { socket, connection, handlers } = connect();
    connection.close(4100);
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(4100, 0);
    expect(socket.written[socket.written.length - 1]).toEqual(encodeFrame(OP_CLOSE, payload));
    expect(socket.ended).toBe(true);
    expect(handlers.onClose).toHaveBeenCalledWith(4100);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('close() defaults to code 1000', () => {
    const { connection, handlers } = connect();
    connection.close();
    expect(handlers.onClose).toHaveBeenCalledWith(1000);
  });

  it('close() is idempotent: a second call neither writes again nor re-fires onClose', () => {
    const { socket, connection, handlers } = connect();
    connection.close(4200);
    const writeCountAfterFirstClose = socket.written.length;
    connection.close(4200);
    expect(socket.written).toHaveLength(writeCountAfterFirstClose);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('reports 1006 when the underlying socket emits close', () => {
    const { socket, handlers } = connect();
    socket.emit('close');
    expect(handlers.onClose).toHaveBeenCalledWith(1006);
  });

  it('reports 1006 when the underlying socket emits error', () => {
    const { socket, handlers } = connect();
    socket.emit('error', new Error('ECONNRESET'));
    expect(handlers.onClose).toHaveBeenCalledWith(1006);
  });

  it('a close initiated locally suppresses a later socket close event', () => {
    const { socket, connection, handlers } = connect();
    connection.close(1000);
    socket.emit('close');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('accepts a handlers factory that receives the connection being created', () => {
    const socket = new FakeSocket();
    const onMessage = vi.fn();
    let received: VoiceWebSocket | null = null;
    const connection = new VoiceWebSocket(socket as unknown as Duplex, (conn) => {
      received = conn;
      return { onMessage, onClose: vi.fn() };
    });
    expect(received).toBe(connection);
    socket.emit('data', clientFrame(OP_TEXT, Buffer.from('via-factory', 'utf8')));
    expect(onMessage).toHaveBeenCalledWith('via-factory');
  });
});

describe('acceptUpgrade', () => {
  const validKey = 'dGhlIHNhbXBsZSBub25jZQ==';

  function upgradeRequest(headers: Record<string, string | undefined>): IncomingMessage {
    return { headers } as unknown as IncomingMessage;
  }

  it('rejects an upgrade missing the Sec-WebSocket-Key header', () => {
    const socket = new FakeSocket();
    const result = acceptUpgrade(
      upgradeRequest({ 'sec-websocket-version': '13' }),
      socket as unknown as Duplex,
      () => ({ onMessage: vi.fn(), onClose: vi.fn() }),
    );
    expect(result).toBeNull();
    expect(socket.written[0]?.toString('utf8')).toContain('400 Bad Request');
    expect(socket.destroyed).toBe(true);
  });

  it('rejects an upgrade with a version other than 13', () => {
    const socket = new FakeSocket();
    const result = acceptUpgrade(
      upgradeRequest({ 'sec-websocket-key': validKey, 'sec-websocket-version': '8' }),
      socket as unknown as Duplex,
      () => ({ onMessage: vi.fn(), onClose: vi.fn() }),
    );
    expect(result).toBeNull();
    expect(socket.written[0]?.toString('utf8')).toContain('400 Bad Request');
    expect(socket.destroyed).toBe(true);
  });

  it('completes the handshake and returns a live VoiceWebSocket on a valid upgrade', () => {
    const socket = new FakeSocket();
    const result = acceptUpgrade(
      upgradeRequest({ 'sec-websocket-key': validKey, 'sec-websocket-version': '13' }),
      socket as unknown as Duplex,
      () => ({ onMessage: vi.fn(), onClose: vi.fn() }),
    );
    expect(result).toBeInstanceOf(VoiceWebSocket);
    const response = socket.written[0]?.toString('utf8') ?? '';
    expect(response).toContain('HTTP/1.1 101 Switching Protocols');
    expect(response).toContain(`Sec-WebSocket-Accept: ${acceptKey(validKey)}`);
  });

  it('enables TCP_NODELAY when the socket supports setNoDelay', () => {
    const socket = new FakeSocket();
    acceptUpgrade(
      upgradeRequest({ 'sec-websocket-key': validKey, 'sec-websocket-version': '13' }),
      socket as unknown as Duplex,
      () => ({ onMessage: vi.fn(), onClose: vi.fn() }),
    );
    expect(socket.noDelay).toBe(true);
  });

  it('skips setNoDelay when the socket does not expose it', () => {
    const socket = new BareSocket();
    const result = acceptUpgrade(
      upgradeRequest({ 'sec-websocket-key': validKey, 'sec-websocket-version': '13' }),
      socket as unknown as Duplex,
      () => ({ onMessage: vi.fn(), onClose: vi.fn() }),
    );
    expect(result).toBeInstanceOf(VoiceWebSocket);
    expect(socket.written[0]?.toString('utf8')).toContain('101 Switching Protocols');
  });
});
