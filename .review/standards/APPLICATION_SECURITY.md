# Application Security Standards

## Scope

Apply this profile with `CODING_STANDARDS.md` when the review requests a security deep dive or the system has consequential authentication, authorization, tenant isolation, sensitive data, administrative capability, or hostile-input boundaries.

This profile supplements the security rules embedded in the language, runtime, browser, HTTP, datastore, container, CI, and public-artifact profiles. It owns the cross-cutting application threat model and the end-to-end enforcement of identity, authority, data protection, and abuse resistance.

The repository's threat model, data classification, selected verification standard and version, regulatory obligations, deployment architecture, and accepted risks are authoritative. Do not turn every optional defense into a finding. Demonstrate the applicable threat, reachable path, missing or broken control, and resulting impact.

## Threat model and trust boundaries

- Identify protected assets, actors, entry points, trust zones, data flows, privileged operations, external dependencies, and realistic attacker capabilities before grading a security concern.
- Treat browsers, mobile clients, command-line clients, request fields, stored records, queues, files, webhooks, logs, and third-party responses as untrusted unless a verified boundary establishes otherwise.
- Map every transition where identity, tenant, authority, confidentiality, or integrity changes. Network location, an internal hostname, or possession of a record identifier is not authorization.
- Include administrative tools, support impersonation, background jobs, migrations, import/export paths, debug endpoints, and recovery workflows in the attack surface.
- Define abuse cases as well as ordinary use cases: enumeration, replay, resource exhaustion, confused-deputy behavior, cross-tenant access, workflow skipping, and malicious sequencing often use individually valid requests.
- Fail closed when identity, policy, key material, or security configuration is unavailable or ambiguous. Define the safe degraded behavior rather than silently bypassing enforcement.
- Keep security boundaries enforceable on every supported deployment topology. A proxy, cache, worker, replica, or alternate entry point must not bypass a control present on only the primary path.

## Authentication and identity lifecycle

- Establish identity at a trusted server-side boundary and bind it to the request, connection, job, or session that consumes it. Never trust a client-provided user, role, tenant, or authentication-state field.
- Use established authentication protocols and maintained libraries. Validate protocol messages against the exact issuer, audience, client, redirect, signature, nonce, time, and replay contract that applies.
- Make account enrollment, verification, login, logout, credential change, recovery, linking, deletion, and administrative reset one coherent lifecycle. A strong login does not compensate for a weak recovery path.
- Store passwords only with a current password-hashing construction and project-approved parameters. Support parameter upgrades without exposing plaintext or creating account-lockout races.
- Apply rate controls and abuse detection to authentication and recovery without making denial of service or user enumeration easy. Keep public error behavior appropriately indistinguishable while retaining safe diagnostics.
- Require phishing-resistant or step-up authentication where the declared risk warrants it, especially for credential, payment, security-policy, or high-impact administrative changes.
- Rotate or revoke credentials, sessions, refresh tokens, device grants, and recovery material after compromise or relevant account changes. Define what happens to already issued work and offline clients.
- For OAuth and OpenID Connect, follow the selected current profiles and security BCPs. Do not preserve deprecated flows merely because a library still exposes them, and do not invent protocol extensions in application code.

## Authorization, ownership, and tenant isolation

- Authorize every protected operation at the boundary that owns the resource and side effect. A hidden control, guessed-unlikely identifier, or earlier UI check is not enforcement.
- Check both permission and resource scope. Bind the subject, tenant, organization, account, parent resource, operation, and relevant state before reading, mutating, exporting, or disclosing existence.
- Default to denial for missing, malformed, stale, or unrecognized policy state. Centralize policy decisions where that improves consistency without hiding resource-specific ownership checks.
- Prevent horizontal and vertical privilege escalation across detail, list, search, count, bulk, export, history, attachment, and indirect-reference endpoints. Metadata and error differences can disclose protected existence.
- Carry verified identity and tenant context into asynchronous jobs, events, caches, and downstream calls. Do not reconstruct authority from mutable display names, request payloads, or globally scoped defaults.
- Treat administrative, support, impersonation, and break-glass capabilities as separate high-risk operations with narrow grants, explicit activation, prominent attribution, auditability, and bounded lifetime.
- Make administrative and operator tools preview-only by default when they can change privileged or sensitive state. Require explicit target and environment confirmation plus a distinct commit or apply action, reauthorize at commitment, and fail closed with a nonzero process status or unsuccessful operation result when any required step fails.
- Invalidate or version cached authorization decisions when memberships, ownership, policy, suspension, or credential state changes. Define the acceptable revocation delay.
- Test policy composition. Several individually reasonable role, sharing, or inheritance rules can combine into unintended access.

