import * as mod from "module";

mod.register(new URL("hooks.js", import.meta.url).toString());

