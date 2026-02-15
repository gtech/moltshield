/**
 * Exchange Dataset Labeler
 *
 * Fast terminal UI for manually labeling exchange responses as
 * manipulated, safe, or uncertain.
 *
 * Features:
 * - Single-keypress input (raw mode)
 * - ANSI color coding
 * - Incremental save (labels persist on quit)
 * - Resume support (skips already-labeled)
 * - Stats bar with rate tracking
 *
 * Usage:
 *   npx tsx tests/benchmarks/tools/label-exchanges.ts [responsesFile]
 */

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as readline from "readline";

// ============================================================================
// Types
// ============================================================================

interface ExchangeRecord {
  id: string;
  category: string;
  source: string;
  input: string;
  response: string | null;
  userRequest: string;
  attackGoal: string;
  expectedBlock: boolean;
  latencyMs: number;
  timestamp: string;
  error: string | null;
}

interface LabelRecord {
  id: string;
  label: "manipulated" | "safe" | "uncertain";
  timestamp: string;
}

// ============================================================================
// ANSI Helpers
// ============================================================================

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

// ============================================================================
// Data Loading
// ============================================================================

async function loadResponses(path: string): Promise<ExchangeRecord[]> {
  const records: ExchangeRecord[] = [];
  try {
    const content = await fsp.readFile(path, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as ExchangeRecord;
        // Only include records with actual responses
        if (record.response !== null) {
          records.push(record);
        }
      } catch {
        // skip malformed
      }
    }
  } catch (err) {
    console.error(`Error loading responses: ${err}`);
    process.exit(1);
  }
  return records;
}

async function loadExistingLabels(path: string): Promise<Map<string, LabelRecord>> {
  const labels = new Map<string, LabelRecord>();
  try {
    const content = await fsp.readFile(path, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const label = JSON.parse(line) as LabelRecord;
        labels.set(label.id, label);
      } catch {
        // skip malformed
      }
    }
  } catch {
    // file doesn't exist yet
  }
  return labels;
}

// ============================================================================
// Display
// ============================================================================

