#!/usr/bin/env python3
"""
Local Classifier Backend

Simple inference server that reads JSON from stdin and writes results to stdout.
Used by TypeScript harness for local transformer inference.

Usage:
    echo '{"text": "test input"}' | .venv/bin/python tests/benchmarks/local-classifier.py --model pg2
"""

import argparse
import json
import sys

import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification


MODELS = {
    "pg2": "meta-llama/Llama-Prompt-Guard-2-86M",
    "deberta": "protectai/deberta-v3-base-prompt-injection-v2",
}


def load_model(model_key: str):
    """Load model and tokenizer."""
    model_id = MODELS[model_key]
    tokenizer = AutoTokenizer.from_pretrained(model_id)
    model = AutoModelForSequenceClassification.from_pretrained(model_id)
    model.eval()
    return tokenizer, model


def classify(text: str, tokenizer, model) -> dict:
    """Classify a single text input."""
    inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=512)

    with torch.no_grad():
        logits = model(**inputs).logits

    probs = torch.softmax(logits, dim=-1)[0]
    pred_id = logits.argmax().item()
    pred_label = model.config.id2label[pred_id]

    # Handle different label formats
    if pred_label in ("LABEL_0", "LABEL_1"):
        is_injection = pred_id == 1  # LABEL_1 = injection
        confidence = probs[pred_id].item()
    else:
        is_injection = pred_label.upper() in ("INJECTION", "JAILBREAK", "MALICIOUS")
        confidence = probs[pred_id].item()

    return {
        "blocked": is_injection,
        "confidence": confidence,
        "label": pred_label,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", "-m", choices=list(MODELS.keys()), required=True)
    parser.add_argument("--batch", "-b", action="store_true", help="Read multiple JSON objects, one per line")
    args = parser.parse_args()

    # Load model once
    tokenizer, model = load_model(args.model)

    # Signal ready
    print(json.dumps({"status": "ready", "model": MODELS[args.model]}), flush=True)

    if args.batch:
        # Batch mode: read lines until EOF
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                request = json.loads(line)
                result = classify(request["text"], tokenizer, model)
                print(json.dumps(result), flush=True)
            except Exception as e:
                print(json.dumps({"error": str(e)}), flush=True)
    else:
        # Single request mode
        try:
            request = json.loads(sys.stdin.read())
            result = classify(request["text"], tokenizer, model)
            print(json.dumps(result))
        except Exception as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)


if __name__ == "__main__":
    main()
