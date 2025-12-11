import * as wasm from "./inflate_wasm_bg.wasm";
export * from "./inflate_wasm_bg.js";
import { __wbg_set_wasm } from "./inflate_wasm_bg.js";
__wbg_set_wasm(wasm);