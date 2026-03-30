import path from "node:path";

import Sqrl from "squirrelly";

/**
 * Checks whether a value is a plain object (not null, not an array).
 * @param {*} value - Value to test.
 * @returns {boolean}
 */
function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Checks whether a value is an array where every element is a string.
 * @param {*} value - Value to test.
 * @returns {boolean}
 */
function isStringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Throws a TypeError when a plugin option fails validation.
 * @param {boolean} condition - Validation result.
 * @param {string} message - Error message.
 * @throws {TypeError} When condition is falsy.
 */
function assertOptionType(condition, message) {
    if (!condition) {
        throw new TypeError(message);
    }
}

/**
 * Strips leading dots from a file extension and validates it is non-empty.
 * @param {string} defaultExtension - Raw extension string from options.
 * @returns {string} Normalized extension without leading dots.
 * @throws {TypeError} When the extension contains only dot characters.
 */
function normalizeDefaultExtension(defaultExtension) {
    const normalized = defaultExtension.replace(/^\.+/, "");
    if (normalized.length === 0) {
        throw new TypeError(
            'Invalid option "defaultExtension": must contain at least one non-dot character.',
        );
    }
    return normalized;
}

/**
 * Validates all plugin options, throwing TypeError on invalid values.
 * @param {object} [options] - Plugin options to validate.
 * @throws {TypeError} When any option has an invalid type or value.
 */
export function validatePluginOptions(options = {}) {
    assertOptionType(
        isPlainObject(options),
        "Invalid options: plugin options must be a plain object.",
    );

    if (options.templates !== undefined) {
        assertOptionType(
            typeof options.templates === "string" || isStringArray(options.templates),
            'Invalid option "templates": expected a string or an array of strings.',
        );
    }
    if (options.partials !== undefined) {
        assertOptionType(
            typeof options.partials === "string" || isStringArray(options.partials),
            'Invalid option "partials": expected a string or an array of strings.',
        );
    }
    if (options.partialsRecursive !== undefined) {
        assertOptionType(
            typeof options.partialsRecursive === "boolean",
            'Invalid option "partialsRecursive": expected a boolean.',
        );
    }
    if (options.partialsNamespace !== undefined) {
        assertOptionType(
            typeof options.partialsNamespace === "boolean" ||
                typeof options.partialsNamespace === "string",
            'Invalid option "partialsNamespace": expected a boolean or a string.',
        );
    }
    if (options.layout !== undefined) {
        assertOptionType(
            typeof options.layout === "string",
            'Invalid option "layout": expected a string.',
        );
    }
    if (options.defaultExtension !== undefined) {
        assertOptionType(
            typeof options.defaultExtension === "string",
            'Invalid option "defaultExtension": expected a string.',
        );
        normalizeDefaultExtension(options.defaultExtension);
    }
    if (options.cache !== undefined) {
        assertOptionType(
            typeof options.cache === "boolean",
            'Invalid option "cache": expected a boolean.',
        );
    }
    if (options.sqrl !== undefined) {
        assertOptionType(isPlainObject(options.sqrl), 'Invalid option "sqrl": expected an object.');

        if (options.sqrl.scope !== undefined) {
            assertOptionType(
                options.sqrl.scope === "global" || options.sqrl.scope === "scoped",
                'Invalid option "sqrl.scope": expected "global" or "scoped".',
            );
        }
        if (options.sqrl.config !== undefined) {
            assertOptionType(
                isPlainObject(options.sqrl.config),
                'Invalid option "sqrl.config": expected an object.',
            );
        }
        if (options.sqrl.helpers !== undefined) {
            assertOptionType(
                isPlainObject(options.sqrl.helpers),
                'Invalid option "sqrl.helpers": expected an object of functions.',
            );
            for (const [name, fn] of Object.entries(options.sqrl.helpers)) {
                assertOptionType(
                    typeof fn === "function",
                    `Invalid option "sqrl.helpers.${name}": expected a function.`,
                );
            }
        }
        if (options.sqrl.filters !== undefined) {
            assertOptionType(
                isPlainObject(options.sqrl.filters),
                'Invalid option "sqrl.filters": expected an object of functions.',
            );
            for (const [name, fn] of Object.entries(options.sqrl.filters)) {
                assertOptionType(
                    typeof fn === "function",
                    `Invalid option "sqrl.filters.${name}": expected a function.`,
                );
            }
        }
    }
}

