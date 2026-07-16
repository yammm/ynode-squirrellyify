import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import Sqrl from "squirrelly";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const BLOCKED_RUNTIME_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const BUILTIN_CLIENT_HELPERS = new Set(["each", "foreach", "include", "useScope"]);
const UNSUPPORTED_HELPERS = new Set(["extends", "extendsFile", "includeFile"]);
const INVALID_CONDITIONAL_BLOCKS = new Set(["elseif", "elf"]);

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
 *
 * @typedef {object} BuildClientModulesOptions
 * @property {Record<string, BuildClientModuleInput>} modules Named modules to compile and write.
 * @property {string} [cwd] Base directory for relative template and output paths.
 *
 * @typedef {object} BuiltClientModule
 * @property {string} name Module name from the build configuration.
 * @property {string} output Absolute path to the generated module.
 * @property {number} bytes Generated module size in bytes.
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

function normalizedFunctionSource(name, fn, label) {
    if (typeof fn !== "function") {
        throw new TypeError(`${label}.${name} must be a function.`);
    }

    const source = Function.prototype.toString.call(fn).trim();
    if (source.includes("[native code]")) {
        throw new TypeError(`${label}.${name} must be serializable JavaScript.`);
    }
    const constructorName = fn.constructor?.name;
    if (
        constructorName === "AsyncFunction" ||
        constructorName === "AsyncGeneratorFunction" ||
        /^async\b/.test(source)
    ) {
        throw new TypeError(`${label}.${name} must be synchronous.`);
    }

    // Function declarations and arrows stringify as standalone expressions,
    // while object method shorthand stringifies without the `function`
    // keyword. Guessing the form from the source is fragile — an arrow inside
    // a shorthand body reads as an arrow function — so let the parser decide:
    // use the source as written when it parses, and fall back to the
    // `function`-prefixed form for method shorthand.
    let lastError = null;
    for (const candidate of [source, `function ${source}`]) {
        try {
            Function(`return (${candidate});`);
            return candidate;
        } catch (error) {
            lastError = error;
        }
    }
    throw new TypeError(`${label}.${name} could not be serialized: ${lastError.message}`, {
        cause: lastError,
    });
}

function serializeFunctions(values, label, blockedNames = new Set()) {
    if (values === undefined) {
        return [];
    }
    assertPlainObject(values, label);
    return Object.keys(values)
        .sort()
        .map((name) => {
            assertRuntimeName(name, label);
            if (blockedNames.has(name)) {
                throw new TypeError(`${label}.${name} cannot override a built-in client runtime function.`);
            }
            return [name, normalizedFunctionSource(name, values[name], label)];
        });
}

async function readTemplate(input, name) {
    if (typeof input === "string") {
        return input;
    }
    assertPlainObject(input, `templates.${name}`);
    const hasSource = typeof input.source === "string";
    const hasFile = typeof input.file === "string" && input.file.length > 0;
    if (hasSource === hasFile) {
        throw new TypeError(`templates.${name} must define exactly one of source or file.`);
    }
    return hasSource ? input.source : fs.readFile(input.file, "utf8");
}

function walkAst(nodes, visitor) {
    for (const node of nodes) {
        if (!node || typeof node !== "object") {
            continue;
        }
        visitor(node);
        if (Array.isArray(node.d)) {
            walkAst(node.d, visitor);
        }
        if (Array.isArray(node.b)) {
            walkAst(node.b, visitor);
        }
    }
}

function validateTemplateAst(name, source, config, helperNames, filterNames) {
    const ast = Sqrl.parse(source, config);
    walkAst(ast, (node) => {
        if (node.t === "b" && INVALID_CONDITIONAL_BLOCKS.has(node.n)) {
            throw new TypeError(`Template "${name}" uses invalid conditional block "${node.n}"; use "elif".`);
        }
        if ((node.t === "h" || node.t === "s") && UNSUPPORTED_HELPERS.has(node.n)) {
            throw new TypeError(`Template "${name}" uses unsupported client helper "${node.n}".`);
        }
        if (node.t === "h" || node.t === "s") {
            const supported =
                ["if", "try"].includes(node.n) || BUILTIN_CLIENT_HELPERS.has(node.n) || helperNames.has(node.n);
            if (!supported) {
                throw new TypeError(`Template "${name}" uses client helper "${node.n}" without providing it.`);
            }
        }
        for (const [filterName] of node.f ?? []) {
            if (!filterNames.has(filterName)) {
                throw new TypeError(`Template "${name}" uses client filter "${filterName}" without providing it.`);
            }
        }
    });
}

