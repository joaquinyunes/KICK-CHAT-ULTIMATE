#!/usr/bin/env node
import { main } from "../src/cli.js";

const code = await main(process.argv.slice(2));
if (code !== null) process.exitCode = code; // start, analyzer y mcp devuelven null: se quedan corriendo
