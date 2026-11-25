export type Failure = { ok: false; command: string; message: string; next: string }
export type Source<T> = { ok: true; value: T } | Failure
