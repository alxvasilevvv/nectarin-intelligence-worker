// Minimal ambient declaration for the subset of `node:async_hooks` we use.
// The runtime provides this module at execution time: Cloudflare Workers via the
// `nodejs_compat` flag (wrangler.toml), and Node.js natively under vitest. We do
// NOT add `@types/node` to `types` to avoid clobbering @cloudflare/workers-types'
// global definitions (fetch/Request/Response/etc.).
declare module "node:async_hooks" {
  export class AsyncLocalStorage<T> {
    run<R>(store: T, callback: () => R): R;
    getStore(): T | undefined;
  }
}
