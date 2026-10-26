/** Immutable transfer declaration checked again before application publication. */
export interface TransferOptions {
  readonly byteSize: number;
  readonly crc32c: string;
  readonly contentType: string;
}
/** Provider-owned completed object metadata. */
export interface BlobMetadata {
  readonly byteSize: number;
  readonly crc32c: string;
  readonly generation: string;
}
/** Acknowledged transfer position, never inferred from bytes sent by a client. */
export interface TransferProgress {
  readonly offset: number;
  readonly complete: boolean;
}
/** One inclusive byte range. */
export interface BlobRange {
  readonly start: number;
  readonly end: number;
}
/** Bounded transfer and reading operations shared by all attachment destinations. */
export interface BlobTransfer {
  /** Create an immutable object upload. Null selects the local application capability transport. */
  begin(key: string, options: TransferOptions): Promise<string | null>;
  /** Probe actual durable acknowledgement; uri is a sensitive provider capability. */
  status(key: string, options: TransferOptions, uri: string | null): Promise<TransferProgress>;
  /** Retire the capability before deleting any unaccepted bytes. */
  cancel(key: string, uri: string | null): Promise<void>;
  /** Inspect a completed object without reading it into memory. */
  stat(key: string): Promise<BlobMetadata | null>;
  /** Open a bounded-memory read, optionally limited to one inclusive range. */
  stream(key: string, range?: BlobRange): Promise<ReadableStream<Uint8Array>>;
  /** Create an independent destination-owned copy without application buffering. */
  copy(source: string, destination: string, contentType: string): Promise<void>;
  /** Accept a bounded local-provider chunk; absent on direct-to-provider deployments. */
  append?(
    key: string,
    options: TransferOptions,
    offset: number,
    bytes: Uint8Array,
  ): Promise<TransferProgress>;
}
