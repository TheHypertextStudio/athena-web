/** Storage contract retained from the maintained Turbo cache implementation. */
export interface StorageInterface {
  listWithMetadata: (options?: ListFilterOptions) => Promise<ListResultWithMetadata>;
  list: (options?: ListFilterOptions) => Promise<ListResult>;
  readWithMetadata: (
    key: string,
  ) => Promise<{ data: ReadableStream | undefined; metadata: Metadata | undefined }>;
  read: (key: string) => Promise<ReadableStream | undefined>;
  write: (key: string, data: WritableValue, metadata?: Record<string, string>) => Promise<void>;
  delete: (key: string | string[]) => Promise<void>;
}

/** Values that R2 can write without buffering the entire artifact. */
export type WritableValue = string | ReadableStream | ArrayBuffer;

/** R2 listing filters and pagination. */
export interface ListFilterOptions {
  limit?: number;
  cursor?: string | undefined;
  prefix?: string;
}

/** A page of artifact keys. */
export interface ListResult {
  keys: string[];
  cursor?: string | undefined;
  truncated: boolean;
}

/** A page of artifact keys. */
/** A page of artifact keys with retained signature metadata. */
export interface ListResultWithMetadata {
  keys: { key: string; metadata: Metadata | undefined }[];
  cursor?: string | undefined;
  truncated: boolean;
}

/** Object upload time and opaque client signature metadata. */
export interface Metadata {
  staticMetadata: {
    createdAt: Date;
  };
  customMetadata: Record<string, string>;
}
