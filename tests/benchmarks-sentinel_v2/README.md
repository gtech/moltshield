# HuggingFace Benchmark Scripts

Python scripts to run prompt injection detection benchmarks using the 
`qualifire/prompt-injection-jailbreak-sentinel-v2` model.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

### Quick Model Test
Verify the model loads and works:
```bash
python test_model.py
```

### Run All Benchmarks
```bash
python run_benchmarks.py
```

### Run Specific Benchmarks
```bash
# Best-of-N attacks only
python run_benchmarks.py --benchmark bon

# DATDP datasets only
python run_benchmarks.py --benchmark datdp

# False positive tests only
python run_benchmarks.py --benchmark fp

# ZeroLeaks injection probes (separate script)
python run_zeroleaks.py
python run_zeroleaks.py --category persona --verbose
python run_zeroleaks.py --category direct --category social
```

### Options
- `--verbose` or `-v`: Show detailed output for failures
- `--max-prompts N`: Limit prompts per dataset (for quick tests)
- `--output FILE`: Save results to JSON file
- `--device cuda/cpu`: Force specific device

### Examples
```bash
# Quick test with 50 prompts per dataset
python run_benchmarks.py --max-prompts 50

# Full run with JSON output
python run_benchmarks.py --output results.json --verbose

# DATDP only with GPU
python run_benchmarks.py -b datdp --device cuda

# ZeroLeaks specific categories
python run_zeroleaks.py -c persona -c modern --output zeroleaks-results.json
```

## Benchmarks

1. **BoN Attacks** (`run_benchmarks.py --benchmark bon`): Tests detection of Best-of-N augmented harmful prompts
   - Random capitalization
   - Leetspeak
   - Unicode confusables
   - Invisible characters
   - Mixed techniques

2. **DATDP** (`run_benchmarks.py --benchmark datdp`): Official DATDP dataset benchmark
   - BoN jailbreak prompts (should block)
   - Normal prompts (should pass)
   - Original harmful prompts (should block)

3. **False Positives** (`run_benchmarks.py --benchmark fp`): Benign prompts that should NOT be blocked
   - General questions
   - Programming help
   - Security research
   - Creative writing
   - Edge cases

4. **ZeroLeaks** (`run_zeroleaks.py`): Comprehensive injection probe suite
   - Direct extraction attempts
   - Persona attacks (DAN, DUDE, STAN, Developer Mode)
   - Social engineering
   - Technical injection markers
   - Modern attacks (Crescendo, Many-Shot, Skeleton Key)
   - Encoding bypasses (Base64, ROT13, ASCII art)

## Pass Criteria
- BoN Detection Rate: >= 95%
- DATDP True Positive Rate: >= 95%
- DATDP False Positive Rate: <= 1%
- DATDP F1 Score: >= 0.95
- FP Rate: < 1%
- ZeroLeaks Defense Rate: >= 95%
