/**
 * Data Loaders Unit Tests
 *
 * Verifies all benchmark data loaders work correctly and return expected data.
 * Run with: npx vitest run tests/unit/loaders.test.ts
 */
import {
  loadCuratedInjection,
  loadCuratedBenign,
  loadZeroLeaks,
  loadInjecAgent,
  loadInjecAgentAll,
  loadNotInject,
  loadBIPIA,
  loadAgentDojo,
  loadAgentDojoBenign,
  loadAllInjection,
  loadAllBenign,
  loadBalanced,
  getDatasetStats,
} from "../benchmarks/framework/loaders.js";
import type { TestCase } from "../benchmarks/framework/harness.js";

// ============================================================================
// Test Utilities
// ============================================================================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.log(`  ✗ ${message}`);
  }
}

function assertGt(actual: number, expected: number, message: string): void {
  assert(actual > expected, `${message} (${actual} > ${expected})`);
}

function assertEq(actual: unknown, expected: unknown, message: string): void {
  assert(actual === expected, `${message} (${actual} === ${expected})`);
}

function validateTestCase(tc: TestCase, source: string): boolean {
  const hasId = typeof tc.id === "string" && tc.id.length > 0;
  const hasCategory = typeof tc.category === "string" && tc.category.length > 0;
  const hasInput = typeof tc.input === "string" && tc.input.length > 0;
  const hasExpectedBlock = typeof tc.expectedBlock === "boolean";

  if (!hasId || !hasCategory || !hasInput || !hasExpectedBlock) {
    console.log(`    Invalid test case from ${source}:`, {
      id: tc.id?.slice(0, 30),
      hasCategory,
      inputLen: tc.input?.length,
      hasExpectedBlock,
    });
    return false;
  }
  return true;
}

// ============================================================================
// Tests
// ============================================================================

async function testCuratedInjection(): Promise<void> {
  console.log("\n[Curated Injection]");
  const cases = loadCuratedInjection();

  assertGt(cases.length, 40, "Has sufficient injection cases");
  assert(cases.every(c => validateTestCase(c, "curated")), "All cases are valid");

  const injectionCases = cases.filter(c => c.expectedBlock);
  const benignCases = cases.filter(c => !c.expectedBlock);
  assertGt(injectionCases.length, 30, "Has injection cases");
  assertGt(benignCases.length, 5, "Has benign control cases");

  const categories = [...new Set(cases.map(c => c.category))];
  assertGt(categories.length, 5, "Has multiple categories");
}

async function testCuratedBenign(): Promise<void> {
  console.log("\n[Curated Benign]");
  const cases = loadCuratedBenign();

  assertGt(cases.length, 40, "Has sufficient benign cases");
  assert(cases.every(c => validateTestCase(c, "curated-benign")), "All cases are valid");
  assert(cases.every(c => !c.expectedBlock), "All cases are benign (expectedBlock=false)");

  const categories = [...new Set(cases.map(c => c.category))];
  assertGt(categories.length, 5, "Has multiple categories");
}

async function testZeroLeaks(): Promise<void> {
  console.log("\n[ZeroLeaks]");
  const cases = await loadZeroLeaks();

  assertGt(cases.length, 200, "Has sufficient probes");
  assert(cases.every(c => validateTestCase(c, "zeroleaks")), "All cases are valid");
  assert(cases.every(c => c.expectedBlock), "All probes are attacks (expectedBlock=true)");

  const categories = [...new Set(cases.map(c => c.category))];
  assertGt(categories.length, 10, "Has multiple attack categories");

  // Check for key attack types
  const hasEncoding = categories.some(c => c.includes("encoding"));
  const hasDirect = categories.some(c => c.includes("direct"));
  assert(hasEncoding, "Has encoding attacks");
  assert(hasDirect, "Has direct attacks");
}

async function testInjecAgent(): Promise<void> {
  console.log("\n[InjecAgent]");

  // Test individual variants
  const variants: Array<"dh_base" | "dh_enhanced" | "ds_base" | "ds_enhanced"> = [
    "dh_base", "dh_enhanced", "ds_base", "ds_enhanced"
  ];

  for (const variant of variants) {
    const cases = await loadInjecAgent(variant);
    assertGt(cases.length, 400, `${variant} has sufficient cases`);
    assert(cases.every(c => c.expectedBlock), `${variant} all are attacks`);
  }

  // Test combined loader
  const allCases = await loadInjecAgentAll();
  assertGt(allCases.length, 2000, "Combined has all cases");
  assert(allCases.every(c => validateTestCase(c, "injecagent")), "All cases are valid");
}

