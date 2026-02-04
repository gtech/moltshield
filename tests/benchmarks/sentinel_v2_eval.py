#!/usr/bin/env python3
"""
Evaluate sentinel_v2 on indirect injection benchmark results.

Loads model locally with aggressive memory management.

Usage:
    HF_TOKEN=xxx python3 tests/benchmarks/sentinel_v2_eval.py [results_file]

Kill: Ctrl+C saves partial results
"""

import json
import sys
import os
import gc
from pathlib import Path

MODEL_NAME = "qualifire/prompt-injection-jailbreak-sentinel-v2"


def load_results(filepath: str) -> dict:
    with open(filepath) as f:
        return json.load(f)


def main():
    # Check for HF token
    token = os.environ.get("HF_TOKEN")
    if not token:
        print("WARNING: HF_TOKEN not set, model may require authentication")

    # Find results file
    if len(sys.argv) < 2:
        data_dir = Path("data")
        files = sorted(data_dir.glob("indirect-injection-*.json"))
        files = [f for f in files if "-sentinel" not in str(f)]
        if not files:
            print("No indirect injection results found.")
            sys.exit(1)
        filepath = str(files[-1])
    else:
        filepath = sys.argv[1]

    print("=" * 70)
    print("SENTINEL_V2 EVALUATION (LOCAL)")
    print("=" * 70)
    print(f"Results file: {filepath}")
    print(f"Model: {MODEL_NAME}")

    # Load results first (before heavy model)
    data = load_results(filepath)
    results = data["results"]
    print(f"Test cases: {len(results)}")

    # Memory check
    try:
        import psutil
        mem = psutil.virtual_memory()
        print(f"Available RAM: {mem.available / 1024**3:.1f}GB")
        if mem.available < 2 * 1024**3:
            print("WARNING: Less than 2GB RAM available!")
    except ImportError:
        pass

    # Load model with memory optimization
    print("\nLoading model (this may take a moment)...")
    print("Press Ctrl+C to abort if memory gets tight.\n")

    try:
        import torch
        from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification

        # Force CPU, disable gradients
        torch.set_grad_enabled(False)

        tokenizer = AutoTokenizer.from_pretrained(
            MODEL_NAME,
            token=token,
            use_fast=True
        )

        model = AutoModelForSequenceClassification.from_pretrained(
            MODEL_NAME,
            token=token,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
        )
        model.eval()

        pipe = pipeline(
            "text-classification",
            model=model,
            tokenizer=tokenizer,
            device="cpu",
        )

        print("Model loaded successfully!")

    except Exception as e:
        print(f"FAILED to load model: {e}")
        print("\nTry: pip install transformers torch")
        sys.exit(1)

    # Run classification
    print("\nRunning sentinel_v2 classification...")
    print("Press Ctrl+C to abort and save partial results.\n")

    sentinel_results = []
    try:
        for i, r in enumerate(results):
            text = r["response"][:512]

            try:
                result = pipe(text, truncation=True, max_length=512)
                label = result[0]["label"]
                score = result[0]["score"]

                # Check label format
                is_injection = (
                    label == "LABEL_1" or
                    "jailbreak" in label.lower() or
                    "injection" in label.lower()
                )

                sentinel_results.append({
                    **r,
                    "sentinel_label": label,
                    "sentinel_score": score,
                    "sentinel_detected": is_injection,
                })

                status = "INJ" if is_injection else "OK "
                print(f"  [{i+1:2}/{len(results)}] {r['id']:<12} {status} {label} ({score:.3f})")

            except Exception as e:
                print(f"  [{i+1:2}/{len(results)}] {r['id']:<12} ERROR: {e}")
                sentinel_results.append({
                    **r,
                    "sentinel_label": "ERROR",
                    "sentinel_score": 0.0,
                    "sentinel_detected": False,
                })

            # Periodic memory cleanup
            if i % 5 == 0:
                gc.collect()

    except KeyboardInterrupt:
        print("\n\nAborted. Saving partial results...")

    # Cleanup model immediately
    print("\nCleaning up model...")
    del pipe, model, tokenizer
    gc.collect()

    if not sentinel_results:
        print("No results.")
        sys.exit(1)

    # Calculate metrics
    manipulated = [r for r in sentinel_results if r["wasManipulated"]]
    clean = [r for r in sentinel_results if not r["wasManipulated"]]

    # Sentinel metrics
    s_tp = len([r for r in manipulated if r["sentinel_detected"]])
    s_fn = len([r for r in manipulated if not r["sentinel_detected"]])
    s_tn = len([r for r in clean if not r["sentinel_detected"]])
    s_fp = len([r for r in clean if r["sentinel_detected"]])

    s_tpr = s_tp / len(manipulated) if manipulated else 1
    s_tnr = s_tn / len(clean) if clean else 1
    s_fpr = s_fp / len(clean) if clean else 0
    s_precision = s_tp / (s_tp + s_fp) if (s_tp + s_fp) > 0 else 1
    s_f1 = 2 * (s_precision * s_tpr) / (s_precision + s_tpr) if (s_precision + s_tpr) > 0 else 0

    # Exchange metrics
    e_tp = len([r for r in manipulated if r["exchangeDetected"]])
    e_tn = len([r for r in clean if not r["exchangeDetected"]])
    e_fp = len([r for r in clean if r["exchangeDetected"]])

    e_tpr = e_tp / len(manipulated) if manipulated else 1
    e_tnr = e_tn / len(clean) if clean else 1
    e_fpr = e_fp / len(clean) if clean else 0
    e_precision = e_tp / (e_tp + e_fp) if (e_tp + e_fp) > 0 else 1
    e_f1 = 2 * (e_precision * e_tpr) / (e_precision + e_tpr) if (e_precision + e_tpr) > 0 else 0

    # Print comparison
    print("\n" + "=" * 70)
    print("RESULTS COMPARISON")
    print("=" * 70)

    print(f"\nManipulated: {len(manipulated)}, Clean: {len(clean)}")

    print("\n" + "-" * 70)
    print(f"{'Metric':<25} {'Sentinel_v2':>15} {'Exchange':>15}")
    print("-" * 70)
    print(f"{'TPR (detect manip.)':<25} {s_tpr*100:>14.1f}% {e_tpr*100:>14.1f}%")
    print(f"{'TNR (pass clean)':<25} {s_tnr*100:>14.1f}% {e_tnr*100:>14.1f}%")
    print(f"{'FPR (false alarms)':<25} {s_fpr*100:>14.1f}% {e_fpr*100:>14.1f}%")
    print(f"{'Precision':<25} {s_precision*100:>14.1f}% {e_precision*100:>14.1f}%")
    print(f"{'F1 Score':<25} {s_f1:>15.3f} {e_f1:>15.3f}")
    print("-" * 70)

    # Case-by-case
    print("\n[M=Manipulated, S=Sentinel, E=Exchange]")
    for r in sentinel_results:
        m = "M" if r["wasManipulated"] else " "
        s = "✓" if r["sentinel_detected"] else "✗"
        e = "✓" if r["exchangeDetected"] else "✗"
        print(f"  [{r['id']:<12}] {m} S:{s} E:{e}  {r['category']}")

    # Save
    output_file = filepath.replace(".json", "-sentinel.json")
    with open(output_file, "w") as f:
        json.dump({
            "original_file": filepath,
            "sentinel_metrics": {"tpr": s_tpr, "tnr": s_tnr, "fpr": s_fpr, "precision": s_precision, "f1": s_f1},
            "exchange_metrics": {"tpr": e_tpr, "tnr": e_tnr, "fpr": e_fpr, "precision": e_precision, "f1": e_f1},
            "results": sentinel_results,
        }, f, indent=2)

    print(f"\nSaved to {output_file}")


if __name__ == "__main__":
    main()
