// CLI: explore | compile | replay
//   node src/cli.mjs explore [--driver playwright|dom] [--planner deterministic|fake] [--flow id]
//   node src/cli.mjs compile [--flow id]
//   node src/cli.mjs replay --url http://127.0.0.1:PORT [--flow id] [--classify]
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { startApp } from "../app/server.mjs";
import { runCompiledTest } from "./replay.mjs";
import { createDriver } from "./driver/driver.mjs";
import { createProvider } from "./agent/planner.mjs";
import { exploreFlow } from "./agent/explorer.mjs";
import { FLOWS, ADVERSARIAL_FLOW, getFlow } from "./agent/flows.mjs";
import { compileTrace } from "./compiler/compiler.mjs";
import { classifyRun } from "./classifier/classifier.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function flag(name) { return process.argv.includes(`--${name}`); }

async function exploreCmd() {
  const driverKind = arg("driver", "playwright");
  const provider = createProvider(arg("planner", "deterministic"));
  const only = arg("flow", null);
  const flows = only ? [getFlow(only)] : [...FLOWS, ADVERSARIAL_FLOW];
  const { server, origin } = await startApp(0);
  await mkdir(`${ROOT}traces`, { recursive: true });
  await mkdir(`${ROOT}screenshots`, { recursive: true });
  const summary = [];
  try {
    for (const flow of flows) {
      if (!flow) continue;
      const driver = await createDriver({ kind: driverKind, origin });
      try {
        await driver.goto(origin + "/");
        const trace = await exploreFlow({ driver, flow, provider, screenshotsDir: `${ROOT}screenshots` });
        await writeFile(`${ROOT}traces/${flow.id}.json`, JSON.stringify(trace, null, 2));
        summary.push({ flow: flow.id, outcome: trace.outcome, steps: trace.steps.length, injections: trace.injections.length, refused: trace.refused.length });
        console.log(`${flow.id}: ${trace.outcome} (${trace.steps.length} steps, ${trace.injections.length} injection flag(s), ${trace.refused.length} refusal(s))`);
      } finally {
        await driver.close();
      }
    }
  } finally {
    server.close();
  }
  return summary;
}

async function compileCmd() {
  const only = arg("flow", null);
  const ids = only ? [only] : [...FLOWS.map((f) => f.id)];
  await mkdir(`${ROOT}compiled`, { recursive: true });
  for (const id of ids) {
    const tracePath = `${ROOT}traces/${id}.json`;
    if (!existsSync(tracePath)) {
      console.log(`${id}: no trace found (run explore first)`);
      continue;
    }
    const trace = JSON.parse(await readFile(tracePath, "utf8"));
    if (trace.outcome !== "success") {
      console.log(`${id}: trace outcome is ${trace.outcome}; only successful explorations compile`);
      continue;
    }
    const source = compileTrace(trace);
    await writeFile(`${ROOT}compiled/${id}.test.mjs`, source);
    console.log(`${id}: compiled -> compiled/${id}.test.mjs`);
  }
}

async function replayCmd() {
  const url = arg("url", null);
  if (!url) { console.error("replay needs --url"); process.exitCode = 2; return; }
  const only = arg("flow", null);
  const ids = only ? [only] : FLOWS.map((f) => f.id);
  for (const id of ids) {
    const file = `${ROOT}compiled/${id}.test.mjs`;
    if (!existsSync(file)) { console.log(`${id}: no compiled test`); continue; }
    const run = await runCompiledTest(file, url, { driverKind: arg("driver", undefined) });
    const cls = classifyRun(run);
    console.log(`${id}: exit=${run.exitCode} status=${run.parsed?.status ?? "?"} classification=${cls}`);
  }
}

const cmd = process.argv[2];
if (cmd === "explore") await exploreCmd();
else if (cmd === "compile") await compileCmd();
else if (cmd === "replay") await replayCmd();
else {
  console.log("usage: node src/cli.mjs <explore|compile|replay> [options]");
  process.exitCode = cmd ? 2 : 0;
}
