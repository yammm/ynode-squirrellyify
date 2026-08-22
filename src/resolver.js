import fs from "node:fs/promises";
import path from "node:path";

import Sqrl from "squirrelly";

/**
 * Strips leading and trailing forward slashes from a string.
 * @param {string} value - Input string.
 * @returns {string} Trimmed string.
 */
function trimSlashes(value) {
    return value.replace(/^\/+|\/+$/g, "");
}

/**
 * Resolves the namespace prefix for partial templates.
 * @param {boolean|string} partialsNamespace - Namespace setting (true = dir basename, string = literal).
 * @param {string} partialsDir - Partials directory path (used when namespace is `true`).
 * @returns {string} Resolved namespace prefix, or empty string for no namespace.
 */
function resolvePartialsNamespace(partialsNamespace, partialsDir) {
    if (!partialsNamespace) {
        return "";
    }
    if (partialsNamespace === true) {
        return trimSlashes(path.basename(path.resolve(partialsDir)));
    }
    if (typeof partialsNamespace === "string") {
        return trimSlashes(partialsNamespace.split("\\").join("/"));
    }
    return "";
}

/**
 * Recursively collects all template files matching the given extension from a directory.
 * @param {string} dir - Directory to scan.
 * @param {string} extensionWithDot - File extension to match (e.g. ".sqrl").
 * @param {boolean} recursive - Whether to descend into subdirectories.
 * @returns {Promise<string[]>} Array of absolute file paths.
 */
async function collectPartialFiles(dir, extensionWithDot, recursive) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (recursive) {
                files.push(...(await collectPartialFiles(fullPath, extensionWithDot, recursive)));
            }
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(extensionWithDot)) {
            files.push(fullPath);
        }
    }

    return files;
}

/**
 * Derives the Squirrelly partial name from a file path, relative to its partials directory.
 * @param {string} partialPath - Absolute path to the partial file.
 * @param {string} partialsDir - Base partials directory.
 * @param {string} extensionWithDot - File extension to strip (e.g. ".sqrl").
 * @param {string} namespace - Optional namespace prefix.
 * @returns {string} Partial name suitable for Sqrl.templates.define().
 */
function resolvePartialName(partialPath, partialsDir, extensionWithDot, namespace) {
    const relativePath = path.relative(partialsDir, partialPath);
    const withoutExt = relativePath.slice(0, -extensionWithDot.length);
    const normalizedName = withoutExt.split(path.sep).join("/");
    return namespace ? `${namespace}/${normalizedName}` : normalizedName;
}

/**
 * Preload partial templates and define them in the configured Sqrl template store.
 *
 * Each entry may carry its own namespace, which overrides the registration-wide
 * `partialsNamespace` setting for that directory only.
 *
 * @param {object} options
 * @param {PartialsDirEntry[]} options.partialsEntries
 * @param {string} options.extensionWithDot
 * @param {boolean} [options.partialsRecursive=true]
 * @param {boolean|string} [options.partialsNamespace=false]
 * @param {object} options.fastify
 * @param {function(string, *): void} options.defineSqrlTemplate
 * @param {object} options.sqrlConfig
 * @returns {Promise<void>}
 */
export async function preloadPartials({
    partialsEntries,
    extensionWithDot,
    partialsRecursive = true,
    partialsNamespace = false,
    fastify,
    defineSqrlTemplate,
    sqrlConfig,
}) {
    if (partialsEntries.length === 0) {
        return;
    }

    for (const { dir: partialsDir, namespace: entryNamespace } of partialsEntries) {
        try {
            const namespace = resolvePartialsNamespace(
                entryNamespace ?? partialsNamespace,
                partialsDir,
            );
            const files = await collectPartialFiles(
                partialsDir,
                extensionWithDot,
                partialsRecursive,
            );
            await Promise.all(
                files.map(async (partialPath) => {
                    const partialName = resolvePartialName(
                        partialPath,
                        partialsDir,
                        extensionWithDot,
                        namespace,
                    );
                    const content = await fs.readFile(partialPath, "utf-8");
                    fastify.log.trace(`Loaded partial: ${partialName}`);
                    defineSqrlTemplate(partialName, Sqrl.compile(content, sqrlConfig));
                }),
            );
        } catch (error) {
            fastify.log.error(`Error loading partials from ${partialsDir}: ${error.message}`);
            throw error;
        }
    }
}

/**
 * Collect encapsulated view dirs and layout overrides from current Fastify scope chain.
 *
 * @param {object} instance
 * @returns {{ aggregatedTemplatesDirs: string[], scopedLayout: string|null }}
 */
