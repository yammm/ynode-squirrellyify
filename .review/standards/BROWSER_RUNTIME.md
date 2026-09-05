# Browser Runtime Standards

## Scope

Apply this profile to JavaScript or WebAssembly executing in a browser, including documents, embedded contexts, dedicated and shared workers, service workers, browser-side data stores, and progressive web application behavior.

Use it with `CODING_STANDARDS.md` and `JAVASCRIPT.md`. Add `TYPESCRIPT.md` for TypeScript, `HTML.md` for document semantics and native interaction, `CSS.md` for presentation, and `HTTP_API.md` for the server's HTTP contract. This profile owns browser API behavior, lifecycle, cross-context communication, client storage, browser security boundaries, and resource cleanup.

The repository's supported browser and device matrix, accessibility target, build pipeline, rendering model, framework lifecycle, privacy policy, and performance budgets remain authoritative. Do not turn a preference for a framework, state library, bundler, or component model into a finding.

## Browser and execution contract

- Name the supported browser engines, minimum versions, device classes, and embedded webviews rather than relying on “modern” or “evergreen” without a release and testing policy.
- Validate the shipped output, not only source syntax. Transpilation does not provide missing DOM APIs, CSS behavior, secure contexts, codecs, permissions, WebAssembly features, or correct polyfill semantics.
- Check each used feature's complete contract, including constructor, method, option, event, error, and edge behavior. Support for one surface does not prove support for every option or interoperable behavior.
- Prefer capability detection and a tested fallback. Use user-agent or platform detection only for a verified engine defect or product distinction that cannot be expressed through a reliable capability check.
- Account for secure-context, top-level-context, transient-activation, permission, policy, origin, isolation, and hardware requirements before claiming an API is available.
- Treat documents, iframes, workers, and other realms as distinct execution contexts. Globals, prototypes, constructors, event loops, storage access, and permissions can differ; cross-realm `instanceof` checks are often the wrong shape validation.
- Define the behavior when scripting, a module, a dynamic chunk, a polyfill, a third-party resource, or a permission is unavailable. Essential content and recovery must not depend on every enhancement succeeding.
- Test browser-version boundary changes and engine-specific behavior on the actual declared targets. A passing emulation mode is not evidence that a different engine or embedded webview behaves the same way.

## WebAssembly integration

- Declare the required WebAssembly core, JavaScript API, Web API, and proposal feature set for every supported browser; support for one feature does not imply support for another.
- Require an OK, CORS-readable response whose media-type essence is `application/wasm` for streaming compilation or instantiation. Distinguish fetch failures, `CompileError`, `LinkError`, `RuntimeError`, traps, and resource exhaustion.
- Treat imported host functions as capabilities. Expose only required imports, validate import and export contracts, and validate every pointer, offset, length, encoding, ownership, and lifetime crossing the JavaScript and linear- memory boundary.
- Bound module bytes, compilation, instantiation, memory and table growth, and host-callback work below engine limits. Reacquire fixed-length buffer views after memory growth unless an explicitly supported resizable-buffer contract is used. Gate shared memory and threads on the declared browser and cross- origin-isolation contract.

## Startup, modules, and document lifecycle

- Align initialization with actual script loading semantics, document readiness, module dependency evaluation, and server-rendering or hydration behavior. Do not assume source order controls `async`, module, or dynamically imported work.
- Make initialization and teardown idempotent when navigation, hot reload, partial rendering, custom-element callbacks, or component remounts can invoke them more than once.
- Give global listeners, observers, timers, channels, workers, and shared singletons one owner. Avoid per-component registration that accumulates on every mount or route transition.
- Account for asynchronous work completing after its document, component, request, or selected state is no longer current. Abort it or compare an explicit generation or identity before committing the result.
- Use `pagehide`, `pageshow`, and their persisted state where back/forward cache behavior matters. A restored page is not a fresh load, and a hidden page is not necessarily terminated.
- Do not depend on `unload` or `beforeunload` for essential persistence, cleanup, analytics, lock release, or correctness. Browsers may skip them, and handlers can interfere with back/forward caching.
- Treat visibility and lifecycle events as advisory. A page can be frozen, discarded, or terminated without a reliable final callback; save recoverable user state early and make server-side operations safe if the client disappears without notice.
- Keep initial, loading, hydrated, interactive, restored, offline, and failed states distinguishable. Do not attach duplicate behavior to server-rendered controls during hydration.