## Sessions, tokens, and request integrity

- Give each session or token an explicit issuer, audience, subject, scope, lifetime, rotation, revocation, storage, and transport contract. Minimize the authority and duration of bearer credentials.
- Validate signed tokens rather than merely decoding them. Constrain permitted algorithms and keys, and verify the applicable issuer, audience, time, subject, nonce, and token-type semantics before using claims.
- Prevent session fixation and rotate session identifiers at authentication and meaningful privilege changes. Logout and account-security changes must have the documented server-side effect.
- Protect browser credentials with context-appropriate cookie attributes and a deliberate same-site policy. Do not expose long-lived credentials through URLs, referrers, browser history, analytics, or broadly readable storage.
- Protect state-changing requests against cross-site request forgery whenever ambient credentials can accompany a cross-site request. Treat `SameSite` as one layer, not a universal replacement for request-bound integrity controls.
- Bind sensitive multi-step workflows to the intended actor, object, purpose, amount, and freshness. Revalidate authority at commitment rather than trusting an earlier preview or approval screen.
- Make replay behavior explicit for invitations, password resets, signed URLs, webhook deliveries, payment actions, and other bearer capabilities. Use single use, expiry, idempotency, or replay tracking according to the threat.

## Input, parsing, injection, and unsafe interpretation

- Validate data after the decoding and normalization steps relevant to the operation. Reject ambiguous encodings, duplicate-field behavior, structural conflicts, and values outside the declared size, depth, count, and type limits.
- Keep untrusted data as data. Parameterize database operations and use context-specific encoders or safe APIs for HTML, JavaScript, CSS, URLs, headers, templates, logs, regular expressions, and operating-system commands.
- Do not reuse an encoder across contexts or assume earlier escaping survives concatenation, decoding, serialization, or movement to another interpreter.
- Avoid constructing shell source, query syntax, templates, paths, module names, or dynamic code from untrusted values. When selection is required, map an allowlisted external value to an application-owned operation.
- Constrain deserialization to expected types and data-only formats. Do not instantiate arbitrary classes, invoke callbacks, or evaluate expressions supplied by an untrusted document.
- Normalize and resolve filesystem paths within an owned root, then enforce the boundary against traversal, symlink, alternate-stream, case, encoding, and time-of-check/time-of-use behavior on supported platforms.
- Bound regular expressions, decompression, parsing, recursive structures, and attacker-controlled allocation. A syntactically valid payload can still be a resource-exhaustion input.

## Files, uploads, and generated content

- Enforce size, count, ownership, and lifecycle limits before buffering or durable storage. Stream large content only with bounded resources and cancellation.
- Derive storage names and locations independently of the submitted filename. Preserve a sanitized display name separately when users need it.
- Validate the content needed by the consuming operation rather than trusting an extension or client-provided media type. Re-encode complex media where the product requires a normalized safe representation.
- Store untrusted uploads outside executable and privileged origins. Apply quarantine, scanning, review, or delayed availability where the threat model requires it, with explicit failure behavior.
- Defend archive and document processing against traversal, nested expansion, external references, macros, parser vulnerabilities, and decompression bombs.
- Serve downloads with deliberate content type, disposition, sniffing, caching, authorization, and range behavior. Do not let active content inherit a trusted application origin accidentally.

## Outbound requests, callbacks, and third parties

- Treat user-influenced outbound destinations as an SSRF boundary. Parse once, constrain schemes and destinations, resolve and connect under a consistent policy, and re-check redirects rather than validating only the initial text.
- Protect loopback, link-local, private, metadata, control-plane, Unix-socket, and other privileged destinations according to the deployment. Account for alternate numeric forms, DNS rebinding, IPv4/IPv6 differences, and proxies.
- Set connection, response, total-time, redirect, body-size, and concurrency limits. Validate response types before parsing and do not buffer unbounded third-party content.
- Verify TLS peers and hostnames under an explicit trust policy. Do not disable verification or follow insecure downgrades to make an integration work.
- Authenticate incoming webhooks and callbacks using the provider's current scheme. Verify the exact signed bytes, timestamp and replay window, key or issuer, and intended destination before accepting side effects.
- Give third-party SDKs, plugins, analytics, and embedded content only the data, credentials, scopes, network access, and runtime capabilities required. Define behavior when the dependency is compromised or unavailable.

## Cryptography, randomness, and secrets

