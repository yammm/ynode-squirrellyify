import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import Sqrl from "squirrelly";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const BLOCKED_RUNTIME_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const BUILTIN_CLIENT_HELPERS = new Set(["each", "foreach", "include", "useScope"]);
const UNSUPPORTED_HELPERS = new Set(["extends", "extendsFile", "includeFile"]);
const INVALID_CONDITIONAL_BLOCKS = new Set(["elseif", "elf"]);
const NATIVE_CLIENT_HELPERS = new Set(["if", "try"]);
const GENERATOR_CONSTRUCTORS = new Set(["GeneratorFunction", "AsyncGeneratorFunction"]);
const SOURCE_MAP_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * @typedef {object} ClientTemplateFile
 * @property {string} file Absolute or process-relative path to a Squirrelly template.
 *
 * @typedef {object} ClientTemplateSource
 * @property {string} source Inline Squirrelly template source.
 *
 * @typedef {ClientTemplateFile|ClientTemplateSource|string} ClientTemplateInput
 *
 * @typedef {object} CompileClientModuleOptions
 * @property {Record<string, ClientTemplateInput>} templates Named templates exposed through `render`.
 * @property {Record<string, Function>} [helpers] Browser-safe custom Squirrelly helpers.
 * @property {Record<string, Function>} [filters] Browser-safe custom Squirrelly filters.
 * @property {object} [config] Squirrelly compile configuration overrides.
 *
 * @typedef {object} BuildClientModuleInput
 * @property {string} output Generated ES module path.
 * @property {Record<string, ClientTemplateInput>} templates Named templates exposed through `render`.
 * @property {Record<string, Function>} [helpers] Browser-safe custom Squirrelly helpers.
 * @property {Record<string, Function>} [filters] Browser-safe custom Squirrelly filters.
 * @property {object} [config] Squirrelly compile configuration overrides.
 * @property {boolean|string} [declaration=true] Emit a declaration beside the module or at a custom path.
 * @property {boolean|string} [sourceMap=true] Emit a source map beside the module or at a custom path.
 *
 * @typedef {object} BuildClientModulesOptions
 * @property {Record<string, BuildClientModuleInput>} modules Named modules to compile and write.
 * @property {string} [cwd] Base directory for relative template and output paths.
 * @property {boolean} [check=false] Verify generated artifacts without writing them.
 *
 * @typedef {object} BuiltClientModule
 * @property {string} name Module name from the build configuration.
 * @property {string} output Absolute path to the generated module.
 * @property {number} bytes Generated module size in bytes.
 * @property {string} [declaration] Absolute path to the generated declaration.
 * @property {number} [declarationBytes] Generated declaration size in bytes.
 * @property {string} [sourceMap] Absolute path to the generated source map.
 * @property {number} [sourceMapBytes] Generated source map size in bytes.
 * @property {boolean} written Whether at least one artifact changed on disk.
 */

