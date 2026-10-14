// node --import ./tests/harness/register.mjs <script>  -> "@minecraft/*" resolves to the mocks below
import { register } from "node:module";
register("./loader.mjs", import.meta.url);
