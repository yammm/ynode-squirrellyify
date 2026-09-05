# Command-Line Interface Standards

## Scope

Apply this profile with `CODING_STANDARDS.md` to public and internal command-line programs, subcommands, executable scripts, wrappers, developer tools, migration commands, generators, and machine-consumed command interfaces.

A CLI is an API. Its command name, arguments, environment, configuration, streams, exit statuses, prompts, side effects, timing, and installed artifact can all be depended on by people and automation.

The repository's declared operating systems, shells or launchers, terminal behavior, compatibility policy, configuration model, output schemas, and installation mechanism are authoritative. Combine this profile with the implementation-language, runtime, packaging, security, and public-repository profiles that apply. Use `SHELL.md` for a shell implementation and `PYTHON.md` for a Python implementation. Use `BATCH.md` for a Windows Command Processor wrapper or implementation and `POWERSHELL.md` for PowerShell rather than duplicating their launcher and runtime rules here.

## Command identity and interface contract

- Prefer extensionless public command names. The command should describe the operation or product, not expose whether its implementation is shell, Python, JavaScript, or a native binary.
- Keep platform source conventions distinct from the public invocation. A Windows command may be typed without a suffix through `PATHEXT` while its source remains `.cmd`; a directly invoked PowerShell source file remains `.ps1` unless installation creates a separate command shim.
- Keep implementation source in the language's normal structure. An extensionless installed entry point can dispatch to a `.py` module, packaged JavaScript, `.ps1` file, `.cmd` wrapper, or compiled program without renaming all internal source files.
- Treat a command name, executable path when documented, subcommand, alias, and dispatch behavior as compatibility contracts. Renaming or reparenting a command needs migration and deprecation proportional to its consumers.
- State the supported operating systems, architectures, terminals, shells or process launchers, encodings, and minimum runtime versions. A program that only works from one interactive developer shell is not a portable CLI.
- Keep the default action intentional. No-argument invocation must either perform a documented safe operation, present useful help, or fail with actionable usage; it must not guess a destructive target.
- Make internal versus supported commands explicit. Hidden commands can still become accidental contracts when CI, documentation, or shipped completion files invoke them.

## Arguments, options, and operands

- Define one grammar for global options, subcommands, subcommand options, positionals, repeated values, and the end-of-options marker. Use a mature parser for the implementation language when it matches the required contract.
- Follow the selected POSIX, GNU, Windows, or repository convention consistently. POSIX option ordering and GNU permutation are not equivalent; acceptance by one parser does not prove the documented grammar.
- Give each option one meaning and type. Distinguish a missing option, an empty option argument, a defaulted value, and an explicitly cleared value where the underlying operation does.
- Reject unknown options and subcommands with a nonzero status and a concise, actionable diagnostic. Do not silently reinterpret a misspelling as a positional path or remote identifier.
- Avoid automatic long-option abbreviation unless it is a deliberate stable contract. Adding a new option can make a formerly unique abbreviation ambiguous or change what it selects.
- Define whether short options may be grouped, whether options may follow operands, how optional option arguments bind, and how negative numbers or option-looking operands are disambiguated.
- Support `--` to end option parsing when the selected convention and parser provide it. Document any public command that cannot safely accept operands beginning with `-`.
- Do not overload one flag with unrelated meanings based on argument order, TTY state, or hidden environment. Prefer explicit subcommands or options when behavior and authorization differ.
- Validate values at parse and domain boundaries with the correct units, ranges, formats, and mutually exclusive or required combinations. A parser's successful string conversion does not establish domain validity.
- Decide whether repeated options replace, append, merge, count, or fail. Keep that behavior consistent across command line, environment, and configuration representations where they express the same setting.
- Define whether `-` represents standard input or output for each operand. It is a convention only where the CLI explicitly supports it, and a literal file named `-` still needs an unambiguous representation.
- Keep shell completion advisory. The parser must validate every value because callers can bypass, stale, or maliciously influence completion.

## Standard input and interactive input

- State whether standard input is required data, optional data, a prompt channel, or unused. Do not unexpectedly consume a caller's terminal or the next stage's pipeline input.
- If both positional input and standard input are supported, define precedence, concatenation, ordering, encoding, record boundaries, size limits, and the behavior of an empty or already-closed stream.
- Stream input when practical and bound buffering before parsing compressed, nested, or attacker-controlled data. Define partial-record and malformed input behavior.
- Keep prompts separate from piped data. Reading a confirmation from the same stream as bulk input can consume application data or block automation.
- Prompt only when the operation permits interaction and the relevant channel is an appropriate terminal. In noninteractive execution, require an explicit flag or fail safely with remediation instead of hanging.
- Never read a secret visibly from a terminal. Use the platform's protected input mechanism and restore terminal state after success, error, signal, and cancellation.

