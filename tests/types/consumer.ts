import Fastify from "fastify";

import squirrellyify, {
    buildClientModules,
    compileClientModule,
    squirrellyify as namedSquirrellyify,
    type SqrlFilter,
    type SqrlHelper,
    type SqrlTemplate,
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

const generated = await compileClientModule({
    templates: { card: "<p>{{ it.name | uppercase }}</p>" },
    helpers: { repeat },
    filters: { uppercase },
});

void [namedSquirrellyify, buildClientModules, compiledPartial, generated, packageName];
await app.close();
