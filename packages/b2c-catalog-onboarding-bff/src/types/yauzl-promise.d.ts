declare module 'yauzl-promise' {
    import type { Readable } from 'node:stream';

    export class Entry {
        filename: string;
        compressedSize: number;
        uncompressedSize: number;
        openReadStream(): Promise<Readable>;
    }

    export class Zip implements AsyncIterable<Entry> {
        close(): Promise<void>;
        [Symbol.asyncIterator](): AsyncIterator<Entry>;
    }

    export function open(path: string): Promise<Zip>;
    export function fromBuffer(buf: Buffer): Promise<Zip>;
}
