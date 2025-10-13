/**
 *  A Squirrelly Fastify plugin
 *
 * @module @ynode/squirrellyify
 */

/*
The MIT License (MIT)

Copyright (c) 2025 Michael Welter <me@mikinho.com>

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import fs from "node:fs/promises";
import path from "node:path";

import fp from "fastify-plugin";
import Sqrl from "squirrelly";

/**
 * @typedef {import("fastify").FastifyInstance} FastifyInstance
 * @typedef {import("fastify").FastifyReply} FastifyReply
 * @typedef {import("squirrelly").SqrlConfig} SqrlConfig
 */

/**
 * This plugin adds a "view" decorator to the Fastify reply object,
 * allowing for the rendering of Squirrelly templates with support for layouts and partials.
 *
 * @param {FastifyInstance} fastify The Fastify instance.
 * @param {object} options Plugin options.
 * @param {string|string[]} [options.templates] The directory or directories where page and layout templates are stored. Defaults to "views". Directories are searched in order.
 * @param {string|string[]} [options.partials] The directory or directories where partial templates are stored.
 * @param {string} [options.layout] The name of the default layout file to use (without extension).
 * @param {string} [options.defaultExtension="sqrl"] The default extension for template files.
 * @param {boolean} [options.cache] Enables template caching. Defaults to true if NODE_ENV is "production".
 */