async function testNotInject(): Promise<void> {
  console.log("\n[NotInject]");
  const cases = await loadNotInject();

  assertGt(cases.length, 300, "Has sufficient cases");
  assert(cases.every(c => validateTestCase(c, "notinject")), "All cases are valid");
  assert(cases.every(c => !c.expectedBlock), "All cases are benign (expectedBlock=false)");

  // Check metadata has trigger words
  const withTriggers = cases.filter(c => c.metadata?.triggerWords);
  assertGt(withTriggers.length, 0, "Cases have trigger word metadata");
}

async function testBIPIA(): Promise<void> {
  console.log("\n[BIPIA]");

  const textCases = await loadBIPIA("text");
  const codeCases = await loadBIPIA("code");

  assertGt(textCases.length, 50, "BIPIA text has cases");
  assertGt(codeCases.length, 40, "BIPIA code has cases");

  assert(textCases.every(c => validateTestCase(c, "bipia-text")), "Text cases are valid");
  assert(codeCases.every(c => validateTestCase(c, "bipia-code")), "Code cases are valid");

  // Should have both injection and benign
  const textInjection = textCases.filter(c => c.expectedBlock);
  const textBenign = textCases.filter(c => !c.expectedBlock);
  assertGt(textInjection.length, 0, "BIPIA text has injection cases");
  assertGt(textBenign.length, 0, "BIPIA text has benign cases");
}

async function testAgentDojo(): Promise<void> {
  console.log("\n[AgentDojo]");

  // Test injection cases from each suite
  const suites: Array<"slack" | "banking" | "travel" | "workspace"> = [
    "slack", "banking", "travel", "workspace"
  ];

  let totalInjection = 0;
  for (const suite of suites) {
    const cases = await loadAgentDojo(suite, "important_instructions", "claude-3-sonnet-20240229", 10);
    assertGt(cases.length, 0, `${suite} has injection cases`);
    assert(cases.every(c => c.expectedBlock), `${suite} all are attacks`);
    assert(cases.every(c => validateTestCase(c, `agentdojo-${suite}`)), `${suite} cases are valid`);
    totalInjection += cases.length;
  }
  assertGt(totalInjection, 20, "Total injection cases across suites");

  // Test loading all suites at once
  const allCases = await loadAgentDojo("all", "important_instructions", "claude-3-sonnet-20240229", 20);
  assertGt(allCases.length, 40, "All suites combined has many cases");

  // Check metadata
  const withMetadata = allCases.filter(c =>
    c.metadata?.suite && c.metadata?.injectionTask && c.metadata?.userRequest
  );
  assertGt(withMetadata.length, 0, "Cases have rich metadata");

  // Test benign cases
  const benignCases = await loadAgentDojoBenign("slack", "claude-3-sonnet-20240229", 10);
  assertGt(benignCases.length, 0, "Has benign cases");
  assert(benignCases.every(c => !c.expectedBlock), "Benign cases expect pass");
}

async function testCompositeLoaders(): Promise<void> {
  console.log("\n[Composite Loaders]");

  const allInjection = await loadAllInjection();
  const allBenign = await loadAllBenign();

  assertGt(allInjection.length, 2000, "All injection combines sources");
  assertGt(allBenign.length, 300, "All benign combines sources");

  assert(allInjection.every(c => c.expectedBlock), "All injection cases expect block");
  assert(allBenign.every(c => !c.expectedBlock), "All benign cases expect pass");

  // Test balanced loader
  const balanced = await loadBalanced(100);
  assertGt(balanced.length, 50, "Balanced returns cases");
  const balancedInjection = balanced.filter(c => c.expectedBlock).length;
  const balancedBenign = balanced.filter(c => !c.expectedBlock).length;
  assertGt(balancedInjection, 0, "Balanced has injection");
  assertGt(balancedBenign, 0, "Balanced has benign");
}

async function testDatasetStats(): Promise<void> {
  console.log("\n[Dataset Stats]");

  const stats = await getDatasetStats();

  assertGt(stats.curated.injection, 30, "Stats: curated injection count");
  assertGt(stats.curated.benign, 50, "Stats: curated benign count");
  assertGt(stats.zeroleaks, 200, "Stats: zeroleaks count");
  assertGt(stats.notinject, 300, "Stats: notinject count");
  assertGt(stats.injecagent.dh_base, 400, "Stats: injecagent dh_base count");
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("DATA LOADERS UNIT TESTS");
  console.log("=".repeat(60));

  await testCuratedInjection();
  await testCuratedBenign();
  await testZeroLeaks();
  await testInjecAgent();
  await testNotInject();
  await testBIPIA();
  await testAgentDojo();
  await testCompositeLoaders();
  await testDatasetStats();

  console.log("\n" + "=".repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});
