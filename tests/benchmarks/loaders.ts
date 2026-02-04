/**
 * Data Loaders
 *
 * Load test cases from various sources into the unified TestCase format.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { TestCase } from "./harness.js";
import {
  INDIRECT_INJECTION_CASES,
  BENIGN_PROMPTS,
  formatAsPrompt,
} from "./datasets.js";

const FIXTURES_DIR = "tests/fixtures";

// ============================================================================
// Curated Datasets (from datasets.ts)
// ============================================================================

/**
 * Load curated indirect injection test cases
 * These are hand-crafted scenarios with user request + malicious content
 */
export function loadCuratedInjection(): TestCase[] {
  return INDIRECT_INJECTION_CASES.map(tc => ({
    id: `curated-${tc.id}`,
    category: tc.category,
    input: formatAsPrompt(tc),
    expectedBlock: tc.category !== "benign",
    metadata: {
      source: "curated",
      userRequest: tc.userRequest,
      injectionGoal: tc.injectionGoal,
    },
  }));
}

/**
 * Load curated benign prompts for FPR testing
 */
export function loadCuratedBenign(): TestCase[] {
  return BENIGN_PROMPTS.map(p => ({
    id: `curated-${p.id}`,
    category: `benign-${p.category}`,
    input: p.prompt,
    expectedBlock: false,
    metadata: { source: "curated" },
  }));
}

// ============================================================================
// ZeroLeaks Loader
// ============================================================================

interface ZeroLeaksProbe {
  id: string;
  category: string;
  technique: string;
  prompt: string;
}

/**
 * Load ZeroLeaks injection probes
 * Structure: tests/fixtures/zeroleaks/probes.json (extracted from TypeScript source)
 * To regenerate: cd tests/fixtures/zeroleaks && npx tsx extract-probes.ts > probes.json
 */
export async function loadZeroLeaks(): Promise<TestCase[]> {
  const filepath = path.join(FIXTURES_DIR, "zeroleaks", "probes.json");
  const cases: TestCase[] = [];

  try {
    const content = await fs.readFile(filepath, "utf-8");
    const probes: ZeroLeaksProbe[] = JSON.parse(content);

    for (const probe of probes) {
      cases.push({
        id: `zeroleaks-${probe.id}`,
        category: `zeroleaks-${probe.category}`,
        input: probe.prompt,
        expectedBlock: true,  // All ZeroLeaks probes are injection attempts
        metadata: {
          source: "zeroleaks",
          originalCategory: probe.category,
          technique: probe.technique,
        },
      });
    }
  } catch (error) {
    console.warn(`Warning: Could not load ZeroLeaks data: ${error}`);
    console.warn("Run: cd tests/fixtures/zeroleaks && npx tsx extract-probes.ts > probes.json");
  }

  return cases;
}

// ============================================================================
// InjecAgent Loader
// ============================================================================

interface InjecAgentCase {
  "Attacker Tools": string[];
  "Attacker Instruction": string;
  "Expected Achievements": string;
  "Attack Type": string;
  "User Tool": string;
  "User Instruction": string;
  "Tool Parameters": string;
  "Tool Response Template": string;
  "Tool Response": string;
}

/**
 * Load InjecAgent test cases
 * Structure: tests/fixtures/injecagent/data/test_cases_*.json
 */
export async function loadInjecAgent(variant: "dh_base" | "dh_enhanced" | "ds_base" | "ds_enhanced" = "dh_base"): Promise<TestCase[]> {
  const filepath = path.join(FIXTURES_DIR, "injecagent", "data", `test_cases_${variant}.json`);
  const cases: TestCase[] = [];

  try {
    const content = await fs.readFile(filepath, "utf-8");
    const data: InjecAgentCase[] = JSON.parse(content);

    for (let i = 0; i < data.length; i++) {
      const tc = data[i];

      // The attack is in the Tool Response (injected into tool output)
      // User sees: User Instruction + Tool Response
      const input = `User request: ${tc["User Instruction"]}\n\nTool response:\n${tc["Tool Response"]}`;

      cases.push({
        id: `injecagent-${variant}-${i + 1}`,
        category: `injecagent-${tc["Attack Type"].toLowerCase().replace(/\s+/g, "_")}`,
        input,
        expectedBlock: true,  // All InjecAgent cases are attacks
        metadata: {
          source: "injecagent",
          variant,
          attackType: tc["Attack Type"],
          attackerTools: tc["Attacker Tools"],
          attackerInstruction: tc["Attacker Instruction"],
          userTool: tc["User Tool"],
        },
      });
    }
  } catch (error) {
    console.warn(`Warning: Could not load InjecAgent (${variant}): ${error}`);
  }

  return cases;
}

