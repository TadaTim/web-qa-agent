// Runs a compiled test file as a child process (the way CI would) and
// captures its QA_RESULT line.
import { spawn } from "node:child_process";

export function runCompiledTest(file, appUrl, { driverKind } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, QA_APP_URL: appUrl };
    if (driverKind) env.QA_DRIVER = driverKind;
    const child = spawn("node", [file], { env });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => resolve({ exitCode: -1, stdout, stderr: stderr + String(err), parsed: null }));
    child.on("close", (exitCode) => {
      let parsed = null;
      const m = stdout.match(/QA_RESULT (\{.*\})/);
      if (m) { try { parsed = JSON.parse(m[1]); } catch { parsed = null; } }
      resolve({ exitCode, stdout, stderr, parsed });
    });
  });
}
