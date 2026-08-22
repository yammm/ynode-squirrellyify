import Fastify from "fastify";

import squirrellyify, {
    buildClientModules,
    compileClientModule,
    squirrellyify as namedSquirrellyify,
    type SqrlFilter,
    type SqrlHelper,
    type SqrlTemplate,
    type ClientDeclarationTypes,
    type ViewData,
} from "@ynode/squirrellyify";
import packageMetadata from "@ynode/squirrellyify/package.json" with { type: "json" };

const repeat: SqrlHelper = (content) => {
    const [count = 0] = content.params;
    return Array.from({ length: Number(count) }, (_, index) => content.exec(index)).join("");
};
const uppercase: SqrlFilter = (value: string) => value.toUpperCase();

const app = Fastify();
await app.register(squirrellyify, {
    sqrl: {
        helpers: { repeat },
        filters: { uppercase },
    },
});

app.viewHelpers.define("repeat", repeat);
app.viewFilters.define("uppercase", uppercase);
app.viewPartials.define("card", "<p>{{ it.name }}</p>");
const compiledPartial: SqrlTemplate | undefined = app.viewPartials.get("card");
const packageName: string = packageMetadata.name;
const viewData: ViewData = { layout: false, layoutData: { section: "card" } };
app.get("/card", (request, reply) => reply.view("card", viewData));

const generated = await compileClientModule({
    templates: { card: "<p>{{ it.name | uppercase }}</p>" },
    helpers: { repeat },
    filters: { uppercase },
});
const declarationTypes = {
    card: { name: "CardViewData", from: "../view-models.js" },
} satisfies ClientDeclarationTypes;
const typedBuild = buildClientModules({
    modules: {
        card: {
            output: "public/card.js",
            templates: { card: "<p>{{ it.name }}</p>" },
            declarationTypes,
        },
    },
    check: true,
});

void [namedSquirrellyify, compiledPartial, generated, packageName, typedBuild, viewData];
await app.close();