## Standard output, standard error, and machine formats

- Write the requested result or data to standard output and diagnostics to standard error. Do not mix progress, banners, warnings, debug logs, or update notices into a machine-readable standard-output stream.
- Treat each stream's TTY state independently. Standard output may be piped while standard error remains a terminal; do not infer one from the other.
- Define color, progress, paging, hyperlinks, spinners, and interactive formatting for `auto`, forced, and disabled modes. Disable terminal control sequences in machine formats and unsupported non-TTY destinations.
- Escape or replace untrusted control characters in human diagnostics. A filename, branch, record, or remote response must not inject terminal escape sequences, erase context, or counterfeit a trusted message.
- Give machine-readable output a documented media shape, encoding, schema, versioning policy, ordering contract, and representation for errors and partial results. “JSON” alone does not define whether output is one document, a stream of documents, or a sequence of records.
- For a single-document machine format, serialize and validate the complete document before emission when practical, but do not claim filesystem-like atomicity for standard output. Return success only after every required byte has been written and flushed successfully, and define how callers detect or discard partial output. For streams, define record boundaries and record-level failure behavior.
- Keep human output readable and actionable without making automation scrape prose. Add an explicit machine mode rather than promising stable columns or punctuation accidentally.
- Define locale and time-zone behavior. Machine formats should use stable field names, numeric representations, timestamps, and sorting independent of a developer's locale unless localization is part of the schema.
- Handle a closed downstream pipe without a stack trace, corrupt diagnostic, or resource leak. Decide whether early consumer termination is success, cancellation, or incomplete output under the pipeline contract.
- Flush and close output deliberately before reporting success when buffered write failure, broken storage, or network-backed streams can still invalidate the result.

## Exit status and error behavior

- Return zero only when the documented operation completed successfully. Help or version explicitly requested by a valid invocation should normally return zero; parse errors and failed operations must not.
- At the top-level command boundary, map parse, validation, authorization, dependency, and unexpected failures to deterministic nonzero statuses. Never catch and print an error only to fall through to a successful process status.
- Define stable nonzero statuses for error categories that callers are expected to branch on. Do not expose arbitrary internal exception values or collapse a meaningful partial failure into success.
- Account for the supported process launcher. Unix shells commonly expose an eight-bit status and signals can occupy conventional ranges; Windows process and console-control semantics differ. Test the observable status rather than assuming an in-language integer survives unchanged.
- Distinguish invalid usage, invalid input, missing data, authorization denial, dependency failure, conflict, timeout, cancellation, and internal defects only to the granularity useful to callers. Document the mapping.
- If batch work permits partial success, define its exit status, output schema, retry boundary, and whether failed items can be safely submitted again.
- Preserve the originating cause for diagnostics without leaking secrets or a raw stack trace by default. A debug mode can add detail while retaining the same failure category.
- Print one primary diagnostic at the owning boundary. Avoid duplicate nested messages that obscure the actual failure, and include the failed operation or input identity when safe.

## Help, version, and documentation

- Keep `--help`, command help, examples, parser behavior, and external documentation synchronized. Prefer deriving usage from the same command model where that does not hide important semantics.
- Help should explain required arguments, defaults that materially affect behavior, environment and configuration, side effects, output modes, exit statuses, network access, privileges, destructive operations, and examples.
- Make help and version output available without working credentials, network access, mutable initialization, or a valid project configuration unless the documented command fundamentally requires that context.
- Make `--version` identify the artifact actually executing. Include build or revision metadata only when the release policy defines and tests it.
- Keep error usage concise. A one-character typo should not dump pages of help before the actionable diagnostic; point to focused help when appropriate.
- Verify examples as executable contracts, including quoting and the shell from which the documentation expects users to invoke them.

## Configuration and environment precedence