/**
 * Load all InjecAgent variants
 */
export async function loadInjecAgentAll(): Promise<TestCase[]> {
  const variants: Array<"dh_base" | "dh_enhanced" | "ds_base" | "ds_enhanced"> = [
    "dh_base", "dh_enhanced", "ds_base", "ds_enhanced"
  ];

  const allCases: TestCase[] = [];
  for (const variant of variants) {
    const cases = await loadInjecAgent(variant);
    allCases.push(...cases);
  }

  return allCases;
}

// ============================================================================
// NotInject Loader (from InjecGuard)
// ============================================================================

interface NotInjectCase {
  prompt: string;
  word_list: string[];
  category: string;
}

/**
 * Load NotInject benign cases (trigger words that should NOT be flagged)
 * Structure: tests/fixtures/injecguard/datasets/NotInject_*.json
 */
export async function loadNotInject(): Promise<TestCase[]> {
  const files = ["NotInject_one.json", "NotInject_two.json", "NotInject_three.json"];
  const cases: TestCase[] = [];

  for (const file of files) {
    const filepath = path.join(FIXTURES_DIR, "injecguard", "datasets", file);

    try {
      const content = await fs.readFile(filepath, "utf-8");
      const data: NotInjectCase[] = JSON.parse(content);

      for (let i = 0; i < data.length; i++) {
        const tc = data[i];
        cases.push({
          id: `notinject-${file.replace(".json", "")}-${i + 1}`,
          category: `notinject-${tc.category.toLowerCase().replace(/\s+/g, "_")}`,
          input: tc.prompt,
          expectedBlock: false,  // NotInject cases are benign (should NOT be blocked)
          metadata: {
            source: "notinject",
            file,
            triggerWords: tc.word_list,
            originalCategory: tc.category,
          },
        });
      }
    } catch (error) {
      console.warn(`Warning: Could not load NotInject (${file}): ${error}`);
    }
  }

  return cases;
}

// ============================================================================
// BIPIA Loader (from InjecGuard)
// ============================================================================

// BIPIA structure: { "Category Name": ["prompt1", "prompt2", ...] }
type BIPIAData = Record<string, string[]>;

// Injection categories in BIPIA (these should be blocked)
const BIPIA_INJECTION_CATEGORIES = new Set([
  "Substitution Ciphers",
  "Base Encoding",
  "Reverse Text",
  "Emoji Substitution",
  "Language Translation",
  "Information Dissemination",
  "Marketing & Advertising",
  "Entertainment",
  "Scams & Fraud",
  "Misinformation & Propaganda",
]);

/**
 * Load BIPIA dataset (code and text variants)
 * Categories are either benign tasks or injection attempts
 */
