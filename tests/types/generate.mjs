import { buildClientModules } from "@ynode/squirrellyify";

await buildClientModules({
    modules: {
        card: {
            output: "generated/card.js",
            templates: {
                card: "<p>{{ it.name }}</p>",
                keyword: "<p>{{ it.value }}</p>",
                record: "<p>{{ it.label }}</p>",
                untyped: "<p>{{ it.value }}</p>",
            },
            declarationTypes: {
                card: { name: "CardViewData", from: "../view-models.js" },
                keyword: { name: "default", from: "../default-view-model.js" },
                record: { name: "Record", from: "../view-models.js" },
            },
        },
    },
});