function compileConfig(overrides = {}) {
    assertPlainObject(overrides, "config");
    if (overrides.async === true) {
        throw new TypeError("Client modules do not support async Squirrelly templates.");
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
    return Sqrl.getConfig({ ...overrides, async: false, useWith: false, varName: "it" }, Sqrl.defaultConfig);
}

function objectSource(entries) {
    return entries.map(([name, source]) => `${JSON.stringify(name)}: ${source}`).join(",\n    ");
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
        let result = "";
        const rows = content.params[0];
        for (let index = 0; index < rows.length; index += 1) result += content.exec(rows[index], index);
        return result;
    },
    "foreach": (content, blocks) => {
        assertNoBlocks("foreach", blocks);
        let result = "";
        const value = content.params[0] ?? {};
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
    assertPlainObject(options, "options");
    assertPlainObject(options.templates, "templates");
    const templateNames = Object.keys(options.templates).sort();
    if (templateNames.length === 0) {
        throw new TypeError("templates must contain at least one named template.");
    }
    for (const name of templateNames) {
        assertRuntimeName(name, "templates", { identifier: true });
    }

    const filterEntries = serializeFunctions(options.filters, "filters", new Set(["e"]));
    const helperEntries = serializeFunctions(options.helpers, "helpers", BUILTIN_CLIENT_HELPERS);
    const filterNames = new Set(["e", ...filterEntries.map(([name]) => name)]);
    const helperNames = new Set(helperEntries.map(([name]) => name));
    const config = compileConfig(options.config ?? {});
    const compiled = [];
    for (const name of templateNames) {
        const source = await readTemplate(options.templates[name], name);
        validateTemplateAst(name, source, config, helperNames, filterNames);
        compiled.push([name, Sqrl.compileToString(source, config)]);
    }

    const templateFunctions = compiled
        .map(
            ([name, body]) =>
                `templates[${JSON.stringify(name)}] = function ${name}Template(it, c = runtime, cb) {\n${body}\n};`,
        )
        .join("\n");
    const renderEntries = templateNames.map((name) => `${name}: (data) => templates.${name}(data)`).join(",\n    ");

    return `// Generated by @ynode/squirrellyify. Do not edit.\n${runtimeSource(filterEntries, helperEntries)}\n${templateFunctions}\nexport const render = Object.freeze({\n    ${renderEntries}\n});\n`;
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

/**
 * Compiles and writes multiple static client render modules for an asset build.
 * Relative template and output paths resolve from `cwd`, which defaults to the
 * current working directory. Existing output files are replaced atomically.
 *
 * @param {BuildClientModulesOptions} options Build configuration.
 * @returns {Promise<BuiltClientModule[]>} Generated module metadata.
 */
export async function buildClientModules(options = {}) {
    assertPlainObject(options, "options");
    assertPlainObject(options.modules, "modules");
    const moduleNames = Object.keys(options.modules).sort();
    if (moduleNames.length === 0) {
        throw new TypeError("modules must contain at least one named client module.");
    }

    const cwd = path.resolve(options.cwd ?? process.cwd());
    const outputs = new Set();
    const modules = moduleNames.map((name) => {
        assertRuntimeName(name, "modules");
        const input = options.modules[name];
        assertPlainObject(input, `modules.${name}`);
        if (typeof input.output !== "string" || input.output.length === 0) {
            throw new TypeError(`modules.${name}.output must be a non-empty path.`);
        }
        const output = path.resolve(cwd, input.output);
        if (outputs.has(output)) {
            throw new TypeError(`Multiple client modules target the same output: ${output}`);
        }
        outputs.add(output);
        return {
            name,
            output,
            compile: {
                templates: resolveBuildTemplates(input.templates, cwd),
                helpers: input.helpers,
                filters: input.filters,
                config: input.config,
            },
        };
    });

    const generated = [];
    for (const module of modules) {
        const source = await compileClientModule(module.compile);
        generated.push({ ...module, source });
    }

    const built = [];
    for (const module of generated) {
        const temporaryOutput = `${module.output}.${process.pid}.${randomUUID()}.tmp`;
        await fs.mkdir(path.dirname(module.output), { recursive: true });
        try {
            await fs.writeFile(temporaryOutput, module.source, "utf8");
            await fs.rename(temporaryOutput, module.output);
        } catch (error) {
            await fs.rm(temporaryOutput, { force: true });
            throw error;
        }
        built.push({
            name: module.name,
            output: module.output,
            bytes: Buffer.byteLength(module.source),
        });
    }
    return built;
}
