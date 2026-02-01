/**
 * MoltShield Core Patch
 *
 * Patches OpenClaw to add pre-inference evaluation by wrapping the streamFn.
 *
 * Target: src/agents/pi-embedded-runner/run/attempt.ts
 * Pattern: After `activeSession.agent.streamFn = streamSimple;`
 *
 * The wrapper intercepts all LLM calls and evaluates messages before streaming.
 */

import * as fs from "fs/promises";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

interface PatchResult {
  success: boolean;
  message: string;
  filesModified: string[];
  backupPaths: string[];
}

interface OpenClawPaths {
  installDir: string;
  attemptFile: string;  // The file we actually patch
}

// ============================================================================
// Path Discovery
// ============================================================================

/**
 * Find OpenClaw installation directory
 */
async function findOpenClawInstall(): Promise<OpenClawPaths | null> {
  const home = process.env.HOME || "";

  const possiblePaths = [
    // npm global installs
    "/usr/lib/node_modules/openclaw",
    "/usr/local/lib/node_modules/openclaw",
    path.join(home, ".npm-global/lib/node_modules/openclaw"),
    path.join(home, ".npm/lib/node_modules/openclaw"),

    // nvm (check current node version)
    ...(process.env.NVM_BIN
      ? [path.join(path.dirname(process.env.NVM_BIN), "lib/node_modules/openclaw")]
      : []),

    // Homebrew (macOS)
    "/opt/homebrew/lib/node_modules/openclaw",

    // pnpm global
    path.join(home, ".local/share/pnpm/global/5/node_modules/openclaw"),
    path.join(home, "Library/pnpm/global/5/node_modules/openclaw"),

    // Bun global
    path.join(home, ".bun/install/global/node_modules/openclaw"),

    // Local node_modules (last resort)
    path.join(process.cwd(), "node_modules/openclaw"),
  ];

  for (const installDir of possiblePaths) {
    try {
      const pkgPath = path.join(installDir, "package.json");
      const stat = await fs.stat(pkgPath);
      if (stat.isFile()) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
        if (pkg.name === "openclaw" || pkg.name === "@openclaw/cli") {
          // Found it - locate the attempt.ts file (compiled to .js in dist)
          const attemptFile = path.join(
            installDir,
            "dist/agents/pi-embedded-runner/run/attempt.js"
          );

          // Verify file exists
          await fs.stat(attemptFile);

          return { installDir, attemptFile };
        }
      }
    } catch (error: unknown) {
      // Only ignore ENOENT (path doesn't exist) - fail noisily on other errors
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      console.error(`[MoltShield] Error checking ${installDir}:`, error);
    }
  }

  return null;
}

// ============================================================================
// Backup System
// ============================================================================

async function createBackup(filePath: string): Promise<string> {
  const backupPath = `${filePath}.moltshield-backup-${Date.now()}`;
  await fs.copyFile(filePath, backupPath);
  return backupPath;
}

async function restoreBackup(backupPath: string, originalPath: string): Promise<void> {
  await fs.copyFile(backupPath, originalPath);
}

// ============================================================================
// Patch Detection
// ============================================================================

const PATCH_MARKER = "// MOLTSHIELD_STREAM_WRAPPER";
const PATCH_END_MARKER = "// END_MOLTSHIELD_STREAM_WRAPPER";

async function isPatchApplied(filePath: string): Promise<boolean> {
  const content = await fs.readFile(filePath, "utf-8");
  return content.includes(PATCH_MARKER);
}

// ============================================================================
// Core Patch Logic
// ============================================================================

/**
 * Generate the wrapper code that intercepts streamFn calls.
 *
 * This wraps the streamFn to evaluate messages before they go to the LLM.
 * Calls MoltShield evaluator directly - no hook system dependency.
 */