## DOM, events, and observers

- Use DOM APIs according to the node's owner document, connection state, and shadow boundary. Do not retain detached subtrees or stale node references after the owning view is destroyed.
- Understand capture, target, bubble, composed paths, cancellation, default actions, and shadow retargeting before changing event handling. A listener on an ancestor does not observe every non-bubbling or non-composed event.
- Register listeners with deliberate capture, passive, once, and abort behavior. Remove them with matching identity and capture semantics or bind them to a lifecycle `AbortSignal`.
- Use delegation only when target discovery, nested interactive content, shadow boundaries, and dynamically inserted nodes preserve the interaction contract.
- Do not make a listener passive when it must cancel the default action, and do not block scrolling or input with non-passive hot-path listeners without a measured need.
- Handle pointer, mouse, touch, keyboard, input, composition, and focus events according to the supported interaction modes. Do not treat key events as character input or ignore input-method composition.
- Disconnect `MutationObserver`, `ResizeObserver`, and `IntersectionObserver` instances when their owner ends. Guard observer callbacks against feedback loops, stale targets, unbounded queues, and layout work proportional to the entire document.
- Batch related DOM mutations and avoid interleaving layout reads and writes in a loop. Do not cache geometry across events that can change layout unless the invalidation contract is explicit.
- Keep DOM state, accessible state, and application state synchronized. If the framework owns rendering, direct DOM mutation must not create a second source of truth that the next render silently overwrites.

## Fetch, cancellation, and streams

- Treat `fetch()` fulfillment as receipt of an HTTP response, not proof of a successful status. Check status and the documented response contract before parsing or committing state.
- Distinguish network errors, aborts, opaque responses, HTTP errors, parse failures, validation failures, and application errors. Do not collapse them into an empty result or generic offline message.
- Propagate an `AbortSignal` from the owner through fetches, stream operations, waits, and downstream work. Define whether a replaced request is canceled, ignored as stale, or allowed to complete for caching.
- Recognize that aborting browser work does not prove the server canceled or rolled back the operation. Retried state changes still need the HTTP API's idempotency contract.
- Choose request mode, credentials, cache, redirect, referrer policy, integrity, priority, and keepalive behavior deliberately. Defaults can differ from the privacy, CORS, cache, or authentication contract.
- Parse the response according to its status and media type. Do not call JSON parsing unconditionally for empty, partial, redirected, HTML error, or differently negotiated responses.
- A request or response body is single-use once consumed or locked. Clone or tee only when both branches are owned and buffering a slow branch cannot grow without bound.
- When reading streams, honor backpressure, release reader locks, cancel unused bodies, bound accumulated content, and handle truncation or failure after partial delivery.
- Make concurrent-request policy explicit: all results, first winner, latest-wins, deduplication, or serialized updates. Completion order must not let a stale request overwrite newer state.
- Treat online and offline events as hints, not proof that a particular origin or dependency is reachable. Attempt the operation under a bounded recovery policy and present an honest state.
- Use `sendBeacon` or keepalive requests only within their payload, credential, lifecycle, and observability constraints. They are not a guaranteed durable delivery mechanism.

## URLs, navigation, and history

- Construct and inspect URLs with `URL` and `URLSearchParams` against an intentional base. Avoid string concatenation that mishandles encoding, delimiters, fragments, credentials, or origin comparison.
- Validate user-influenced schemes, origins, and destinations before navigation, resource loading, or dynamic import. Reject dangerous or unexpected schemes rather than assuming every string is an HTTP URL.
- Treat route paths, query fields, fragments, history state, and linkable view state as public browser contracts. Preserve reload, direct navigation, bookmarks, back/forward traversal, and server fallback behavior.
- Pair `pushState()` and `replaceState()` with correct `popstate` handling. History state must be structured-cloneable, bounded, versionable, and reconstructible when a browser restores only the URL.
- Do not push a new history entry for every transient state change. Conversely, do not replace an entry when users reasonably expect Back to undo the navigation.
- Restore title, focus context, scroll, and announced route state as required by the product and accessibility contract. Visual content replacement alone does not reproduce native document navigation.
- Treat fragment decoding, repeated query fields, empty values, plus signs, Unicode normalization, and parameter ordering according to the declared contract, not a handwritten parser.
- Prevent open redirects and reverse-tabnabbing. Give cross-origin windows a deliberate opener, referrer, and communication boundary.