function displayCase(
  record: ExchangeRecord,
  index: number,
  total: number,
  stats: { manipulated: number; safe: number; uncertain: number; startTime: number },
  showFullInput: boolean,
) {
  clearScreen();

  const elapsed = (Date.now() - stats.startTime) / 60000;
  const labeled = stats.manipulated + stats.safe + stats.uncertain;
  const rate = elapsed > 0 ? (labeled / elapsed).toFixed(1) : "0.0";

  // Header
  console.log(
    `${c.bold}${c.cyan}[${index + 1}/${total}]${c.reset} ` +
    `${c.bold}${record.id}${c.reset} ${c.dim}(${record.category})${c.reset}`
  );
  console.log(
    `${c.dim}Stats: ${c.green}S:${stats.safe}${c.reset}${c.dim} | ` +
    `${c.red}M:${stats.manipulated}${c.reset}${c.dim} | ` +
    `${c.yellow}U:${stats.uncertain}${c.reset}${c.dim} | ` +
    `${rate}/min${c.reset}`
  );
  console.log(c.dim + "─".repeat(70) + c.reset);

  // User request
  if (record.userRequest) {
    console.log(`${c.bold}${c.blue}USER REQUEST:${c.reset} ${record.userRequest.slice(0, 200)}`);
  }

  // Attack goal
  if (record.attackGoal && record.expectedBlock) {
    console.log(`${c.bold}${c.red}ATTACK GOAL:${c.reset}  ${c.red}${record.attackGoal.slice(0, 200)}${c.reset}`);
  } else if (!record.expectedBlock) {
    console.log(`${c.bold}${c.green}[BENIGN CASE - no injection]${c.reset}`);
  }

  // Full input (toggled)
  if (showFullInput) {
    console.log(c.dim + "─".repeat(70) + c.reset);
    console.log(`${c.dim}FULL INPUT:${c.reset}`);
    const inputLines = record.input.split("\n");
    const displayLines = inputLines.slice(0, 30);
    for (const line of displayLines) {
      console.log(`  ${c.dim}${line.slice(0, 120)}${c.reset}`);
    }
    if (inputLines.length > 30) {
      console.log(`  ${c.dim}... (${inputLines.length - 30} more lines)${c.reset}`);
    }
  }

  console.log(c.dim + "─".repeat(70) + c.reset);

  // Response
  console.log(`${c.bold}RESPONSE:${c.reset}`);
  const responseLines = (record.response || "").split("\n");
  for (const line of responseLines.slice(0, 40)) {
    console.log(`  ${line.slice(0, 120)}`);
  }
  if (responseLines.length > 40) {
    console.log(`  ${c.dim}... (${responseLines.length - 40} more lines)${c.reset}`);
  }

  console.log(c.dim + "─".repeat(70) + c.reset);

  // Controls
  console.log(
    `  ${c.bold}${c.red}[m]${c.reset}anipulated  ` +
    `${c.bold}${c.green}[s]${c.reset}afe  ` +
    `${c.bold}${c.yellow}[u]${c.reset}ncertain  ` +
    `${c.bold}[f]${c.reset}ull input  ` +
    `${c.bold}[b]${c.reset}ack  ` +
    `${c.bold}[q]${c.reset}uit`
  );
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const responsesPath = process.argv[2] || "tests/benchmarks/data/exchange-responses.jsonl";
  const labelsPath = responsesPath.replace("-responses.jsonl", "-labels.jsonl");

  console.log("Loading responses...");
  const records = await loadResponses(responsesPath);
  console.log(`Loaded ${records.length} responses with data`);

  const existingLabels = await loadExistingLabels(labelsPath);
  console.log(`Already labeled: ${existingLabels.size}`);

  // Filter to unlabeled
  const unlabeled = records.filter(r => !existingLabels.has(r.id));
  console.log(`Remaining: ${unlabeled.length}\n`);

  if (unlabeled.length === 0) {
    console.log("All cases are labeled!");

    // Print summary
    let m = 0, s = 0, u = 0;
    for (const [, label] of existingLabels) {
      if (label.label === "manipulated") m++;
      else if (label.label === "safe") s++;
      else u++;
    }
    console.log(`  Manipulated: ${m}`);
    console.log(`  Safe: ${s}`);
    console.log(`  Uncertain: ${u}`);
    return;
  }

  // Stats
  let manipulated = 0, safe = 0, uncertain = 0;
  for (const [, label] of existingLabels) {
    if (label.label === "manipulated") manipulated++;
    else if (label.label === "safe") safe++;
    else uncertain++;
  }

  const stats = { manipulated, safe, uncertain, startTime: Date.now() };
  let currentIndex = 0;
  let showFullInput = false;

  // Track recently labeled for [b]ack support
  const recentLabels: string[] = [];

  // Open label file for appending
  const labelStream = fs.createWriteStream(labelsPath, { flags: "a" });

  // Set up raw mode for single keypress
  if (!process.stdin.isTTY) {
    console.error("This tool requires a TTY (interactive terminal).");
    process.exit(1);
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  // Display first case
  displayCase(unlabeled[currentIndex], currentIndex, unlabeled.length, stats, showFullInput);

  process.stdin.on("keypress", (_str, key) => {
    if (key.ctrl && key.name === "c") {
      // Ctrl+C
      labelStream.end();
      process.stdin.setRawMode(false);
      console.log("\n\nInterrupted. Progress saved.");
      process.exit(0);
    }

    const record = unlabeled[currentIndex];

    switch (key.name || key.sequence) {
      case "m": {
        // Manipulated
        const label: LabelRecord = {
          id: record.id,
          label: "manipulated",
          timestamp: new Date().toISOString(),
        };
        labelStream.write(JSON.stringify(label) + "\n");
        existingLabels.set(record.id, label);
        stats.manipulated++;
        recentLabels.push(record.id);
        currentIndex++;
        showFullInput = false;
        break;
      }
      case "s": {
        // Safe
        const label: LabelRecord = {
          id: record.id,
          label: "safe",
          timestamp: new Date().toISOString(),
        };
        labelStream.write(JSON.stringify(label) + "\n");
        existingLabels.set(record.id, label);
        stats.safe++;
        recentLabels.push(record.id);
        currentIndex++;
        showFullInput = false;
        break;
      }
      case "u": {
        // Uncertain
        const label: LabelRecord = {
          id: record.id,
          label: "uncertain",
          timestamp: new Date().toISOString(),
        };
        labelStream.write(JSON.stringify(label) + "\n");
        existingLabels.set(record.id, label);
        stats.uncertain++;
        recentLabels.push(record.id);
        currentIndex++;
        showFullInput = false;
        break;
      }
      case "f": {
        // Toggle full input
        showFullInput = !showFullInput;
        displayCase(record, currentIndex, unlabeled.length, stats, showFullInput);
        return;
      }
      case "b": {
        // Go back (undo last label)
        if (recentLabels.length > 0 && currentIndex > 0) {
          currentIndex--;
          const undoId = recentLabels.pop()!;
          const undone = existingLabels.get(undoId);
          if (undone) {
            if (undone.label === "manipulated") stats.manipulated--;
            else if (undone.label === "safe") stats.safe--;
            else stats.uncertain--;
            existingLabels.delete(undoId);
            // Note: can't remove from JSONL file, but last label wins on reload
          }
          showFullInput = false;
        }
        displayCase(unlabeled[currentIndex], currentIndex, unlabeled.length, stats, showFullInput);
        return;
      }
      case "q": {
        labelStream.end();
        process.stdin.setRawMode(false);
        clearScreen();
        console.log("Session saved.\n");
        console.log(`  Labeled this session: ${stats.manipulated + stats.safe + stats.uncertain - (manipulated + safe + uncertain)}`);
        console.log(`  Total labeled: ${existingLabels.size}`);
        console.log(`  Remaining: ${unlabeled.length - currentIndex}`);
        console.log(`\n  Manipulated: ${stats.manipulated}`);
        console.log(`  Safe: ${stats.safe}`);
        console.log(`  Uncertain: ${stats.uncertain}`);
        process.exit(0);
        return;
      }
      default:
        // Ignore other keys
        return;
    }

    // Check if done
    if (currentIndex >= unlabeled.length) {
      labelStream.end();
      process.stdin.setRawMode(false);
      clearScreen();
      console.log("All cases labeled!\n");
      console.log(`  Manipulated: ${stats.manipulated}`);
      console.log(`  Safe: ${stats.safe}`);
      console.log(`  Uncertain: ${stats.uncertain}`);
      process.exit(0);
      return;
    }

    // Display next case
    displayCase(unlabeled[currentIndex], currentIndex, unlabeled.length, stats, showFullInput);
  });
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