- Use maintained cryptographic libraries and reviewed protocols. Do not invent encryption modes, signature formats, key derivation, token construction, or randomness schemes in application code.
- Select algorithms, parameters, key sizes, nonces, salts, and comparison behavior from the declared current security contract. Make algorithm and key rotation possible without silently losing old data.
- Generate security-sensitive identifiers and secrets with a cryptographically secure random source and enough entropy for the real guessing and collision threat. Human-readable codes need their own rate and lifetime controls.
- Keep keys and secrets out of source, images, logs, crash reports, URLs, command lines, client-visible bundles, fixtures, and broad environment dumps. Scope access and record ownership and rotation procedures.
- Separate encryption, signing, password hashing, and ordinary hashing. A fast content hash is not password storage, and encryption without authenticity does not protect integrity.
- Define backup, escrow, rotation, compromise, revocation, and destruction for key material. A secret manager alone does not establish a usable lifecycle.

## Sensitive data and privacy

- Classify personal, credential, payment, health, tenant, operational, and other sensitive data before deciding collection, access, storage, telemetry, export, retention, and deletion behavior.
- Collect and disclose only what the product needs. A field being available from an identity provider or client does not justify retaining it.
- Protect data in transit and at rest according to the threat model, including queues, caches, replicas, backups, support tools, search indexes, analytics, temporary files, and generated exports.
- Apply field and record authorization to exports, reports, search, logs, and administrative views. Bulk paths must not bypass ordinary tenant or purpose restrictions.
- Make retention, deletion, legal hold, anonymization, and backup expiration semantics explicit. Do not claim immediate deletion when copies remain by design.
- Keep production data out of development, tests, examples, screenshots, and support bundles unless a controlled, documented process authorizes and protects it.

## Errors, auditing, and security operations

- Return errors that are useful without disclosing credentials, secrets, internal paths, query details, stack traces, tenant existence, or policy internals to an unauthorized caller.
- Record security-relevant events with a stable event identity, trusted actor and subject, tenant, action, outcome, target, time, and correlation context. Keep audit records distinct from mutable application diagnostics where needed.
- Prevent log forging and sensitive-data leakage. Treat request values as structured untrusted fields, and control who can query, export, retain, or delete security telemetry.
- Alert on actionable abuse and control failures, not every rejected request. Rate limits and anomaly detection reduce abuse impact but do not repair broken authentication or authorization.
- Define incident-safe controls for credential revocation, feature isolation, tenant containment, forensic preservation, and secure diagnostic escalation.

## Dependencies, configuration, and deployment

- Remove debug routes, sample credentials, permissive development defaults, and unnecessary services from production artifacts and startup paths.
- Validate security-critical configuration at startup and fail safely on missing secrets, weak policy, unknown proxy boundaries, or contradictory settings.
- Trust forwarding, client-certificate, and identity headers only from an authenticated and configured intermediary that removes untrusted inbound copies.
- Keep dependency and platform versions within a supported vulnerability and update policy. Validate exploitability and affected paths rather than reporting a scanner label without repository context.
- Apply least privilege to application identities, databases, queues, storage, cloud APIs, files, processes, and network paths. Separate build, migration, runtime, support, and release authority where their duties differ.
- Keep security headers, CORS, CSP, cookie, TLS, and proxy behavior consistent across the application, edge, CDN, and alternate hostnames. Verify the deployed response rather than configuration source alone.

## Tests and verification

Use the repository's configured security tooling and selected verification standard as evidence, not as a substitute for tracing behavior. Applicable coverage includes:

- authentication, recovery, logout, revocation, fixation, replay, and identity- provider failure paths;
- horizontal, vertical, cross-tenant, indirect, bulk, asynchronous, and administrative authorization cases;
- malformed, duplicated, oversized, deeply nested, encoded, and adversarial input at every parser and interpreter boundary;
- CSRF, CORS, origin, redirect, callback, SSRF, upload, archive, and active- content behavior where applicable;
- secret, personal-data, error, log, trace, cache, export, backup, and deletion disclosure paths;
- dependency, static, dynamic, fuzz, and configuration checks scoped to the reachable application and supported deployment;
- resource-exhaustion and abuse tests with bounded, non-production targets;
- exact regression tests for every confirmed vulnerability and neighboring variants of the same root cause.

Record the threat model, standard and version, requirement identifiers, tool versions, environment, commands, evidence, exclusions, and residual risk. A clean scanner report does not prove the application is secure, and a scanner match does not prove a reachable vulnerability.

## Primary references

- [OWASP Application Security Verification Standard](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP ASVS 5.0 stable source](https://github.com/OWASP/ASVS/tree/v5.0.0_release)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
- [NIST Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final)
- [OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
- [JSON Web Token Best Current Practices](https://www.rfc-editor.org/rfc/rfc8725.html)
- [Argon2 memory-hard password hashing](https://www.rfc-editor.org/rfc/rfc9106.html)
- [MITRE Common Weakness Enumeration](https://cwe.mitre.org/)