## Cookies and browser storage

- Treat browser storage according to its storage key, local or session type, and best-effort or persistent mode. It remains quota-limited and user- clearable; best-effort storage may be evicted under pressure, while granted persistent storage is protected from automatic user-agent clearing. Access can be denied or partitioned in privacy and embedding contexts, so browser storage is not the sole durable source for irreplaceable data.
- Keep secrets and high-value bearer credentials out of script-readable storage. Encrypting data with code and a key delivered to the same client does not create a server-grade confidentiality boundary.
- Use `localStorage` and `sessionStorage` only for small synchronous values. Account for blocking access, quota errors, serialization, tab scope, and the fact that storage events notify other documents rather than the writer.
- Give stored data a schema version, owner, retention rule, migration, and deletion path. Tolerate data written by older code and partial cleanup after a failed deployment.
- Design IndexedDB upgrades for `upgradeneeded`, blocked upgrades, `versionchange`, transaction aborts, and tabs running different application versions. Close old connections so an upgrade cannot remain blocked forever.
- Keep IndexedDB transaction work within its active lifetime. Do not assume an arbitrary asynchronous gap preserves a transaction across browsers.
- Define multi-tab and multi-worker coordination for shared mutable state. Last-writer-wins local storage, a `BroadcastChannel` notification, or a UI disable flag is not an atomic lock.
- Account for structured-clone behavior, transfer, unsupported values, and object identity when writing IndexedDB or sending cross-context messages.
- Give cookies the server-defined scope and security attributes in `HTTP_API.md`. Client code must not assume it can read `HttpOnly` cookies or infer successful authentication from the presence of a non-HttpOnly value.
- Avoid synchronous cookie enumeration on hot paths. Cache only non-sensitive derived state whose invalidation remains correct across tabs and server changes.

## Workers, service workers, and caches

- Give each worker an owner, startup protocol, message schema, error path, cancellation strategy, and termination condition. Remove message listeners and close ports when the relationship ends.
- Validate messages across workers, windows, and ports as external inputs to the receiving context. Account for structured cloning, transferred objects, detached buffers, origin, and sender identity.
- Keep DOM-dependent work on the document side. Move work to a worker only when isolation or measured CPU and responsiveness benefit justify serialization, startup, memory, and lifecycle cost.
- Treat service worker registration, scope, install, waiting, activation, controller change, and update discovery as a versioned deployment protocol. A newly installed worker does not necessarily control existing clients.
- Design for old and new documents and service workers running concurrently. Cache names, message formats, stored schemas, and network requests need a compatible transition or an explicit reload boundary.
- Call `FetchEvent.respondWith()` during event dispatch and pass the complete response promise. Use `ExtendableEvent.waitUntil()` while the event remains extendable for owned install, activation, message, or background work that must extend its lifetime; floating promises do not keep a service worker alive.
- Distinguish the script-managed Cache API from the browser's HTTP cache. Cache storage accepts HTTP(S) `GET` request/response pairs and does not update or expire entries automatically. Define URL and query matching, `Vary`, credentials and tenant scope, freshness, validation, and eviction; treat `ignoreSearch`, `ignoreMethod`, and `ignoreVary` as deliberate compatibility exceptions.
- Do not cache personalized or authorization-sensitive responses under a key another user or session can reuse. Clear only caches owned by the application, and retire old versions after no supported client requires them.
- Make offline and navigation fallbacks type-correct and honest. An HTML fallback returned for a script, JSON, image, or module request can turn one network failure into confusing parse or execution errors.
- Bound cache growth and failed-request queues. Browser quota eviction and service-worker termination can happen without the cleanup callback the code expected.
- Treat background sync, push, periodic work, and notifications as optional, permissioned, duplicate-prone delivery. Preserve idempotency and a visible recovery path when the browser never runs the task.
- Test worker update, bypass, offline, corrupt cache, and unregister behavior. A service worker must not make a deployment permanently dependent on stale or invalid cached code.

## Page visibility, back/forward cache, and cleanup

