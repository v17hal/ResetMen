/**
 * `@reset/types` — the API contract.
 *
 * Every schema here validates a request on the server *and* the corresponding form in the
 * web and admin apps. There is one definition, so a field cannot drift between what the
 * server expects and what a client sends.
 *
 * The Flutter app cannot import these (different language), so its models and its
 * `ErrorCode` enum are generated from the OpenAPI document that these schemas produce —
 * same source, different transport. See docs/02-platforms-and-stack.md §2.7.
 */
export * from './common.js';
export * from './auth.js';
export * from './catalog.js';
export * from './capacity.js';
export * from './booking.js';
export * from './payment.js';
export * from './rewards.js';
export * from './products.js';
export * from './notifications.js';
export * from './admin.js';