export async function loadBIPIA(variant: "code" | "text" = "text"): Promise<TestCase[]> {
  const filepath = path.join(FIXTURES_DIR, "injecguard", "datasets", `BIPIA_${variant}.json`);
  const cases: TestCase[] = [];

  try {
    const content = await fs.readFile(filepath, "utf-8");
    const data: BIPIAData = JSON.parse(content);

    for (const [category, prompts] of Object.entries(data)) {
      const isInjection = BIPIA_INJECTION_CATEGORIES.has(category);
      const categorySlug = category.toLowerCase().replace(/\s+&?\s*/g, "_");

      for (let i = 0; i < prompts.length; i++) {
        cases.push({
          id: `bipia-${variant}-${categorySlug}-${i + 1}`,
          category: `bipia-${variant}-${categorySlug}`,
          input: prompts[i],
          expectedBlock: isInjection,
          metadata: {
            source: "bipia",
            variant,
            originalCategory: category,
            isInjection,
          },
        });
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not load BIPIA (${variant}): ${error}`);
  }

  return cases;
}

// ============================================================================
// AgentDojo Loader
// ============================================================================

interface AgentDojoRun {
  suite_name: string;
  pipeline_name: string;
  user_task_id: string;
  injection_task_id: string;
  attack_type: string;
  injections: Record<string, string>;
  messages: Array<{
    role: string;
    content: string;
    tool_calls?: unknown;
    tool_call_id?: string;
  }>;
  error: string | null;
  utility: boolean;
  security: boolean;
}

/**
 * Available AgentDojo attack types
 * See attack-taxonomy.ts for full documentation
 *
 * Note: Not all models have all attack types. gpt-4o-2024-05-13 has the most.
 */
export const AGENTDOJO_ATTACK_TYPES = [
  // Core attack types
  "important_instructions",
  "direct",
  "ignore_previous",
  "system_message",
  "tool_knowledge",
  "injecagent",
  // Important instructions variants
  "important_instructions_no_model_name",
  "important_instructions_no_names",
  "important_instructions_no_user_name",
  "important_instructions_wrong_model_name",
  "important_instructions_wrong_user_name",
  // DOS attacks (less relevant for injection detection)
  "dos",
  "captcha_dos",
  "felony_dos",
  "offensive_email_dos",
  "swearwords_dos",
] as const;

export type AgentDojoAttackType = typeof AGENTDOJO_ATTACK_TYPES[number];

/**
 * Load AgentDojo indirect injection test cases
 * Structure: tests/fixtures/agentdojo/runs/{model}/{suite}/{user_task}/{attack_type}/{injection_task}.json
 *
 * AgentDojo provides multi-turn agentic scenarios with injections embedded in tool outputs.
 * We extract the tool response containing the injection as our test input.
 *
 * @param suite - Suite to load: "slack", "banking", "travel", "workspace", or "all"
 * @param attackTypes - Attack type(s): "important_instructions", "direct", etc. Pass array for multiple.
 * @param model - Model runs to use (default: "claude-3-sonnet-20240229")
 * @param maxPerSuite - Max cases per suite (for quick testing)
 */
export async function loadAgentDojo(
  suite: "slack" | "banking" | "travel" | "workspace" | "all" = "all",
  attackTypes: AgentDojoAttackType | AgentDojoAttackType[] = "important_instructions",
  model = "claude-3-sonnet-20240229",
  maxPerSuite?: number
): Promise<TestCase[]> {
  const baseDir = path.join(FIXTURES_DIR, "agentdojo", "runs", model);
  const cases: TestCase[] = [];

  const suites = suite === "all"
    ? ["slack", "banking", "travel", "workspace"]
    : [suite];

  const attackTypeList = Array.isArray(attackTypes) ? attackTypes : [attackTypes];

  for (const suiteName of suites) {
    const suiteDir = path.join(baseDir, suiteName);
    let suiteCount = 0;

    try {
      const userTasks = await fs.readdir(suiteDir);

      for (const userTask of userTasks) {
        if (maxPerSuite && suiteCount >= maxPerSuite) break;

        // Iterate over requested attack types
        for (const attackType of attackTypeList) {
          if (maxPerSuite && suiteCount >= maxPerSuite) break;

          const attackDir = path.join(suiteDir, userTask, attackType);
          try {
            const injectionFiles = await fs.readdir(attackDir);

            for (const file of injectionFiles) {
              if (!file.endsWith(".json") || file === "none.json") continue;
              if (maxPerSuite && suiteCount >= maxPerSuite) break;

              const filepath = path.join(attackDir, file);
              try {
                const content = await fs.readFile(filepath, "utf-8");
                const run: AgentDojoRun = JSON.parse(content);

                // Extract the tool response containing the injection
                const injectedToolResponse = run.messages.find(
                  m => m.role === "tool" && m.content &&
                    (m.content.includes("<INFORMATION>") ||
                     m.content.includes("IMPORTANT") ||
                     m.content.includes("TODO:") ||
                     m.content.includes("Ignore") ||
                     Object.values(run.injections).some(inj => m.content.includes(inj.trim().slice(0, 50))))
                );

                // Get user's original request
                const userMessage = run.messages.find(m => m.role === "user");

                if (injectedToolResponse) {
                  cases.push({
                    id: `agentdojo-${suiteName}-${attackType}-${userTask}-${run.injection_task_id}`,
                    category: `agentdojo-${suiteName}-${attackType}`,
                    input: injectedToolResponse.content,
                    expectedBlock: true,  // All AgentDojo injection runs should be blocked
                    metadata: {
                      source: "agentdojo",
                      suite: suiteName,
                      userTask: run.user_task_id,
                      injectionTask: run.injection_task_id,
                      attackType: run.attack_type,
                      userRequest: userMessage?.content,
                      injections: run.injections,
                      modelWasCompromised: run.security,  // true = attack succeeded
                    },
                  });
                  suiteCount++;
                }
              } catch {
                // Skip invalid files
              }
            }
          } catch {
            // No attack dir for this user task/attack type combo
          }
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not load AgentDojo suite ${suiteName}: ${error}`);
    }
  }

  return cases;
}