- Define one complete precedence order among command-line values, explicitly named configuration, environment variables, project configuration, user configuration, system configuration, and built-in defaults.
- When no repository contract exists, normally give explicitly supplied option values highest precedence and built-in defaults lowest precedence. Choose and document the ordering among explicitly selected configuration, environment, project, user, and system sources according to the deployment model; no single ordering is universally correct.
- Distinguish “not supplied” from empty, false, zero, or an explicit reset. Do not let truthiness accidentally select a lower-precedence value.
- Define whether maps and lists merge, append, replace, or clear across layers. Report the effective source in a safe diagnostic mode so users can explain a surprising result without exposing secret values.
- Make configuration discovery deterministic. State whether it starts from the current directory, input path, repository root, executable location, user home, or platform-specific configuration directory and where traversal stops.
- Validate all configuration before beginning mutation. Do not apply half a command using defaults and discover an invalid lower layer afterward.
- Treat environment variables as untrusted strings. Parse booleans, numbers, durations, lists, paths, URLs, and encodings explicitly; distinguish unset from empty.
- Avoid ambient configuration for commands used in security, build, release, or migration boundaries when reproducibility matters. Offer an explicit clean or isolated mode and report which sources were read.
- Keep secrets out of checked-in defaults and generated diagnostics. Check configuration file ownership and permissions where a less-trusted writer could redirect privileged behavior.

## Signals, cancellation, and process lifecycle

- Define the behavior of interrupt, termination, timeout, parent disconnect, and platform-specific console-control events for each mutating or long-running command.
- On cancellation, stop accepting new work, propagate the request to owned operations, wait or force termination according to a bounded policy, and clean up without presenting partial state as success.
- Keep signal handlers minimal and compatible with the implementation runtime. Coordinate cleanup through normal control flow where direct handler work is unsafe or reentrant.
- Preserve the observable cancellation status. Do not catch an interrupt and return zero merely because cleanup succeeded.
- Define repeated-interrupt behavior. A second signal can request faster termination, but it must not silently widen a destructive operation or skip critical integrity cleanup without warning.
- Own child processes, workers, temporary resources, locks, terminals, and network clients through every exit path. Detached work needs an explicit supervisor and result channel.
- Make timeout scope clear: queue wait, connection, individual request, overall command, or shutdown. A timed-out wrapper that leaves remote work active has not necessarily cancelled the operation.

## Destructive commands and repeat execution

- Make operator commands that can delete, overwrite, migrate, publish, grant, revoke, or otherwise make consequential changes preview-only by default. Require an explicit `--apply`, `--commit`, or equivalently unambiguous action to mutate; the absence of an interactive terminal must not select mutation.
- Resolve and display the canonical target and environment before commitment. Require the caller to select or confirm them explicitly, and reject an omitted or ambiguous production, account, cluster, database, or tenant target rather than falling back to a powerful default.
- Resolve and display the exact affected scope before destructive work. Reject empty, root, parent, wildcard-expanded, cross-account, or otherwise broader targets than the caller authorized.
- Require confirmation only when it adds a real safety boundary. Name the operation and target in the prompt; a generic “continue?” prompt is weak protection against the wrong context.
- Noninteractive execution must never assume consent. Require an explicit automation flag, pre-approved plan, or fail with an actionable message.
- Give `--yes`, `--force`, and similarly dangerous options narrow, documented, distinct semantics. They may bypass a prompt or a specific recoverable check; they must not bypass authentication, authorization, target validation, or unrelated integrity checks.
- A dry run must avoid the mutations it claims to simulate, including remote writes, locks with externally visible effects, counters, generated secrets, and local state files. Report unknown or unmodelled effects rather than promising safety.
- Make retry and repeated invocation idempotent where the operation can be retried. Otherwise provide a stable operation identifier, conflict behavior, resume point, rollback, or documented recovery path.
- For plan/apply workflows, bind approval to the relevant input, target, identity, and version. Detect drift between planning and execution instead of applying stale intent to changed state.
- Emit a durable result or audit record when the domain requires it, without placing secrets or unnecessary personal data in logs.

## Compatibility and deprecation

- Treat option names, subcommands, defaults, accepted input, exit statuses, environment names, configuration keys, output schemas, and side effects as public contracts at the repository's declared stability level.
- Prefer additive changes. A new default, stricter validation, reordered machine output, prompt, network call, or warning on standard output can break automation even when the executable still starts.
- Deprecate with a clear replacement, warning channel, timeline or release boundary, and test coverage. Keep the old path functional during the stated window unless security or data integrity requires an immediate break.
- Do not emit human deprecation prose into a machine data stream. Use standard error or a structured diagnostic channel that the machine-mode contract defines.
- Version machine schemas independently when CLI release version alone cannot communicate compatibility. Consumers should tolerate documented additive fields without ignoring malformed required data.
- Keep aliases and compatibility shims narrow and observable. Remove them only after repository callers, examples, completions, wrappers, and release automation migrate.

## Security and trust boundaries

