/**
 * MoltShield Core Patch
 *
 * Patches OpenClaw to add the `agent:pre_inference` hook event if it doesn't
 * exist natively. This is a minimal, surgical patch that:
 *
 * 1. Locates the agent loop in OpenClaw
 * 2. Injects hook emission before API calls
 * 3. Is idempotent (safe to run multiple times)
 *
 * The skill's self-patch instructions guide the agent through running this.
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
  agentLoop: string;
  hookSystem: string;
}

// ============================================================================
// Path Discovery
// ============================================================================

/**
 * Find OpenClaw installation directory
 */
async function findOpenClawInstall(): Promise<OpenClawPaths | null> {
  const possiblePaths = [
    // npm global install
    path.join(process.env.HOME || "", ".npm-global/lib/node_modules/openclaw"),
    // Local node_modules
    path.join(process.cwd(), "node_modules/openclaw"),
    // Homebrew (macOS)
    "/opt/homebrew/lib/node_modules/openclaw",
    "/usr/local/lib/node_modules/openclaw",
    // Linux global
    "/usr/lib/node_modules/openclaw",
    // Bun
    path.join(process.env.HOME || "", ".bun/install/global/node_modules/openclaw"),
    // pnpm
    path.join(process.env.HOME || "", ".local/share/pnpm/global/5/node_modules/openclaw"),
  ];

  for (const installDir of possiblePaths) {
    try {
      const pkgPath = path.join(installDir, "package.json");
      const stat = await fs.stat(pkgPath);
      if (stat.isFile()) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
        if (pkg.name === "openclaw" || pkg.name === "@openclaw/cli") {
          // Found it - now locate key files
          const agentLoop = path.join(installDir, "dist/agent/loop.js");
          const hookSystem = path.join(installDir, "dist/hooks/index.js");

          // Verify files exist
          await fs.stat(agentLoop);
          await fs.stat(hookSystem);

          return { installDir, agentLoop, hookSystem };
        }
      }
    } catch {
      // Path doesn't exist or isn't valid
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

const PATCH_MARKER = "// MOLTSHIELD_PRE_INFERENCE_PATCH";

async function isPatchApplied(filePath: string): Promise<boolean> {
  const content = await fs.readFile(filePath, "utf-8");
  return content.includes(PATCH_MARKER);
}

// ============================================================================
// Core Patch Logic
// ============================================================================

/**
 * The patch injects hook emission right before the API call in the agent loop.
 *
 * We look for patterns like:
 * - `await client.messages.create(`
 * - `await anthropic.messages.create(`
 *
 * And wrap them with pre_inference hook emission.
 */
function generatePatchCode(): string {
  return `
${PATCH_MARKER}
// Emit pre_inference hook before API call
const preInferenceEvent = {
  type: "agent",
  action: "pre_inference",
  timestamp: Date.now(),
  context: {
    messages: messages,
    system: systemPrompt,
    sessionId: sessionId || "unknown",
    workspaceDir: workspaceDir || process.cwd(),
    cfg: cfg || {},
  },
  response: {
    _blocked: null,
    _transformed: null,
    _annotations: {},
    block: function(reason) { this._blocked = reason; },
    transform: function(newMessages) { this._transformed = newMessages; },
    annotate: function(key, value) { this._annotations[key] = value; },
  },
};

try {
  await fireHooks("agent:pre_inference", preInferenceEvent);
} catch (hookError) {
  console.warn("[MoltShield] Hook error:", hookError);
}

if (preInferenceEvent.response._blocked) {
  return {
    content: [{ type: "text", text: preInferenceEvent.response._blocked }],
    stop_reason: "moltshield_blocked",
    _moltshield: preInferenceEvent.response._annotations,
  };
}

if (preInferenceEvent.response._transformed) {
  messages = preInferenceEvent.response._transformed;
}
// END MOLTSHIELD_PRE_INFERENCE_PATCH
`;
}

/**
 * Apply patch to the agent loop file
 */
async function patchAgentLoop(agentLoopPath: string): Promise<{ success: boolean; message: string }> {
  const content = await fs.readFile(agentLoopPath, "utf-8");

  // Look for the API call pattern
  const apiCallPatterns = [
    /(\s*)(const\s+response\s*=\s*await\s+(?:client|anthropic)\.messages\.create\s*\()/g,
    /(\s*)(const\s+response\s*=\s*await\s+this\.client\.messages\.create\s*\()/g,
    /(\s*)(return\s+await\s+(?:client|anthropic)\.messages\.create\s*\()/g,
  ];

  let patched = false;
  let newContent = content;

  for (const pattern of apiCallPatterns) {
    if (pattern.test(newContent) && !newContent.includes(PATCH_MARKER)) {
      newContent = newContent.replace(pattern, (match, indent, apiCall) => {
        patched = true;
        const patchCode = generatePatchCode()
          .split("\n")
          .map(line => indent + line)
          .join("\n");
        return `${patchCode}\n${indent}${apiCall}`;
      });
      break;
    }
  }

  if (!patched) {
    // Try alternate detection - look for function that makes API calls
    if (content.includes("messages.create") && !content.includes(PATCH_MARKER)) {
      return {
        success: false,
        message: "Found API call but couldn't safely inject patch. Manual intervention required.",
      };
    }
    return {
      success: false,
      message: "Could not locate API call site in agent loop.",
    };
  }

  await fs.writeFile(agentLoopPath, newContent, "utf-8");
  return { success: true, message: "Agent loop patched successfully" };
}

/**
 * Ensure hook system knows about pre_inference event
 */
async function patchHookSystem(hookSystemPath: string): Promise<{ success: boolean; message: string }> {
  const content = await fs.readFile(hookSystemPath, "utf-8");

  // Check if pre_inference is already registered
  if (content.includes("pre_inference") || content.includes("agent:pre_inference")) {
    return { success: true, message: "Hook system already supports pre_inference" };
  }

  // Look for event registration array
  const eventPatterns = [
    /(const\s+SUPPORTED_EVENTS\s*=\s*\[)([^\]]*)(])/,
    /(HOOK_EVENTS\s*=\s*\[)([^\]]*)(])/,
    /(validEvents\s*=\s*\[)([^\]]*)(])/,
  ];

  let patched = false;
  let newContent = content;

  for (const pattern of eventPatterns) {
    const match = content.match(pattern);
    if (match) {
      const [full, before, events, after] = match;
      if (!events.includes("pre_inference")) {
        const newEvents = events.trim()
          ? `${events.trim()}, "agent:pre_inference"`
          : '"agent:pre_inference"';
        newContent = content.replace(full, `${before}${newEvents}${after}`);
        patched = true;
        break;
      }
    }
  }

  if (!patched) {
    // If we can't find the event array, the hook system might be dynamic
    // In that case, just return success - the hook will work anyway
    return { success: true, message: "Hook system appears to be dynamic, no patch needed" };
  }

  await fs.writeFile(hookSystemPath, newContent, "utf-8");
  return { success: true, message: "Hook system patched to support pre_inference" };
}

// ============================================================================
// Main Patch Function
// ============================================================================

export async function applyPatch(): Promise<PatchResult> {
  const result: PatchResult = {
    success: false,
    message: "",
    filesModified: [],
    backupPaths: [],
  };

  try {
    // Find OpenClaw installation
    const paths = await findOpenClawInstall();
    if (!paths) {
      result.message = "Could not locate OpenClaw installation. Is it installed globally?";
      return result;
    }

    console.log(`[MoltShield] Found OpenClaw at: ${paths.installDir}`);

    // Check if already patched
    if (await isPatchApplied(paths.agentLoop)) {
      result.success = true;
      result.message = "MoltShield patch already applied";
      return result;
    }

    // Create backups
    const agentLoopBackup = await createBackup(paths.agentLoop);
    result.backupPaths.push(agentLoopBackup);
    console.log(`[MoltShield] Backup created: ${agentLoopBackup}`);

    const hookSystemBackup = await createBackup(paths.hookSystem);
    result.backupPaths.push(hookSystemBackup);
    console.log(`[MoltShield] Backup created: ${hookSystemBackup}`);

    // Apply patches
    const agentLoopResult = await patchAgentLoop(paths.agentLoop);
    if (!agentLoopResult.success) {
      // Restore backup
      await restoreBackup(agentLoopBackup, paths.agentLoop);
      result.message = `Agent loop patch failed: ${agentLoopResult.message}`;
      return result;
    }
    result.filesModified.push(paths.agentLoop);
    console.log(`[MoltShield] ${agentLoopResult.message}`);

    const hookSystemResult = await patchHookSystem(paths.hookSystem);
    if (!hookSystemResult.success) {
      // Restore backups
      await restoreBackup(agentLoopBackup, paths.agentLoop);
      result.message = `Hook system patch failed: ${hookSystemResult.message}`;
      return result;
    }
    if (hookSystemResult.message.includes("patched")) {
      result.filesModified.push(paths.hookSystem);
    }
    console.log(`[MoltShield] ${hookSystemResult.message}`);

    result.success = true;
    result.message = `MoltShield patch applied successfully. Modified ${result.filesModified.length} file(s).`;
    return result;

  } catch (error) {
    result.message = `Patch failed with error: ${error}`;
    return result;
  }
}

/**
 * Remove the patch (restore from backup)
 */
export async function removePatch(): Promise<PatchResult> {
  const result: PatchResult = {
    success: false,
    message: "",
    filesModified: [],
    backupPaths: [],
  };

  try {
    const paths = await findOpenClawInstall();
    if (!paths) {
      result.message = "Could not locate OpenClaw installation";
      return result;
    }

    // Find most recent backups
    const installDir = path.dirname(paths.agentLoop);
    const files = await fs.readdir(installDir);
    const backups = files
      .filter(f => f.includes(".moltshield-backup-"))
      .sort()
      .reverse();

    if (backups.length === 0) {
      result.message = "No backups found to restore";
      return result;
    }

    // Restore each backup
    for (const backup of backups) {
      const backupPath = path.join(installDir, backup);
      const originalPath = backupPath.replace(/\.moltshield-backup-\d+$/, "");
      await restoreBackup(backupPath, originalPath);
      result.filesModified.push(originalPath);
      console.log(`[MoltShield] Restored: ${originalPath}`);
    }

    result.success = true;
    result.message = `Patch removed. Restored ${result.filesModified.length} file(s).`;
    return result;

  } catch (error) {
    result.message = `Remove patch failed: ${error}`;
    return result;
  }
}

/**
 * Check if patch is currently applied
 */
export async function checkPatchStatus(): Promise<{
  installed: boolean;
  openclawFound: boolean;
  version?: string;
}> {
  try {
    const paths = await findOpenClawInstall();
    if (!paths) {
      return { installed: false, openclawFound: false };
    }

    const pkg = JSON.parse(
      await fs.readFile(path.join(paths.installDir, "package.json"), "utf-8")
    );

    const installed = await isPatchApplied(paths.agentLoop);

    return {
      installed,
      openclawFound: true,
      version: pkg.version,
    };
  } catch {
    return { installed: false, openclawFound: false };
  }
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  switch (command) {
    case "apply":
      applyPatch().then(r => {
        console.log(r.message);
        process.exit(r.success ? 0 : 1);
      });
      break;

    case "remove":
      removePatch().then(r => {
        console.log(r.message);
        process.exit(r.success ? 0 : 1);
      });
      break;

    case "status":
      checkPatchStatus().then(s => {
        if (!s.openclawFound) {
          console.log("OpenClaw not found");
        } else {
          console.log(`OpenClaw ${s.version}: ${s.installed ? "PATCHED" : "NOT PATCHED"}`);
        }
      });
      break;

    default:
      console.log("Usage: core-patch.ts [apply|remove|status]");
      process.exit(1);
  }
}
