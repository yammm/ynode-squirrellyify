import { render } from "./generated/card.js";

const cardHtml: string = render.card({ name: "Ada" });
const keywordHtml: string = render.keyword({ value: 7 });
const recordHtml: string = render.record({ label: "ready" });
const untypedHtml: string = render.untyped({ anyValue: true });

// @ts-expect-error CardViewData requires name.
render.card({});
// @ts-expect-error The default declaration type requires a numeric value.
render.keyword({ value: "7" });
// @ts-expect-error The imported Record type requires label.
render.record({});

void [cardHtml, keywordHtml, recordHtml, untypedHtml];