- Treat arguments, environment, current directory, configuration, stdin, filesystem entries, terminal contents, repository files, remote responses, and plugin output as separate trust boundaries.
- Pass subprocess arguments as a structured vector and disable shell parsing unless the command explicitly requires reviewed shell language. Never build a command string from untrusted input.
- Validate paths against the authorized root at the operation point. Account for symlink replacement, traversal, mount changes, case behavior, and a changed current directory.
- Avoid secrets in command-line arguments because process listings, shell history, telemetry, and error reports may expose them. Prefer a protected descriptor, secret store, or documented non-echoing input channel appropriate to the platform.
- Treat endpoints and connection strings as potentially secret-bearing values. When target context must be displayed, emit a deliberately redacted label or parsed safe subset; never echo embedded credentials, tokens, sensitive query fields, or the complete raw value.
- Pass a minimal environment to less-trusted subprocesses. Do not leak tokens, proxy credentials, signing configuration, preload variables, or executable lookup paths unrelated to the child.
- Treat plugins, hooks, response files, dynamic configuration, and completion scripts as executable or code-influencing inputs. Authenticate and authorize their source before loading them in a privileged context.
- Bound input, output capture, decompression, recursion, concurrency, retries, and diagnostic cardinality before an attacker or malformed dependency can exhaust resources.
- Apply least privilege to credentials, filesystem access, network scope, and child processes. A read-only or planning command should not acquire mutation credentials without a demonstrated need.

## Packaging and installation

- Test the exact installed artifact, not only an in-tree development runner. Verify that the documented platform-native command, including extensionless lookup or `PATHEXT` resolution when promised, selects the intended version and implementation without depending on the source checkout.
- Keep entry-point generation, shebangs, executable modes, native launchers, runtime lookup, and platform wrappers in the applicable language and packaging profiles. The resulting public command behavior must remain consistent across supported installation methods.
- Detect command-name collisions and PATH shadowing where the installer can do so safely. Documentation should identify how users verify which executable is running.
- Version completion definitions, manual pages, examples, and wrapper scripts with the command grammar. Stale completion must not be the only way a valid value can be discovered.
- Make uninstallation remove only files owned by that installed artifact. Do not delete user configuration, data, shared caches, or another version's files without a separate explicit contract.
- A self-update command is a release and supply-chain boundary. Authenticate metadata and artifacts, prevent downgrade or channel confusion, replace atomically, and retain a recovery path.

## Tests and validation

Use the repository's configured public invocation and test the exact packaged artifact where practical. Applicable evidence includes:

- documented platform-native invocation, extensionless or `PATHEXT` lookup when promised, direct script invocation when supported, help, version, no-argument behavior, every public subcommand, and representative aliases;
- unknown, missing, repeated, conflicting, empty, option-like, Unicode, very long, malformed, and boundary arguments, including `--` behavior;
- standard input as a TTY, pipe, redirected file, empty stream, closed stream, slow stream, malformed stream, and oversized stream where supported;
- standard output and standard error independently attached to a TTY, pipe, file, and closed consumer, with color, progress, paging, and prompts verified;
- exact exit statuses for success, help, usage error, invalid input, dependency failure, conflict, partial success, timeout, interrupt, and internal error;
- golden or schema validation for machine output, plus streaming, partial-write, locale, time-zone, ordering, escaping, and backward-compatibility cases;
- each configuration layer alone and in conflict, explicit clears, discovery roots, invalid configuration, permission boundaries, and a minimal clean environment;
- interrupts and termination during input, output, child work, remote work, and commit phases, including repeated signals, cleanup, and observable status;
- dry run, confirmation, noninteractive refusal, force flags, retries, concurrent invocations, stale plans, partial progress, and recovery against isolated fixtures;
- hostile paths, terminal control bytes, shell metacharacters, symlinks, untrusted configuration, secret canaries, and bounded-resource tests;
- clean installation, upgrade, downgrade policy, multiple versions, command collision, completion, manual, uninstall, and a clean consumer environment;
- every supported operating system, architecture, runtime boundary, process launcher, and minimum version claimed by the project.

Report exact artifacts, versions, environment, invocation, stream topology, signals, and outcomes. Calling an internal function does not prove argument parsing, executable lookup, stream behavior, packaging, or exit status. A human smoke test does not prove a machine-output contract.

## Primary references

- [POSIX.1-2024 Utility Conventions](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html)
- [POSIX.1-2024 Environment Variables](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap08.html)
- [GNU Coding Standards: Command-Line Interfaces](https://www.gnu.org/prep/standards/html_node/Command_002dLine-Interfaces.html)
- [RFC 8259: The JavaScript Object Notation Data Interchange Format](https://www.rfc-editor.org/rfc/rfc8259)
- [Microsoft Console Control Handlers](https://learn.microsoft.com/en-us/windows/console/handlerroutine)
