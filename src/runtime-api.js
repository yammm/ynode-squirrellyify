import Sqrl from "squirrelly";

/**
 * Build helper/filter/template runtime API wrappers around the selected
 * Squirrelly storage scope (global or scoped).
 *
 * @param {object} options
 * @param {"global"|"scoped"} options.sqrlScope
 * @param {object} options.sqrlConfig
 * @returns {object}
 */
export function createRuntimeApi({ sqrlScope, sqrlConfig }) {
    const helpersStore = sqrlScope === "scoped" ? sqrlConfig.storage.helpers : Sqrl.helpers;
    const filtersStore = sqrlScope === "scoped" ? sqrlConfig.storage.filters : Sqrl.filters;
    const templatesStore = sqrlScope === "scoped" ? sqrlConfig.storage.templates : Sqrl.templates;

    function defineSqrlHelper(name, fn) {
        helpersStore.define(name, fn);
    }

    function getSqrlHelper(name) {
        return helpersStore.get(name);
    }

    function removeSqrlHelper(name) {
        helpersStore.remove(name);
    }

    function defineSqrlFilter(name, fn) {
        filtersStore.define(name, fn);
    }

    function getSqrlFilter(name) {
        return filtersStore.get(name);
    }

    function removeSqrlFilter(name) {
        filtersStore.remove(name);
    }

    function defineSqrlTemplate(name, template) {
        const compiled = typeof template === "function" ? template : Sqrl.compile(String(template), sqrlConfig);
        templatesStore.define(name, compiled);
        return compiled;
    }

    function getSqrlTemplate(name) {
        return templatesStore.get(name);
    }

    function removeSqrlTemplate(name) {
        templatesStore.remove(name);
    }

    return {
        defineSqrlHelper,
        defineSqrlFilter,
        defineSqrlTemplate,
        viewHelpers: {
            define: defineSqrlHelper,
            get: getSqrlHelper,
            remove: removeSqrlHelper,
        },
        viewFilters: {
            define: defineSqrlFilter,
            get: getSqrlFilter,
            remove: removeSqrlFilter,
        },
        viewPartials: {
            define: defineSqrlTemplate,
            get: getSqrlTemplate,
            remove: removeSqrlTemplate,
        },
    };
}
