"use strict";

// Simulate system-wide CPU load for 40 seconds.
// Usage: node SimulateCpuLoad.js <percent>
// e.g.   node SimulateCpuLoad.js 80
//
// Spawns (cores * target%) child processes that each burn 100% of a core.

const os = require("os");
const { fork } = require("child_process");

const DURATION_MS = 40000;

// Child process mode: pure busy-loop
if (process.argv[2] === "--burn") {
  const end = Date.now() + DURATION_MS;
  while (Date.now() < end) {
    // burn
  }
  process.exit(0);
}

// Main process
const target = Math.min(100, Math.max(1, parseInt(process.argv[2], 10) || 70));
const coreCount = os.cpus().length;
const childCount = Math.max(1, Math.round(coreCount * (target / 100)));

console.log(`[CpuLoad] Spawning ${childCount} burn processes on ${coreCount} cores (~${target}%) for 40 seconds`);
console.log(`[CpuLoad] Started at ${new Date().toISOString().slice(11, 19)}`);

const children = [];
for (let i = 0; i < childCount; i++) {
  children.push(fork(__filename, ["--burn"], { stdio: "ignore" }));
}

let exited = 0;
for (const child of children) {
  child.on("exit", () => {
    exited++;
    if (exited === children.length) {
      console.log(`[CpuLoad] Done at ${new Date().toISOString().slice(11, 19)}`);
      process.exit(0);
    }
  });
}

// Safety: kill all after duration + 2s
setTimeout(() => {
  for (const child of children) {
    try { child.kill(); } catch (_) {}
  }
  process.exit(0);
}, DURATION_MS + 2000).unref();