function generateWrapperCode(indent: string): string {
  return `
${indent}${PATCH_MARKER}
${indent}// MoltShield pre-inference wrapper - evaluates messages before LLM call
${indent}const _moltshieldOriginalStreamFn = activeSession.agent.streamFn;
${indent}activeSession.agent.streamFn = async (model, context, options) => {
${indent}  try {
${indent}    const { evaluatePrompt, shouldBlock } = await import("moltshield");
${indent}    const messages = context?.messages || [];
${indent}
${indent}    // Evaluate the last user message and any recent tool results
${indent}    for (let i = messages.length - 1; i >= 0 && i >= messages.length - 5; i--) {
${indent}      const msg = messages[i];
${indent}      if (!msg) continue;
${indent}
${indent}      // Get content to evaluate
${indent}      let content = "";
${indent}      if (typeof msg.content === "string") {
${indent}        content = msg.content;
${indent}      } else if (Array.isArray(msg.content)) {
${indent}        content = msg.content
${indent}          .filter(b => b.type === "text")
${indent}          .map(b => b.text)
${indent}          .join("\\n");
${indent}      }
${indent}
${indent}      if (!content || content.length < 10) continue;
${indent}
${indent}      const result = await evaluatePrompt(content, { timeout: 5000 });
${indent}      if (shouldBlock(result)) {
${indent}        console.warn("[MoltShield] Blocked:", result.reasoning?.slice(0, 100));
${indent}        throw new Error("[MoltShield] Request blocked due to safety violation");
${indent}      }
${indent}    }
${indent}  } catch (err) {
${indent}    if (err.message?.includes("[MoltShield]")) throw err;
${indent}    console.warn("[MoltShield] Evaluation error (allowing request):", err.message);
${indent}  }
${indent}
${indent}  return _moltshieldOriginalStreamFn(model, context, options);
${indent}};
${indent}${PATCH_END_MARKER}
`;
}

/**
 * Apply patch to the attempt.ts file
 *
 * We look for: activeSession.agent.streamFn = streamSimple;
 * And insert our wrapper immediately after.
 */
async function patchAttemptFile(attemptPath: string): Promise<{ success: boolean; message: string }> {
  const content = await fs.readFile(attemptPath, "utf-8");

  // Already patched?
  if (content.includes(PATCH_MARKER)) {
    return { success: true, message: "Already patched" };
  }

  // Look for the streamFn assignment pattern
  // In compiled JS it might be slightly different, handle both
  const patterns = [
    /([ \t]*)(activeSession\.agent\.streamFn\s*=\s*streamSimple;)/,
    /([ \t]*)(activeSession\.agent\.streamFn\s*=\s*\w+;)/,
  ];

  let patched = false;
  let newContent = content;

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const [fullMatch, indent] = match;
      const wrapperCode = generateWrapperCode(indent);
      newContent = content.replace(
        fullMatch,
        `${fullMatch}\n${wrapperCode}`
      );
      patched = true;
      break;
    }
  }

  if (!patched) {
    return {
      success: false,
      message: "Could not find streamFn assignment pattern in attempt.js"
    };
  }

  await fs.writeFile(attemptPath, newContent, "utf-8");
  return { success: true, message: "Patch applied successfully" };
}

/**
 * Remove patch from the attempt file
 */
