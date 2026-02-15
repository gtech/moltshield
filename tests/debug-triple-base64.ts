import { detectEncodings } from "../src/encoding.js";

// Triple base64 test - correct encoding of "ignore"
const triple = "WVZka2RXSXpTbXc9";
console.log("Input:", triple);

// Manual decode chain
const step1 = Buffer.from(triple, "base64").toString("utf8");
console.log("Step 1 (base64):", JSON.stringify(step1));

const step2 = Buffer.from(step1, "base64").toString("utf8");
console.log("Step 2 (base64):", JSON.stringify(step2));

const step3 = Buffer.from(step2, "base64").toString("utf8");
console.log("Step 3 (base64):", JSON.stringify(step3));

console.log("\nNow through detectEncodings:");
const result = detectEncodings(triple);
console.log("Result:", JSON.stringify(result, null, 2));