export function collectViewScope(instance) {
    const aggregatedTemplatesDirs = [];
    let scopedLayout = null;
    let currentInstance = instance;

    while (currentInstance) {
        if (currentInstance.views) {
            const dirs = Array.isArray(currentInstance.views)
                ? currentInstance.views
                : [currentInstance.views];
            aggregatedTemplatesDirs.push(...dirs);
        }
        if (
            scopedLayout === null &&
            currentInstance.layout !== null &&
            currentInstance.layout !== undefined
        ) {
            scopedLayout = currentInstance.layout;
        }
        currentInstance = currentInstance.parent ?? null;
    }

    return {
        aggregatedTemplatesDirs,
        scopedLayout,
    };
}

/**
 * Merge initial template dirs with encapsulated scoped dirs.
 *
 * @param {string[]} scopedDirs
 * @param {string[]} initialDirs
 * @returns {string[]}
 */
export function buildTemplateSearchDirs(scopedDirs, initialDirs) {
    return [...new Set([...scopedDirs, ...initialDirs])];
}

/**
 * Matches layout-managing tags: an `@extends` helper or a `layout()` execution
 * call, with optional whitespace and `{{-` / `{{_` trim openers. The
 * whitespace tolerance matters because @ynode/sqrl-lint normalizes execution
 * tags to `{{! layout("x") }}` — with a space after the prefix.
 */
const LAYOUT_TAG_PATTERN = /{{[-_]?\s*(?:@\s*extends|!\s*layout)\s*\(/;

/**
 * Detect whether template source manages its own layout.
 *
 * @param {string} content - Raw template source.
 * @returns {boolean} Whether the template declares its own layout tag.
 */
export function detectLayoutTag(content) {
    return LAYOUT_TAG_PATTERN.test(content);
}

/**
 * Build cached template loader / path resolver.
 *
 * @param {object} options
 * @param {object} options.fastify
 * @param {string} options.extensionWithDot
 * @param {boolean} options.useCache
 * @param {object} options.sqrlConfig
 * @returns {object}
 */
export function createTemplateResolver({ fastify, extensionWithDot, useCache, sqrlConfig }) {
    const templateCache = new Map();
    const pathCache = new Map();
    const templateMeta = new Map();

    function compileAndCache(fullPath, content) {
        const compiled = Sqrl.compile(content, sqrlConfig);
        const hasLayoutTag = detectLayoutTag(content);
        templateMeta.set(fullPath, { hasLayoutTag });
        // Always retain the compiled template. With caching disabled the
        // path cache stays off, so every request still re-reads the file
        // through findTemplatePath and recompiles it — this entry simply
        // hands that fresh result to the getTemplate call that follows,
        // instead of paying a second read and compile of the same file.
        templateCache.set(fullPath, compiled);
        return compiled;
    }

    async function findTemplatePath(templateName, searchDirs) {
        const templateFile = `${templateName}${extensionWithDot}`;
        // NUL never appears in file paths, so joined directory lists cannot
        // collide the way a printable separator could.
        const cacheKey = `${searchDirs.join("\0")}\0:${templateFile}`;

        if (useCache && pathCache.has(cacheKey)) {
            return pathCache.get(cacheKey);
        }

        for (const dir of searchDirs) {
            const fullPath = path.join(dir, templateFile);
            // A single read attempt — ENOENT means "not in this dir, try
            // the next." Any other error (EACCES, EMFILE, EISDIR, ENOTDIR,
            // etc.) propagates instead of being silently treated as
            // "missing", and there is no access-then-read TOCTOU window
            // where a symlink swap could substitute arbitrary content.
            let content;
            try {
                content = await fs.readFile(fullPath, "utf-8");
            } catch (err) {
                if (err?.code === "ENOENT") {
                    continue;
                }
                throw err;
            }

            compileAndCache(fullPath, content);
            if (useCache) {
                pathCache.set(cacheKey, fullPath);
            }
            return fullPath;
        }

        return null;
    }

    async function getTemplate(templatePath) {
        if (templateCache.has(templatePath)) {
            return templateCache.get(templatePath);
        }

        // Cache miss path. ENOENT here means the file disappeared between
        // findTemplatePath returning and getTemplate being called — surface
        // it instead of swallowing.
        const content = await fs.readFile(templatePath, "utf-8");
        return compileAndCache(templatePath, content);
    }

    function hasLayoutTag(templatePath) {
        return templateMeta.get(templatePath)?.hasLayoutTag === true;
    }

    function clearCaches() {
        templateCache.clear();
        pathCache.clear();
        templateMeta.clear();
    }

    function cacheStats() {
        return {
            enabled: useCache,
            templates: templateCache.size,
            paths: pathCache.size,
            metadata: templateMeta.size,
        };
    }

    return {
        findTemplatePath,
        getTemplate,
        hasLayoutTag,
        clearCaches,
        cacheStats,
    };
}