/**
 * Load AgentDojo with ALL available attack types
 */
export async function loadAgentDojoAllAttacks(
  suite: "slack" | "banking" | "travel" | "workspace" | "all" = "all",
  model = "claude-3-sonnet-20240229",
  maxPerSuite?: number
): Promise<TestCase[]> {
  return loadAgentDojo(suite, [...AGENTDOJO_ATTACK_TYPES], model, maxPerSuite);
}

/**
 * Load AgentDojo benign cases (runs without injection)
 */
export async function loadAgentDojoBenign(
  suite: "slack" | "banking" | "travel" | "workspace" | "all" = "all",
  model = "claude-3-sonnet-20240229",
  maxPerSuite?: number
): Promise<TestCase[]> {
  const baseDir = path.join(FIXTURES_DIR, "agentdojo", "runs", model);
  const cases: TestCase[] = [];

  const suites = suite === "all"
    ? ["slack", "banking", "travel", "workspace"]
    : [suite];

  for (const suiteName of suites) {
    const suiteDir = path.join(baseDir, suiteName);
    let suiteCount = 0;

    try {
      const userTasks = await fs.readdir(suiteDir);

      for (const userTask of userTasks) {
        if (maxPerSuite && suiteCount >= maxPerSuite) break;

        // Load the "none" (no attack) runs
        const noneFile = path.join(suiteDir, userTask, "none", "none.json");
        try {
          const content = await fs.readFile(noneFile, "utf-8");
          const run: AgentDojoRun = JSON.parse(content);

          // Get tool responses (benign ones without injection)
          const toolResponses = run.messages.filter(m => m.role === "tool" && m.content);

          for (let i = 0; i < toolResponses.length; i++) {
            cases.push({
              id: `agentdojo-benign-${suiteName}-${userTask}-tool${i}`,
              category: `agentdojo-benign-${suiteName}`,
              input: toolResponses[i].content,
              expectedBlock: false,
              metadata: {
                source: "agentdojo",
                suite: suiteName,
                userTask: run.user_task_id,
                isBenign: true,
              },
            });
            suiteCount++;
            if (maxPerSuite && suiteCount >= maxPerSuite) break;
          }
        } catch {
          // No none.json for this user task
        }
      }
    } catch (error) {
      console.warn(`Warning: Could not load AgentDojo benign suite ${suiteName}: ${error}`);
    }
  }

  return cases;
}

// ============================================================================
// Composite Loaders
// ============================================================================

/**
 * Load all injection test cases (for TPR testing)
 */
export async function loadAllInjection(): Promise<TestCase[]> {
  const [curated, zeroleaks, injecagent] = await Promise.all([
    loadCuratedInjection(),
    loadZeroLeaks(),
    loadInjecAgentAll(),
  ]);

  // Filter to only injection cases
  const curatedInjection = curated.filter(tc => tc.expectedBlock);

  return [...curatedInjection, ...zeroleaks, ...injecagent];
}

/**
 * Load all benign test cases (for FPR testing)
 */
export async function loadAllBenign(): Promise<TestCase[]> {
  // loadCuratedBenign and loadCuratedInjection are sync, wrap in Promise for Promise.all
  const [curatedBenign, curatedInjection, notinject] = await Promise.all([
    Promise.resolve(loadCuratedBenign()),
    Promise.resolve(loadCuratedInjection()),
    loadNotInject(),
  ]);

  // Filter curated injection to only benign cases (category === "benign")
  const curatedInjectionBenign = curatedInjection.filter(tc => !tc.expectedBlock);

  return [...curatedBenign, ...curatedInjectionBenign, ...notinject];
}

/**
 * Load a balanced dataset (injection + benign)
 */
