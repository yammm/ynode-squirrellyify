import fs from "node:fs/promises";
import path from "node:path";

import Sqrl from "squirrelly";

function trimSlashes(value) {
    return value.replace(/^\/+|\/+$/g, "");
}

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

function resolvePartialName(partialPath, partialsDir, extensionWithDot, namespace) {
    const relativePath = path.relative(partialsDir, partialPath);
    const withoutExt = relativePath.slice(0, -extensionWithDot.length);
    const normalizedName = withoutExt.split(path.sep).join("/");
    return namespace ? `${namespace}/${normalizedName}` : normalizedName;
}

/**
 * Preload partial templates and define them in the configured Sqrl template store.
 *
 * @param {object} options
 * @param {string[]} options.partialsDirs
 * @param {string} options.extensionWithDot
 * @param {boolean} [options.partialsRecursive=true]
 * @param {boolean|string} [options.partialsNamespace=false]
 * @param {object} options.fastify
 * @param {Function} options.defineSqrlTemplate
 * @param {object} options.sqrlConfig
 * @returns {Promise<void>}
 */
export async function preloadPartials({
    partialsDirs,
    extensionWithDot,
    partialsRecursive = true,
    partialsNamespace = false,
    fastify,
    defineSqrlTemplate,
    sqrlConfig,
}) {
    if (partialsDirs.length === 0) {
        return;
    }

    for (const partialsDir of partialsDirs) {
        try {
            const namespace = resolvePartialsNamespace(partialsNamespace, partialsDir);
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

    async function findTemplatePath(templateName, searchDirs) {
        const templateFile = `${templateName}${extensionWithDot}`;
        const cacheKey = `${searchDirs.join(";")}:${templateFile}`;

        if (useCache && pathCache.has(cacheKey)) {
            return pathCache.get(cacheKey);
        }

        for (const dir of searchDirs) {
            const fullPath = path.join(dir, templateFile);
            try {
                await fs.access(fullPath);
                if (useCache) {
                    pathCache.set(cacheKey, fullPath);
                }
                return fullPath;
            } catch (error) {
                fastify.log.trace(error);
            }
        }

        return null;
    }

    async function getTemplate(templatePath) {
        if (useCache && templateCache.has(templatePath)) {
            return templateCache.get(templatePath);
        }

        const content = await fs.readFile(templatePath, "utf-8");
        const compiled = Sqrl.compile(content, sqrlConfig);
        const hasLayoutTag = /{{\s*(?:@\s*extends|!layout)\s*\(/.test(content);
        templateMeta.set(templatePath, { hasLayoutTag });

        if (useCache) {
            templateCache.set(templatePath, compiled);
        }

        return compiled;
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