/**
 * Resolves the initial template directories from plugin options.
 * Defaults to `[path.join(cwd, "views")]` when no templates option is provided.
 * @param {object} [options] - Plugin options.
 * @returns {string[]} Array of template directory paths.
 */
export function resolveInitialTemplateDirs(options = {}) {
    return Array.isArray(options.templates)
        ? options.templates
        : typeof options.templates === "string"
          ? [options.templates]
          : [path.join(process.cwd(), "views")];
}

/**
 * Resolves the initial partials directories from plugin options.
 * Returns an empty array when no partials option is provided.
 * @param {object} [options] - Plugin options.
 * @returns {string[]} Array of partial directory paths.
 */
export function resolveInitialPartialsDirs(options = {}) {
    return Array.isArray(options.partials)
        ? options.partials
        : typeof options.partials === "string"
          ? [options.partials]
          : [];
}

/**
 * Resolves and normalizes the default template file extension.
 * @param {object} [options] - Plugin options.
 * @returns {{ defaultExtension: string, extensionWithDot: string }} Normalized extension pair.
 */
export function resolveExtension(options = {}) {
    const defaultExtension =
        options.defaultExtension !== undefined
            ? normalizeDefaultExtension(options.defaultExtension)
            : "sqrl";
    return {
        defaultExtension,
        extensionWithDot: `.${defaultExtension}`,
    };
}

/**
 * Determines whether template caching should be enabled.
 * Defaults to true when NODE_ENV is "production".
 * @param {object} [options] - Plugin options.
 * @returns {boolean} Whether to cache compiled templates.
 */
export function resolveUseCache(options = {}) {
    return options.cache ?? process.env.NODE_ENV === "production";
}

/**
 * Creates an isolated Squirrelly configuration with its own helpers, filters,
 * and templates storage, seeded with Squirrelly's built-in helpers and the
 * default "e" (escape) filter so core template features still work.
 * @param {object} [baseConfig] - Base Squirrelly config overrides.
 * @returns {object} Scoped Squirrelly configuration object.
 */
function createScopedSqrlConfig(baseConfig) {
    const Cacher = Sqrl.helpers?.constructor;
    if (typeof Cacher !== "function") {
        throw new Error("Unable to initialize scoped Squirrelly storage.");
    }

    const scopedHelpers = new Cacher({});
    const scopedFilters = new Cacher({});
    const scopedTemplates = new Cacher({});

    // Copy Squirrelly's built-in helpers into the scoped storage so templates
    // retain core functionality (iteration, includes, layout extends) even
    // when running in isolated "scoped" mode.
    for (const helperName of [
        "each",
        "foreach",
        "include",
        "extends",
        "useScope",
        "includeFile",
        "extendsFile",
    ]) {
        const helperFn = Sqrl.helpers.get(helperName);
        if (helperFn) {
            scopedHelpers.define(helperName, helperFn);
        }
    }

    const escapeFilter = Sqrl.filters.get("e");
    if (escapeFilter) {
        scopedFilters.define("e", escapeFilter);
    }

    return Sqrl.getConfig(
        {
            ...baseConfig,
            storage: {
                helpers: scopedHelpers,
                nativeHelpers: Sqrl.nativeHelpers,
                filters: scopedFilters,
                templates: scopedTemplates,
            },
        },
        Sqrl.defaultConfig,
    );
}

/**
 * Resolves the Squirrelly engine configuration, creating isolated scoped storage
 * when `sqrl.scope` is "scoped" or using the global Sqrl instance otherwise.
 * @param {object} [options] - Plugin options.
 * @returns {{ sqrlScope: "global"|"scoped", sqrlConfig: object }} Resolved scope and config.
 */
export function resolveSqrlConfig(options = {}) {
    const sqrlScope = options.sqrl?.scope === "scoped" ? "scoped" : "global";
    const sqrlConfig =
        sqrlScope === "scoped"
            ? createScopedSqrlConfig(options.sqrl?.config)
            : Sqrl.getConfig(options.sqrl?.config ?? {}, Sqrl.defaultConfig);

    return {
        sqrlScope,
        sqrlConfig,
    };
}