async function removePatch(attemptPath: string): Promise<{ success: boolean; message: string }> {
  const content = await fs.readFile(attemptPath, "utf-8");

  if (!content.includes(PATCH_MARKER)) {
    return { success: true, message: "No patch found to remove" };
  }

  // Remove everything between markers (inclusive)
  const markerRegex = new RegExp(
    `\\n[\\t ]*${PATCH_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${PATCH_END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'g'
  );

  const newContent = content.replace(markerRegex, '');
  await fs.writeFile(attemptPath, newContent, "utf-8");

  return { success: true, message: "Patch removed successfully" };
}

// ============================================================================
// Public API
// ============================================================================

export async function applyPatch(): Promise<PatchResult> {
  const paths = await findOpenClawInstall();
  if (!paths) {
    return {
      success: false,
      message: "Could not find OpenClaw installation",
      filesModified: [],
      backupPaths: [],
    };
  }

  console.log(`[MoltShield] Found OpenClaw at: ${paths.installDir}`);

  // Check if already patched
  if (await isPatchApplied(paths.attemptFile)) {
    return {
      success: true,
      message: "MoltShield patch already applied",
      filesModified: [],
      backupPaths: [],
    };
  }

  // Create backup
  const backupPath = await createBackup(paths.attemptFile);
  console.log(`[MoltShield] Created backup: ${backupPath}`);

  // Apply patch
  const result = await patchAttemptFile(paths.attemptFile);

  if (!result.success) {
    // Restore backup on failure
    await restoreBackup(backupPath, paths.attemptFile);
    return {
      success: false,
      message: result.message,
      filesModified: [],
      backupPaths: [],
    };
  }

  return {
    success: true,
    message: result.message,
    filesModified: [paths.attemptFile],
    backupPaths: [backupPath],
  };
}

export async function checkPatchStatus(): Promise<{
  installed: boolean;
  openclawFound: boolean;
  openclawPath: string | null;
  patchedFiles: string[];
}> {
  const paths = await findOpenClawInstall();

  if (!paths) {
    return {
      installed: false,
      openclawFound: false,
      openclawPath: null,
      patchedFiles: [],
    };
  }

  const isPatched = await isPatchApplied(paths.attemptFile);

  return {
    installed: isPatched,
    openclawFound: true,
    openclawPath: paths.installDir,
    patchedFiles: isPatched ? [paths.attemptFile] : [],
  };
}

export async function removePatchFromInstall(): Promise<PatchResult> {
  const paths = await findOpenClawInstall();
  if (!paths) {
    return {
      success: false,
      message: "Could not find OpenClaw installation",
      filesModified: [],
      backupPaths: [],
    };
  }

  // Create backup before removal
  const backupPath = await createBackup(paths.attemptFile);

  const result = await removePatch(paths.attemptFile);

  return {
    success: result.success,
    message: result.message,
    filesModified: result.success ? [paths.attemptFile] : [],
    backupPaths: [backupPath],
  };
}

// ============================================================================
// CLI
// ============================================================================

async function main() {
  const command = process.argv[2];

  switch (command) {
    case "status": {
      const status = await checkPatchStatus();
      console.log("\n=== MoltShield Patch Status ===\n");
      console.log(`OpenClaw found: ${status.openclawFound ? "Yes" : "No"}`);
      if (status.openclawPath) {
        console.log(`OpenClaw path: ${status.openclawPath}`);
      }
      console.log(`Patch installed: ${status.installed ? "Yes" : "No"}`);
      if (status.patchedFiles.length > 0) {
        console.log(`Patched files:`);
        status.patchedFiles.forEach(f => console.log(`  - ${f}`));
      }
      break;
    }

    case "apply": {
      console.log("\n=== Applying MoltShield Patch ===\n");
      const result = await applyPatch();
      console.log(`Success: ${result.success}`);
      console.log(`Message: ${result.message}`);
      if (result.filesModified.length > 0) {
        console.log(`Modified files:`);
        result.filesModified.forEach(f => console.log(`  - ${f}`));
      }
      if (result.backupPaths.length > 0) {
        console.log(`Backup files:`);
        result.backupPaths.forEach(f => console.log(`  - ${f}`));
      }
      process.exit(result.success ? 0 : 1);
    }

    case "remove": {
      console.log("\n=== Removing MoltShield Patch ===\n");
      const result = await removePatchFromInstall();
      console.log(`Success: ${result.success}`);
      console.log(`Message: ${result.message}`);
      process.exit(result.success ? 0 : 1);
    }

    default:
      console.log("Usage: npx tsx patch/core-patch.ts <command>");
      console.log("");
      console.log("Commands:");
      console.log("  status  - Check if patch is applied");
      console.log("  apply   - Apply the MoltShield patch");
      console.log("  remove  - Remove the MoltShield patch");
      process.exit(1);
  }
}

main().catch(console.error);