async function squirrellyify(fastify, options = {}) {
    // Get initial options and set defaults from the plugin registration
    const initialTemplatesDirs = Array.isArray(options.templates)
        ? options.templates
        : typeof options.templates === "string"
            ? [options.templates]
            : [path.join(process.cwd(), "views")];

    const initialPartialsDirs = Array.isArray(options.partials)
        ? options.partials
        : typeof options.partials === "string"
            ? [options.partials]
            : [];

    const initialLayout = options.layout;
    const defaultExtension = options.defaultExtension || "sqrl";
    const extensionWithDot = `.${defaultExtension}`;
    const useCache = options.cache ?? process.env.NODE_ENV === "production";
    const templateCache = new Map();
    const pathCache = new Map();
    const templateMeta = new Map();

    // Allow passing optional Squirrelly compile/render configuration
    const sqrlConfig = options.sqrl?.config;

    // Allow Passing Custom Squirrelly Configuration
    if (options.sqrl) {
        if (options.sqrl.helpers) {
            Object.entries(options.sqrl.helpers).forEach(([name, fn]) => {
                Sqrl.helpers.define(name, fn);
            });
        }
        if (options.sqrl.filters) {
            Object.entries(options.sqrl.filters).forEach(([name, fn]) => {
                Sqrl.filters.define(name, fn);
            });
        }
    }

    // Pre-load and define all partials globally on startup from all partial directories
    if (initialPartialsDirs.length > 0) {
        for (const partialsDir of initialPartialsDirs) {
            try {
                const files = await fs.readdir(partialsDir);
                await Promise.all(
                    files.map(async (file) => {
                        if (file.endsWith(extensionWithDot)) {
                            const partialPath = path.join(partialsDir, file);
                            const partialName = path.basename(file, extensionWithDot);
                            const content = await fs.readFile(partialPath, "utf-8");
                            fastify.log.trace(`Loaded partial: ${partialName}`);
                            Sqrl.templates.define(partialName, Sqrl.compile(content, sqrlConfig));
                        }
                    }),
                );
            } catch (error) {
                fastify.log.error(`Error loading partials from ${partialsDir}: ${error.message}`);
                throw error;
            }
        }
    }

    /**
     * Compiles a template from a file path and caches it if enabled.
     */
    async function getTemplate(templatePath) {
        if (useCache && templateCache.has(templatePath)) {
            return templateCache.get(templatePath);
        }
        const content = await fs.readFile(templatePath, "utf-8");
        const hasLayoutTag = /{{\s*(?:@extends|!layout)\s*\(/.test(content);
        const compiled = Sqrl.compile(content, sqrlConfig);
        templateMeta.set(templatePath, { hasLayoutTag });
        if (useCache) {
            templateCache.set(templatePath, compiled);
        }
        return compiled;
    }

    /**
     * Because template comes from route code, a mistaken ../ could escape the views dir.
     * Disallow path separators and .. in template/layout names.
     */
    function assertSafeName(name) {
        if (
            name.includes("..") ||
            name.includes(path.sep) ||
            name.includes("/") ||
            name.includes("\\")
        ) {
            throw new Error(`Illegal template name: ${name}`);
        }
    }

    /**
     * Renders a Squirrelly template and sends it as an HTML response.
     * @this {FastifyReply}
     * @param {string} template The name of the template file (without extension).
     * @param {object} [data={}] The data to pass to the template. Can include a `layout` property to specify a layout file or set to `false` to disable layout for this request.
     */
    async function view(template, data = {}) {
        try {
            assertSafeName(template);
            if (data.layout && data.layout !== false) {
                assertSafeName(data.layout);
            }

            const instance = this.request.server;

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
                // Defensive: parent may be undefined or private
                currentInstance = currentInstance.parent ?? null;
            }

            const combinedDirs = [
                ...new Set([...aggregatedTemplatesDirs, ...initialTemplatesDirs]),
            ];
            const allSearchDirs = [...new Set([...combinedDirs, ...initialPartialsDirs])];

            async function findTemplatePath(templateName) {
                const templateFile = `${templateName}${extensionWithDot}`;
                const cacheKey = `${allSearchDirs.join(";")}:${templateFile}`; // Create a unique key

                if (useCache && pathCache.has(cacheKey)) {
                    return pathCache.get(cacheKey);
                }

                for (const dir of allSearchDirs) {
                    const fullPath = path.join(dir, templateFile);
                    try {
                        await fs.access(fullPath);
                        if (useCache) {
                            pathCache.set(cacheKey, fullPath); // Cache the found path
                        }
                        return fullPath;
                    } catch (error) {
                        fastify.log.trace(error);
                    }
                }
                return null;
            }

            // 1. Find and render the page template
            const pagePath = await findTemplatePath(template);
            if (!pagePath) {
                throw new Error(
                    `Template "${template}" not found in [${allSearchDirs.join(", ")}]`,
                );
            }

            const pageTemplate = await getTemplate(pagePath);
            const pageHtml = pageTemplate(data, sqrlConfig ?? Sqrl.defaultConfig);

            // 2. Determine which layout to use
            const currentLayout = scopedLayout !== null ? scopedLayout : initialLayout;
            const layoutFile = data.layout === false ? null : data.layout || currentLayout;

            if (!layoutFile) {
                return this.type("text/html").send(pageHtml);
            }

            const hasLayoutTag = templateMeta.get(pagePath)?.hasLayoutTag === true;
            if (hasLayoutTag) {
                return this.type("text/html").send(pageHtml);
            }

            // 3. Find and render the layout, injecting the page content
            const layoutPath = await findTemplatePath(layoutFile);
            if (!layoutPath) {
                throw new Error(
                    `Layout "${layoutFile}" not found in [${allSearchDirs.join(", ")}]`,
                );
            }

            const layoutTemplate = await getTemplate(layoutPath);
            const layoutData = { ...data, ...data.layoutData, body: pageHtml };
            const finalHtml = layoutTemplate(layoutData, sqrlConfig ?? Sqrl.defaultConfig);

            return this.type("text/html").send(finalHtml);
        } catch (error) {
            fastify.log.error(error);
            if (process.env.NODE_ENV === "production") {
                // In production, send a generic error and don't leak details
                this.status(500).send("An internal server error occurred.");
            } else {
                // In development, it's okay to send the detailed error
                this.code(500).send(error);
            }
        }
    }

    // Decorate the reply object with the main view function
    fastify.decorateReply("view", view);

    // Decorate the fastify instance so users can override settings in different scopes
    fastify.decorate("views", null);
    fastify.decorate("layout", null);

    // Also expose the Squirrelly engine itself for advanced configuration (e.g., adding helpers/filters)
    fastify.decorate("Sqrl", Sqrl);
}

export default fp(squirrellyify, {
    fastify: "5.x",
    name: "@ynode/squirrellyify",
});
