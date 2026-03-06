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

import fp from "fastify-plugin";
import Sqrl from "squirrelly";

import {
    resolveExtension,
    resolveInitialPartialsDirs,
    resolveInitialTemplateDirs,
    resolveSqrlConfig,
    resolveUseCache,
} from "./config.js";
import {
    buildTemplateSearchDirs,
    collectViewScope,
    createTemplateResolver,
    preloadPartials,
} from "./resolver.js";
import { createRuntimeApi } from "./runtime-api.js";
import { assertSafeName } from "./safety.js";

/**
 * @typedef {object} FastifyInstance
 * @typedef {object} FastifyReply
 * @typedef {object} SqrlConfig
 */

/**
 * This plugin adds a "view" decorator to the Fastify reply object,
 * allowing for the rendering of Squirrelly templates with support for layouts and partials.
 *
 * @param {FastifyInstance} fastify The Fastify instance.
 * @param {object} options Plugin options.
 * @param {string|string[]} [options.templates] The directory or directories where page and layout templates are stored. Defaults to "views". Directories are searched in order.
 * @param {string|string[]} [options.partials] The directory or directories where partial templates are stored.
 * @param {boolean} [options.partialsRecursive=true] Enables recursive loading of partial templates from subdirectories.
 * @param {boolean|string} [options.partialsNamespace=false] Optional namespace prefix for partial names. Use `true` to namespace by partials directory basename.
 * @param {string} [options.layout] The name of the default layout file to use (without extension).
 * @param {string} [options.defaultExtension="sqrl"] The default extension for template files.
 * @param {boolean} [options.cache] Enables template caching. Defaults to true if NODE_ENV is "production".
 * @param {object} [options.sqrl] Squirrelly engine options.
 * @param {"global"|"scoped"} [options.sqrl.scope="global"] Whether to share helpers/filters/partials globally or isolate them per Fastify registration.
 * @param {SqrlConfig} [options.sqrl.config] Squirrelly compile/render config.
 * @param {Record<string, Function>} [options.sqrl.helpers] Custom Squirrelly helpers.
 * @param {Record<string, Function>} [options.sqrl.filters] Custom Squirrelly filters.
 */
async function squirrellyify(fastify, options = {}) {
    const initialTemplatesDirs = resolveInitialTemplateDirs(options);
    const initialPartialsDirs = resolveInitialPartialsDirs(options);
    const initialLayout = options.layout;
    const { extensionWithDot } = resolveExtension(options);
    const useCache = resolveUseCache(options);
    const { sqrlScope, sqrlConfig } = resolveSqrlConfig(options);
    const {
        defineSqrlHelper,
        defineSqrlFilter,
        defineSqrlTemplate,
        viewHelpers,
        viewFilters,
        viewPartials,
    } =
        createRuntimeApi({
            sqrlScope,
            sqrlConfig,
        });

    if (options.sqrl?.helpers) {
        Object.entries(options.sqrl.helpers).forEach(([name, fn]) => {
            defineSqrlHelper(name, fn);
        });
    }
    if (options.sqrl?.filters) {
        Object.entries(options.sqrl.filters).forEach(([name, fn]) => {
            defineSqrlFilter(name, fn);
        });
    }

    await preloadPartials({
        partialsDirs: initialPartialsDirs,
        extensionWithDot,
        partialsRecursive: options.partialsRecursive ?? true,
        partialsNamespace: options.partialsNamespace ?? false,
        fastify,
        defineSqrlTemplate,
        sqrlConfig,
    });

    const { findTemplatePath, getTemplate, hasLayoutTag } = createTemplateResolver({
        fastify,
        extensionWithDot,
        useCache,
        sqrlConfig,
    });

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
            const { aggregatedTemplatesDirs, scopedLayout } = collectViewScope(instance);
            const templateSearchDirs = buildTemplateSearchDirs(
                aggregatedTemplatesDirs,
                initialTemplatesDirs,
            );

            // 1. Find and render the page template
            const pagePath = await findTemplatePath(template, templateSearchDirs);
            if (!pagePath) {
                throw new Error(
                    `Template "${template}" not found in [${templateSearchDirs.join(", ")}]`,
                );
            }

            const pageTemplate = await getTemplate(pagePath);
            const pageHtml = await pageTemplate(data, sqrlConfig);

            // 2. Determine which layout to use
            const currentLayout = scopedLayout !== null ? scopedLayout : initialLayout;
            const layoutFile = data.layout === false ? null : data.layout || currentLayout;

            if (!layoutFile) {
                return this.type("text/html").send(pageHtml);
            }

            if (hasLayoutTag(pagePath)) {
                return this.type("text/html").send(pageHtml);
            }

            // 3. Find and render the layout, injecting the page content
            const layoutPath = await findTemplatePath(layoutFile, templateSearchDirs);
            if (!layoutPath) {
                throw new Error(
                    `Layout "${layoutFile}" not found in [${templateSearchDirs.join(", ")}]`,
                );
            }

            const layoutTemplate = await getTemplate(layoutPath);
            const layoutData = { ...data, ...data.layoutData, body: pageHtml };
            const finalHtml = await layoutTemplate(layoutData, sqrlConfig);

            return this.type("text/html").send(finalHtml);
        } catch (error) {
            this.request.server.log.error(error);
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
    fastify.decorate("viewHelpers", viewHelpers);
    fastify.decorate("viewFilters", viewFilters);
    fastify.decorate("viewPartials", viewPartials);

    // Also expose the Squirrelly engine itself for advanced configuration (e.g., adding helpers/filters)
    fastify.decorate("Sqrl", Sqrl);
}

export default fp(squirrellyify, {
    fastify: "5.x",
    name: "@ynode/squirrellyify",
});