function assertPlainObject(value, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${label} must be a plain object.`);
    }
}

function assertRuntimeName(name, label, { identifier = false } = {}) {
    if (typeof name !== "string" || name.length === 0 || BLOCKED_RUNTIME_NAMES.has(name)) {
        throw new TypeError(`${label} contains an invalid name: ${String(name)}`);
    }
    if (identifier && !IDENTIFIER_PATTERN.test(name)) {
        throw new TypeError(`${label} name must be a valid JavaScript identifier: ${name}`);
    }
}

function parseFunctionExpression(source) {
    try {
        Function(`return (${source});`);
        return true;
    } catch {
        return false;
    }
}

function normalizedFunctionSource(name, fn, label, { allowAsync = false } = {}) {
    if (typeof fn !== "function") {
        throw new TypeError(`${label}.${name} must be a function.`);
    }

    const source = Function.prototype.toString.call(fn).trim();
    const constructorName = fn.constructor?.name;
    if (/^class(?:\s|{)/.test(source)) {
        throw new TypeError(`${label}.${name} must be a callable function, not a class.`);
    }
    if (GENERATOR_CONSTRUCTORS.has(constructorName)) {
        throw new TypeError(`${label}.${name} must not be a generator function.`);
    }

    const isAsync = constructorName === "AsyncFunction";
    if (isAsync && !allowAsync) {
        throw new TypeError(`${label}.${name} must be synchronous unless config.async is true.`);
    }

    if (parseFunctionExpression(source)) {
        return { source, async: isAsync };
    }

    const methodPrefix = source.replace(/^async\s+(?=[^=(])/u, "").trimStart();
    if (/^(?:get|set)\s/u.test(methodPrefix)) {
        throw new TypeError(`${label}.${name} must not be an accessor function.`);
    }
    if (methodPrefix.startsWith("[")) {
        throw new TypeError(`${label}.${name} must not use a computed method name.`);
    }

    const methodExpression = `Object.values({${source}})[0]`;
    if (parseFunctionExpression(methodExpression)) {
        return { source: methodExpression, async: isAsync };
    }

    throw new TypeError(`${label}.${name} must be serializable browser-safe JavaScript.`);
}

function serializeFunctions(values, label, blockedNames = new Set(), options = {}) {
    if (values === undefined) {
        return [];
    }
    assertPlainObject(values, label);
    return Object.keys(values)
        .sort()
        .map((name) => {
            assertRuntimeName(name, label);
            if (blockedNames.has(name)) {
                throw new TypeError(
                    `${label}.${name} cannot override a built-in client runtime function.`,
                );
            }
            return { name, ...normalizedFunctionSource(name, values[name], label, options) };
        });
}

async function readTemplate(input, name) {
    if (typeof input === "string") {
        return { source: input };
    }
    assertPlainObject(input, `templates.${name}`);
    const hasSource = typeof input.source === "string";
    const hasFile = typeof input.file === "string" && input.file.length > 0;
    if (hasSource === hasFile) {
        throw new TypeError(`templates.${name} must define exactly one of source or file.`);
    }
    if (hasSource) {
        return { source: input.source };
    }
    return { source: await fs.readFile(input.file, "utf8"), file: path.resolve(input.file) };
}

function validateTemplateAst(
    name,
    source,
    config,
    helperNames,
    filterNames,
    asyncHelpers,
    asyncFilters,
) {
    const ast = Sqrl.parse(source, config);
    function validateNodes(nodes) {
        let containsAwait = false;
        for (const node of nodes) {
            if (!node || typeof node !== "object") {
                continue;
            }
            if (node.t === "b" && INVALID_CONDITIONAL_BLOCKS.has(node.n)) {
                throw new TypeError(
                    `Template "${name}" uses invalid conditional block "${node.n}"; use "elif".`,
                );
            }

            let nodeContainsAwait = false;
            for (const [filterName, , markedAsync] of node.f ?? []) {
                if (!filterNames.has(filterName)) {
                    throw new TypeError(
                        `Template "${name}" uses client filter "${filterName}" without providing it.`,
                    );
                }
                if (asyncFilters.has(filterName) && !markedAsync) {
                    throw new TypeError(
                        `Template "${name}" must call async filter "${filterName}" with the Squirrelly async marker.`,
                    );
                }
                nodeContainsAwait ||= markedAsync === true;
            }

            if (node.t === "h" || node.t === "s") {
                if (UNSUPPORTED_HELPERS.has(node.n)) {
                    throw new TypeError(
                        `Template "${name}" uses unsupported client helper "${node.n}".`,
                    );
                }
                const supported =
                    NATIVE_CLIENT_HELPERS.has(node.n) ||
                    BUILTIN_CLIENT_HELPERS.has(node.n) ||
                    helperNames.has(node.n);
                if (!supported) {
                    throw new TypeError(
                        `Template "${name}" uses client helper "${node.n}" without providing it.`,
                    );
                }
                if (asyncHelpers.has(node.n) && !node.a) {
                    throw new TypeError(
                        `Template "${name}" must call async helper "${node.n}" with the Squirrelly async marker.`,
                    );
                }
                if (config.async && node.n === "include" && !node.a) {
                    throw new TypeError(
                        `Template "${name}" must call include with the Squirrelly async marker in an async client module.`,
                    );
                }
            }

            const bodyContainsAwait = validateNodes(node.d ?? []);
            const blocksContainAwait = validateNodes(node.b ?? []);
            const childContainsAwait = bodyContainsAwait || blocksContainAwait;
            if (
                node.t === "h" &&
                !NATIVE_CLIENT_HELPERS.has(node.n) &&
                childContainsAwait &&
                !node.a
            ) {
                throw new TypeError(
                    `Template "${name}" must mark helper "${node.n}" async because its body contains async rendering.`,
                );
            }
            nodeContainsAwait ||= node.a === true || childContainsAwait;
            containsAwait ||= nodeContainsAwait;
        }
        return containsAwait;
    }
    validateNodes(ast);
}

function compileConfig(overrides = {}) {
    assertPlainObject(overrides, "config");
    if (overrides.async !== undefined && typeof overrides.async !== "boolean") {
        throw new TypeError("config.async must be a boolean.");
    }
    if (overrides.useWith === true) {
        throw new TypeError("Client modules do not support Squirrelly useWith mode.");
    }
    if (overrides.plugins?.length) {
        throw new TypeError("Client modules do not support Squirrelly compiler plugins.");
    }
    if (overrides.storage !== undefined) {
        throw new TypeError("Client modules manage their own Squirrelly storage.");
    }
    if (overrides.varName !== undefined && overrides.varName !== "it") {
        throw new TypeError('Client modules require Squirrelly varName to remain "it".');
    }
    return Sqrl.getConfig(
        { ...overrides, async: overrides.async === true, useWith: false, varName: "it" },
        Sqrl.defaultConfig,
    );
}

function objectSource(entries) {
    return entries.map(({ name, source }) => `${JSON.stringify(name)}: ${source}`).join(",\n    ");
}

function runtimeSource(filterEntries, helperEntries) {
    const filters = objectSource(filterEntries);
    const helpers = objectSource(helperEntries);
    return `const escapeMap = Object.freeze({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });
function escapeHtml(value) {
    const text = String(value);
    return /[&<>"']/.test(text) ? text.replace(/[&<>"']/g, (character) => escapeMap[character]) : text;
}
function assertNoBlocks(name, blocks) {
    if (blocks.length > 0) throw new Error(\`Helper "\${name}" does not accept blocks.\`);
}
const templates = Object.create(null);
const filters = Object.freeze({
    "e": escapeHtml${filters ? `,\n    ${filters}` : ""}
});
const helpers = Object.freeze({
    "each": (content, blocks) => {
        assertNoBlocks("each", blocks);
        const rows = content.params[0];
        if (content.async) return (async () => {
            let result = "";
            for (let index = 0; index < rows.length; index += 1) result += await content.exec(rows[index], index);
            return result;
        })();
        let result = "";
        for (let index = 0; index < rows.length; index += 1) result += content.exec(rows[index], index);
        return result;
    },
    "foreach": (content, blocks) => {
        assertNoBlocks("foreach", blocks);
        const value = content.params[0] ?? {};
        if (content.async) return (async () => {
            let result = "";
            for (const key of Object.keys(value)) result += await content.exec(key, value[key]);
            return result;
        })();
        let result = "";
        for (const key of Object.keys(value)) result += content.exec(key, value[key]);
        return result;
    },
    "include": (content, blocks) => {
        assertNoBlocks("include", blocks);
        const template = templates[content.params[0]];
        if (!template) throw new Error(\`Could not fetch client template "\${content.params[0]}".\`);
        return template(content.params[1]);
    },
    "useScope": (content, blocks) => {
        assertNoBlocks("useScope", blocks);
        return content.exec(content.params[0]);
    }${helpers ? `,\n    ${helpers}` : ""}
});
const runtime = Object.freeze({
    l(container, name) {
        const store = container === "F" ? filters : container === "H" ? helpers : null;
        const value = store?.[name];
        if (!value) throw new Error(\`Could not fetch client \${container === "F" ? "filter" : "helper"} "\${name}".\`);
        return value;
    }
});`;
}

function advancePosition(position, text) {
    const lines = text.split("\n");
    if (lines.length === 1) {
        position.column += text.length;
        return;
    }
    position.line += lines.length - 1;
    position.column = lines.at(-1).length;
}

function instrumentTemplateSource(source, config, sourceIndex, namespace, markerRecords) {
    const [openTag, closeTag] = config.tags;
    const execPrefix = config.prefixes.e;
    const position = { line: 0, column: 0 };
    let cursor = 0;
    let instrumented = "";

    while (cursor < source.length) {
        const tagStart = source.indexOf(openTag, cursor);
        if (tagStart === -1) {
            instrumented += source.slice(cursor);
            break;
        }
        const tagEnd = source.indexOf(closeTag, tagStart + openTag.length);
        if (tagEnd === -1) {
            instrumented += source.slice(cursor);
            break;
        }

        const leading = source.slice(cursor, tagStart);
        instrumented += leading;
        advancePosition(position, leading);

        const markerId = markerRecords.length;
        markerRecords.push({
            sourceIndex,
            originalLine: position.line,
            originalColumn: position.column,
        });
        instrumented += `${openTag}${execPrefix}/*__SQUIRRELLYIFY_MAP_${namespace}_${markerId}__*/${closeTag}`;

        const tag = source.slice(tagStart, tagEnd + closeTag.length);
        instrumented += tag;
        advancePosition(position, tag);
        cursor = tagEnd + closeTag.length;
    }
    return instrumented;
}

function stripSourceMapMarkers(source, namespace, markerRecords) {
    const markerPattern = new RegExp(`/\\*__SQUIRRELLYIFY_MAP_${namespace}_(\\d+)__\\*/`, "g");
    const mappings = [];
    const position = { line: 0, column: 0 };
    let cursor = 0;
    let cleaned = "";
    let match;

    while ((match = markerPattern.exec(source)) !== null) {
        const leading = source.slice(cursor, match.index);
        cleaned += leading;
        advancePosition(position, leading);

        const nextCharacter = source[markerPattern.lastIndex];
        const generatedLine = position.line + (nextCharacter === "\n" ? 1 : 0);
        const generatedColumn = nextCharacter === "\n" ? 0 : position.column;
        mappings.push({
            generatedLine,
            generatedColumn,
            ...markerRecords[Number(match[1])],
        });
        cursor = markerPattern.lastIndex;
    }

    const trailing = source.slice(cursor);
    cleaned += trailing;
    return { source: cleaned, mappings };
}

function encodeVlq(value) {
    let encoded = "";
    let remaining = value < 0 ? (-value << 1) | 1 : value << 1;
    do {
        let digit = remaining & 31;
        remaining >>>= 5;
        if (remaining > 0) {
            digit |= 32;
        }
        encoded += SOURCE_MAP_BASE64[digit];
    } while (remaining > 0);
    return encoded;
}

function encodeSourceMapMappings(mappings) {
    if (mappings.length === 0) {
        return "";
    }
    const sorted = [...mappings].sort(
        (first, second) =>
            first.generatedLine - second.generatedLine ||
            first.generatedColumn - second.generatedColumn,
    );
    const lines = [];
    let previousSource = 0;
    let previousOriginalLine = 0;
    let previousOriginalColumn = 0;
    let mappingIndex = 0;

    for (let generatedLine = 0; generatedLine <= sorted.at(-1).generatedLine; generatedLine += 1) {
        const segments = [];
        let previousGeneratedColumn = 0;
        while (sorted[mappingIndex]?.generatedLine === generatedLine) {
            const mapping = sorted[mappingIndex];
            segments.push(
                encodeVlq(mapping.generatedColumn - previousGeneratedColumn) +
                    encodeVlq(mapping.sourceIndex - previousSource) +
                    encodeVlq(mapping.originalLine - previousOriginalLine) +
                    encodeVlq(mapping.originalColumn - previousOriginalColumn),
            );
            previousGeneratedColumn = mapping.generatedColumn;
            previousSource = mapping.sourceIndex;
            previousOriginalLine = mapping.originalLine;
            previousOriginalColumn = mapping.originalColumn;
            mappingIndex += 1;
        }
        lines.push(segments.join(","));
    }
    return lines.join(";");
}

function declarationSource(templateNames, isAsync) {
    const returnType = isAsync ? "Promise<string>" : "string";
    const renderers = templateNames
        .map((name) => `    ${name}(data: Record<string, unknown>): ${returnType};`)
        .join("\n");
    return `// Generated by @ynode/squirrellyify. Do not edit.\nexport declare const render: Readonly<{\n${renderers}\n}>;\n`;
}

async function compileClientModuleArtifacts(options = {}) {
    assertPlainObject(options, "options");
    assertPlainObject(options.templates, "templates");
    const templateNames = Object.keys(options.templates).sort();
    if (templateNames.length === 0) {
        throw new TypeError("templates must contain at least one named template.");
    }
    for (const name of templateNames) {
        assertRuntimeName(name, "templates", { identifier: true });
    }

    const config = compileConfig(options.config ?? {});
    const serializationOptions = { allowAsync: config.async };
    const filterEntries = serializeFunctions(
        options.filters,
        "filters",
        new Set(["e"]),
        serializationOptions,
    );
    const helperEntries = serializeFunctions(
        options.helpers,
        "helpers",
        BUILTIN_CLIENT_HELPERS,
        serializationOptions,
    );
    const filterNames = new Set(["e", ...filterEntries.map(({ name }) => name)]);
    const helperNames = new Set(helperEntries.map(({ name }) => name));
    const asyncFilters = new Set(
        filterEntries.filter((entry) => entry.async).map(({ name }) => name),
    );
    const asyncHelpers = new Set(
        helperEntries.filter((entry) => entry.async).map(({ name }) => name),
    );
    const templatesWithSource = [];
    for (const name of templateNames) {
        templatesWithSource.push({ name, ...(await readTemplate(options.templates[name], name)) });
    }

    const namespace = createHash("sha256")
        .update(templatesWithSource.map(({ name, source }) => `${name}\0${source}`).join("\0"))
        .digest("hex")
        .slice(0, 16);
    const markerRecords = [];
    const compiled = [];
    for (const [sourceIndex, template] of templatesWithSource.entries()) {
        validateTemplateAst(
            template.name,
            template.source,
            config,
            helperNames,
            filterNames,
            asyncHelpers,
            asyncFilters,
        );
        const instrumented = instrumentTemplateSource(
            template.source,
            config,
            sourceIndex,
            namespace,
            markerRecords,
        );
        compiled.push([template.name, Sqrl.compileToString(instrumented, config)]);
    }

    const asyncKeyword = config.async ? "async " : "";
    const templateFunctions = compiled
        .map(
            ([name, body]) =>
                `templates[${JSON.stringify(name)}] = ${asyncKeyword}function ${name}Template(it, c = runtime, cb) {\n${body}\n};`,
        )
        .join("\n");
    const renderEntries = templateNames
        .map((name) => `${name}: (data) => templates.${name}(data)`)
        .join(",\n    ");
    const markedSource = `// Generated by @ynode/squirrellyify. Do not edit.\n${runtimeSource(filterEntries, helperEntries)}\n${templateFunctions}\nexport const render = Object.freeze({\n    ${renderEntries}\n});\n`;
    const generated = stripSourceMapMarkers(markedSource, namespace, markerRecords);

    return {
        source: generated.source,
        declaration: declarationSource(templateNames, config.async),
        sourceMap: {
            mappings: encodeSourceMapMappings(generated.mappings),
            sources: templatesWithSource,
        },
    };
}

/**
 * Compiles named Squirrelly templates into one self-contained browser ES module.
 * The generated module exports a frozen `render` object whose keys match the
 * supplied template names. Compilation happens in Node; generated modules do
 * not use eval or `new Function` in the browser.
 *
 * Custom helpers and filters must be pure, browser-safe, serializable functions.
 * They cannot depend on Node APIs or closed-over values.
 *
 * @param {CompileClientModuleOptions} options Compilation options.
 * @returns {Promise<string>} Deterministic JavaScript module source.
 */
export async function compileClientModule(options = {}) {
    return (await compileClientModuleArtifacts(options)).source;
}

function resolveBuildTemplates(templates, cwd) {
    assertPlainObject(templates, "templates");
    return Object.fromEntries(
        Object.entries(templates).map(([name, input]) => {
            if (typeof input === "string" || typeof input?.source === "string") {
                return [name, input];
            }
            if (typeof input?.file === "string") {
                return [name, { file: path.resolve(cwd, input.file) }];
            }
            return [name, input];
        }),
    );
}

function defaultDeclarationPath(output) {
    return /\.(?:c|m)?js$/iu.test(output)
        ? output.replace(/\.(?:c|m)?js$/iu, ".d.ts")
        : `${output}.d.ts`;
}

function resolveOptionalArtifactPath(value, fallback, cwd, label) {
    if (value === undefined || value === true) {
        return fallback;
    }
    if (value === false) {
        return null;
    }
    if (typeof value !== "string" || value.length === 0) {
        throw new TypeError(`${label} must be a boolean or non-empty path.`);
    }
    return path.resolve(cwd, value);
}

function normalizePath(value) {
    return value.split(path.sep).join("/");
}

function encodeRelativeUrl(value) {
    return normalizePath(value)
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
}

function sourceMapSource(module, compiled) {
    const mapDirectory = path.dirname(module.sourceMap);
    const sourceMap = {
        version: 3,
        file: normalizePath(path.relative(mapDirectory, module.output)),
        sources: compiled.sourceMap.sources.map((source) =>
            source.file
                ? normalizePath(path.relative(mapDirectory, source.file))
                : `squirrellyify:///${encodeURIComponent(module.name)}/${encodeURIComponent(source.name)}.sqrl`,
        ),
        sourcesContent: compiled.sourceMap.sources.map(({ source }) => source),
        names: [],
        mappings: compiled.sourceMap.mappings,
    };
    return `${JSON.stringify(sourceMap)}\n`;
}

async function readExistingSource(file) {
    try {
        return await fs.readFile(file, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function writeArtifactsAtomically(artifacts) {
    const staged = [];
    try {
        for (const artifact of artifacts) {
            await fs.mkdir(path.dirname(artifact.path), { recursive: true });
            const temporaryPath = `${artifact.path}.${process.pid}.${randomUUID()}.tmp`;
            await fs.writeFile(temporaryPath, artifact.source, "utf8");
            staged.push({ ...artifact, temporaryPath });
        }
        for (const artifact of staged) {
            await fs.rename(artifact.temporaryPath, artifact.path);
        }
    } catch (error) {
        await Promise.all(staged.map(({ temporaryPath }) => fs.rm(temporaryPath, { force: true })));
        throw error;
    }
}

/**
 * Compiles and writes multiple static client render modules for an asset build.
 * Relative template and output paths resolve from `cwd`, which defaults to the
 * current working directory. Changed artifacts are staged before atomic replacement;
 * byte-identical files are left untouched.
 *
 * @param {BuildClientModulesOptions} options Build configuration.
 * @returns {Promise<BuiltClientModule[]>} Generated module metadata.
 */
export async function buildClientModules(options = {}) {
    assertPlainObject(options, "options");
    assertPlainObject(options.modules, "modules");
    if (options.check !== undefined && typeof options.check !== "boolean") {
        throw new TypeError("check must be a boolean.");
    }
    const moduleNames = Object.keys(options.modules).sort();
    if (moduleNames.length === 0) {
        throw new TypeError("modules must contain at least one named client module.");
    }

    const cwd = path.resolve(options.cwd ?? process.cwd());
    const artifactPaths = new Map();
    const modules = moduleNames.map((name) => {
        assertRuntimeName(name, "modules");
        const input = options.modules[name];
        assertPlainObject(input, `modules.${name}`);
        if (typeof input.output !== "string" || input.output.length === 0) {
            throw new TypeError(`modules.${name}.output must be a non-empty path.`);
        }
        const output = path.resolve(cwd, input.output);
        const declaration = resolveOptionalArtifactPath(
            input.declaration,
            defaultDeclarationPath(output),
            cwd,
            `modules.${name}.declaration`,
        );
        const sourceMap = resolveOptionalArtifactPath(
            input.sourceMap,
            `${output}.map`,
            cwd,
            `modules.${name}.sourceMap`,
        );
        const module = {
            name,
            output,
            declaration,
            sourceMap,
            compile: {
                templates: resolveBuildTemplates(input.templates, cwd),
                helpers: input.helpers,
                filters: input.filters,
                config: input.config,
            },
        };
        for (const [kind, artifactPath] of [
            ["output", output],
            ["declaration", declaration],
            ["source map", sourceMap],
        ]) {
            if (!artifactPath) {
                continue;
            }
            const owner = artifactPaths.get(artifactPath);
            if (owner) {
                throw new TypeError(
                    `Client module artifact collision at ${artifactPath}: ${owner} and modules.${name}.${kind}.`,
                );
            }
            artifactPaths.set(artifactPath, `modules.${name}.${kind}`);
        }
        return module;
    });

    const generated = [];
    for (const module of modules) {
        const compiled = await compileClientModuleArtifacts(module.compile);
        const artifacts = [];
        let outputSource = compiled.source;
        let sourceMapContents = null;
        if (module.sourceMap) {
            sourceMapContents = sourceMapSource(module, compiled);
            const sourceMapUrl = encodeRelativeUrl(
                path.relative(path.dirname(module.output), module.sourceMap),
            );
            outputSource += `//# sourceMappingURL=${sourceMapUrl}\n`;
        }
        artifacts.push({ kind: "output", path: module.output, source: outputSource });
        if (module.declaration) {
            artifacts.push({
                kind: "declaration",
                path: module.declaration,
                source: compiled.declaration,
            });
        }
        if (module.sourceMap) {
            artifacts.push({
                kind: "sourceMap",
                path: module.sourceMap,
                source: sourceMapContents,
            });
        }
        generated.push({ ...module, artifacts });
    }

    const staleArtifacts = [];
    for (const module of generated) {
        for (const artifact of module.artifacts) {
            artifact.stale = (await readExistingSource(artifact.path)) !== artifact.source;
            if (artifact.stale) {
                staleArtifacts.push(artifact);
            }
        }
    }

    if (options.check && staleArtifacts.length > 0) {
        const error = new Error(
            `Client module build is out of date:\n${staleArtifacts.map(({ path: artifactPath }) => `- ${artifactPath}`).join("\n")}`,
        );
        error.code = "ERR_CLIENT_MODULES_OUT_OF_DATE";
        error.stale = staleArtifacts.map(({ path: artifactPath }) => artifactPath);
        throw error;
    }
    if (!options.check && staleArtifacts.length > 0) {
        await writeArtifactsAtomically(staleArtifacts);
    }

    return generated.map((module) => {
        const outputArtifact = module.artifacts.find(({ kind }) => kind === "output");
        const declarationArtifact = module.artifacts.find(({ kind }) => kind === "declaration");
        const sourceMapArtifact = module.artifacts.find(({ kind }) => kind === "sourceMap");
        return {
            name: module.name,
            output: module.output,
            bytes: Buffer.byteLength(outputArtifact.source),
            ...(declarationArtifact && {
                declaration: declarationArtifact.path,
                declarationBytes: Buffer.byteLength(declarationArtifact.source),
            }),
            ...(sourceMapArtifact && {
                sourceMap: sourceMapArtifact.path,
                sourceMapBytes: Buffer.byteLength(sourceMapArtifact.source),
            }),
            written: !options.check && module.artifacts.some(({ stale }) => stale),
        };
    });
}