- Expect timers to be throttled, animation frames to pause, network work to be deferred, and a page to be frozen or discarded while hidden. Do not use a foreground timing assumption as a correctness clock.
- On a persisted `pagehide`, release or pause resources that should not remain active without destroying state needed for restoration. On `pageshow`, verify server state, clocks, connections, and permissions that may have changed.
- Do not treat visibility as authorization or proof of user attention. Hidden documents can execute some work, and visible documents can be obscured or automated.
- Release timers, animation frames, observers, event listeners, object URLs, media tracks, audio contexts, streams, readers, channels, ports, workers, sockets, and third-party handles on every owner terminal path.
- Close or deliberately suspend WebSocket, EventSource, peer connection, and subscription resources when a view or session no longer owns them. Define reconnect, resubscribe, resume token, and duplicate-message behavior.
- Revoke object URLs only after every consumer has finished, and revoke them on error or abandonment. Avoid retaining large blobs through DOM nodes, closures, caches, or diagnostic state.
- Use explicit lifecycle cleanup rather than `WeakRef`, finalizers, or garbage collection timing. Garbage collection is nondeterministic and cannot complete protocol-visible release obligations.
- Verify repeated mount, unmount, navigation, restore, and account-switch cycles. A stable one-time heap snapshot does not prove listener or detached-tree growth is bounded.

## Cross-origin boundaries and browser security

- Treat same-origin policy, CORS, CSP, sandboxing, Permissions Policy, and cross-origin isolation as distinct controls. None substitutes for server-side authentication and authorization.
- Insert untrusted content through text-safe DOM APIs. HTML-producing sinks such as `innerHTML`, `outerHTML`, `insertAdjacentHTML`, and `document.write` require a reviewed need and context-appropriate sanitization.
- Do not interpolate untrusted or user-facing data into HTML template literals. Prefer `textContent`, `createTextNode()`, and context-specific DOM properties. When a real HTML contract requires markup, sanitize the complete markup with a reviewed HTML sanitizer and handle URL, CSS, and script contexts according to their own rules; a generic `escapeHtml()` helper is not universal output encoding.
- Use Content Security Policy as defense in depth with a deployment-compatible nonce, hash, or trusted-source design. Do not weaken it with broad sources, inline execution, or dynamic evaluation merely to silence violations.
- Use Trusted Types where the support and deployment contract justify it, while keeping the producing policy narrow and reviewed. Trusted Types does not make an unsafe sanitizer or policy safe.
- For `postMessage`, use an exact target origin when it is known and validate the received origin, source window, message schema, and state before acting. Possession of a window reference alone is not authentication.
- Sandbox embedded content and grant only the capabilities it requires. Review the combined effect of sandbox tokens, allowed features, credentials, origin, navigation rights, opener access, and communication channels.
- Treat third-party scripts as code executing with the page's client-side authority. Minimize them, pin and integrity-check immutable cross-origin resources where supported, and contain their data and capability access.
- Keep tokens, credentials, personal data, source maps, diagnostics, and feature flags out of client-visible assets unless exposure is an intentional public contract. Obfuscation and minification do not provide confidentiality.
- Validate dynamic module, worker, image, media, style, and navigation URLs. Prevent scriptable schemes, origin confusion, and attacker-controlled import or worker execution.
- Account for cross-origin opener and embedder policy when using shared memory or isolation-dependent APIs. Do not enable isolation headers without testing every required embed and popup flow.
- Keep client-side authorization checks as user-experience controls only. The server must enforce every protected read and side effect.

## Rendering and measured performance

- Tie performance findings to user-visible metrics, an explicit budget, a trace, or a clear complexity bound on supported devices. Source appearance alone does not prove a browser performance defect.
- Avoid long main-thread tasks, unbounded microtask chains, repeated synchronous layout, excessive DOM size, and large parse or serialization work on interaction paths.
- Group visual writes with the rendering lifecycle and read geometry before invalidating it when practical. Use animation frames for visual updates, not as a general-purpose queue or durability mechanism.
- Lazy-load code and data along real usage boundaries while preserving failure, focus, loading, and offline states. Too many chunks can increase connection, evaluation, cache, and deployment-version failure cost.
- Use workers, memoization, virtualization, containment, and prefetching only when measurements show they improve the target workload without violating accessibility, freshness, memory, or cleanup contracts.
- Measure startup, navigation, input responsiveness, layout stability, memory, and resource loading on representative devices and networks. Lab results and field telemetry answer different questions.
- Use Performance Timeline observers and resource or navigation timing with bounded retention and sampling. Disconnect observers and avoid high-cardinality or sensitive names in telemetry.
- Respect browser privacy reduction, unavailable timing detail, cache state, and extension interference. Do not turn one local trace into a universal claim.

## Progressive failure and recovery