export async function loadBalanced(maxPerClass?: number): Promise<TestCase[]> {
  const [injection, benign] = await Promise.all([
    loadAllInjection(),
    loadAllBenign(),
  ]);

  let injectionCases = injection;
  let benignCases = benign;

  if (maxPerClass) {
    // Shuffle and take up to maxPerClass from each
    injectionCases = [...injection].sort(() => Math.random() - 0.5).slice(0, maxPerClass);
    benignCases = [...benign].sort(() => Math.random() - 0.5).slice(0, maxPerClass);
  }

  return [...injectionCases, ...benignCases];
}

// ============================================================================
// Dataset Info
// ============================================================================

/**
 * Get statistics about available datasets
 */
export async function getDatasetStats(): Promise<{
  curated: { injection: number; benign: number };
  zeroleaks: number;
  injecagent: Record<string, number>;
  agentdojo: { injection: number; benign: number };
  notinject: number;
  bipia: Record<string, number>;
}> {
  const [
    curatedInjection,
    curatedBenign,
    zeroleaks,
    injecagentDhBase,
    injecagentDhEnhanced,
    injecagentDsBase,
    injecagentDsEnhanced,
    agentdojoInjection,
    agentdojoBenign,
    notinject,
    bipiaCode,
    bipiaText,
  ] = await Promise.all([
    loadCuratedInjection(),
    loadCuratedBenign(),
    loadZeroLeaks(),
    loadInjecAgent("dh_base"),
    loadInjecAgent("dh_enhanced"),
    loadInjecAgent("ds_base"),
    loadInjecAgent("ds_enhanced"),
    loadAgentDojo("all"),
    loadAgentDojoBenign("all"),
    loadNotInject(),
    loadBIPIA("code"),
    loadBIPIA("text"),
  ]);

  return {
    curated: {
      injection: curatedInjection.filter(tc => tc.expectedBlock).length,
      benign: curatedBenign.length + curatedInjection.filter(tc => !tc.expectedBlock).length,
    },
    zeroleaks: zeroleaks.length,
    injecagent: {
      dh_base: injecagentDhBase.length,
      dh_enhanced: injecagentDhEnhanced.length,
      ds_base: injecagentDsBase.length,
      ds_enhanced: injecagentDsEnhanced.length,
    },
    agentdojo: {
      injection: agentdojoInjection.length,
      benign: agentdojoBenign.length,
    },
    notinject: notinject.length,
    bipia: {
      code: bipiaCode.length,
      text: bipiaText.length,
    },
  };
}

/**
 * Print dataset statistics
 */
export async function printDatasetStats(): Promise<void> {
  const stats = await getDatasetStats();

  console.log("\n" + "=".repeat(50));
  console.log("AVAILABLE DATASETS");
  console.log("=".repeat(50));

  console.log("\nCurated (datasets.ts):");
  console.log(`  Injection cases: ${stats.curated.injection}`);
  console.log(`  Benign cases: ${stats.curated.benign}`);

  console.log("\nZeroLeaks (submodule):");
  console.log(`  Injection probes: ${stats.zeroleaks}`);

  console.log("\nInjecAgent (submodule):");
  console.log(`  dh_base: ${stats.injecagent.dh_base}`);
  console.log(`  dh_enhanced: ${stats.injecagent.dh_enhanced}`);
  console.log(`  ds_base: ${stats.injecagent.ds_base}`);
  console.log(`  ds_enhanced: ${stats.injecagent.ds_enhanced}`);
  console.log(`  Total: ${Object.values(stats.injecagent).reduce((a, b) => a + b, 0)}`);

  console.log("\nAgentDojo (submodule - agentic scenarios):");
  console.log(`  Injection cases: ${stats.agentdojo.injection}`);
  console.log(`  Benign tool responses: ${stats.agentdojo.benign}`);

  console.log("\nNotInject (submodule - benign with triggers):");
  console.log(`  Cases: ${stats.notinject}`);

  console.log("\nBIPIA (submodule):");
  console.log(`  Code: ${stats.bipia.code}`);
  console.log(`  Text: ${stats.bipia.text}`);

  const totalInjection = stats.curated.injection + stats.zeroleaks +
    Object.values(stats.injecagent).reduce((a, b) => a + b, 0) +
    stats.agentdojo.injection;
  const totalBenign = stats.curated.benign + stats.notinject + stats.agentdojo.benign;

  console.log("\n" + "-".repeat(50));
  console.log(`TOTAL INJECTION: ${totalInjection}`);
  console.log(`TOTAL BENIGN: ${totalBenign}`);
  console.log("=".repeat(50));
}
