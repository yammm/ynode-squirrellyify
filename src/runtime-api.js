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

    function defineSqrlTemplate(name, fn) {
        templatesStore.define(name, fn);
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
    };
}