- Preserve a meaningful document, native navigation, and critical form behavior without script when the product contract allows progressive enhancement.
- For every user-triggered mutation, expose failure and recovery through the accessible interface that initiated it. Preserve safe user input, restore or move focus deliberately, announce the outcome when visual state alone is insufficient, and provide an idempotent retry or clear next step; a console message is not user-visible error handling.
- Give initialization, chunk load, API, storage, permission, worker, and third- party failures explicit user-visible states. Do not leave a permanent spinner or silently stale view.
- Preserve user input across recoverable rerenders, navigation failures, authentication refresh, offline transitions, and update prompts when doing so is safe and expected.
- Bound automatic retries and make manual retry idempotent. Prevent every component or tab from starting an independent recovery storm.
- Detect incompatible cached code and data and provide a safe update path. Avoid infinite reload loops when the network, service worker, CDN, or HTML still serves mismatched versions.
- Make failure containment match ownership. One optional widget, analytics script, or media resource should not disable unrelated navigation or content.
- Keep visible, focus, disabled, busy, error, and accessible states synchronized during partial failure and recovery.

## Tests and validation

Add focused coverage for applicable browser-runtime risks:

- the minimum and representative supported browser engines, devices, webviews, secure contexts, permissions, and feature fallbacks;
- startup order, delayed or failed modules, repeated initialization, hydration, remount, navigation, hidden, frozen, back/forward restore, and discard recovery;
- event propagation, shadow boundaries, composition input, listener and observer cleanup, and stale asynchronous completions;
- fetch HTTP errors, network errors, abort, timeout, redirect, credentials, opaque responses, malformed content, partial streams, and response limits;
- direct URLs, reload, history traversal, fragments, query encoding, focus, title, scroll, and open-redirect attempts;
- denied or full storage, IndexedDB upgrade and blocking, multi-tab races, version migration, eviction, and corrupt stored data;
- worker errors, transferred data, service-worker install and update, mixed versions, offline navigation, corrupt caches, quota eviction, and bypass;
- DOM injection, CSP, Trusted Types, `postMessage`, iframe sandbox, third-party failure, and cross-origin isolation;
- repeated lifecycle memory and handle growth, plus cleanup of media, channels, sockets, streams, object URLs, and workers;
- performance budgets using representative CPU, memory, viewport, input, and network conditions.
- WebAssembly feature detection, streaming MIME and CORS failures, import and export validation, traps, resource bounds, memory growth and stale views, shared-memory isolation, worker termination, and repeated instantiation.

Use real browser integration or end-to-end tests for browser semantics. A DOM shim or component unit test does not prove navigation, layout, storage, service-worker, CSP, CORS, back/forward cache, permission, or engine behavior.

Run a risk-based browser smoke and accessibility subset before merge when those behaviors are part of the release contract. Keep broader engine, device, and post-deployment coverage as an additional gate; a suite that runs only after a change reaches production is detection and recovery evidence, not pre-release prevention.

Run the repository's configured formatter, linter, types, build, unit, integration, accessibility, end-to-end, compatibility, and performance checks as applicable. Report exact commands, browser versions, devices or emulation, network conditions, and outcomes. Every untested supported target is residual risk, not a pass.

## Primary references

- [WHATWG HTML Living Standard](https://html.spec.whatwg.org/)
- [WHATWG DOM Standard](https://dom.spec.whatwg.org/)
- [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/)
- [WHATWG URL Standard](https://url.spec.whatwg.org/)
- [WHATWG Streams Standard](https://streams.spec.whatwg.org/)
- [WHATWG Storage Standard](https://storage.spec.whatwg.org/)
- [Indexed Database API](https://w3c.github.io/IndexedDB/)
- [Service Workers](https://w3c.github.io/ServiceWorker/)
- [WebAssembly Core Specification](https://webassembly.github.io/spec/core/)
- [WebAssembly JavaScript Interface](https://www.w3.org/TR/wasm-js-api-2/)
- [WebAssembly Web API](https://www.w3.org/TR/wasm-web-api-2/)
- [Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- [Trusted Types](https://w3c.github.io/trusted-types/dist/spec/)
- [WHATWG HTML: Page visibility](https://html.spec.whatwg.org/multipage/interaction.html#page-visibility)
- [Performance Timeline](https://www.w3.org/TR/performance-timeline/)
- [Web Platform Tests](https://web-platform-tests.org/)
