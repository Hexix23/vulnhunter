# VulnHunter v2 - Autonomous Validation Pipeline

## Overview

This document describes the **4-Gate Autonomous Validation Pipeline** that prevents false positives and ensures only REAL vulnerabilities are reported.

**No human intervention required.** The system automatically:
1. ✅ Analyzes deeply (Codex)
2. ✅ Rejects false positives (Automatic filters)
3. ✅ Searches for contradicting evidence (Documentation search)
4. ✅ Validates CVSS scores (Automatic validation)
5. ✅ Independent review (Code-Reviewer agent)

---

## The Problem We're Solving

**Without validation:**
- Codex finds "differences" and calls them "vulnerabilities"
- A pretty report gets generated
- Report gets rejected by Google (because findings are false positives)
- Wasted effort

**With autonomous validation:**
- False positives are REJECTED AUTOMATICALLY
- Only defensible findings make it to the report
- 90%+ confidence before submission

---

## The 4-Gate Pipeline

### **GATE 1: Automatic Rejection Filters**

Reject findings that match known false-positive patterns:

```
✗ Finding is documented as intentional/by design
✗ Finding is a known issue with a planned fix
✗ Finding requires schema misconfiguration
✗ Finding is about legacy backward-compat behavior
```

**If ANY filter matches:** Finding is REJECTED

---

### **GATE 2: Documentation Search**

Automatically search the target codebase for evidence that contradicts the finding:

```
✓ Search docs/design/ for mentions of the finding
✓ Look for "known issue", "TODO", "RFC", "design trade-off"
✓ Search README and CHANGELOG
✓ Check code comments near the vulnerable code
```

**If evidence found:** Finding is REJECTED

**This is what caught our Protocol Buffers false positives:**
- Codex found "inconsistencies" 
- Gate 2 searched docs/ and found: "edition-zero-json-handling.md explicitly documents these inconsistencies"
- Finding REJECTED as false positive

---

### **GATE 3: CVSS Score Validation**

Automatically verify CVSS scores are realistic:

```
If CVSS > 6.0:
  ✓ Check for RCE, auth bypass, or data breach
  ✗ If none of these: Score is INFLATED
  → REJECT finding with inflated score
```

**This catches:**
- Medium/P3 scores given to design differences
- High/P2 scores for issues that need schema misconfiguration

---

### **GATE 4: Independent Code Review**

Spawn a **completely different agent** (code-reviewer) to validate findings:

```
Code-Reviewer job:
  ✗ Find FALSE POSITIVES (not validate findings)
  ✗ Be SKEPTICAL
  ✗ Search for contradictions

Returns:
  - VALID: Real vulnerabilities
  - FALSE_POSITIVE: Not real
  - CONFIDENCE: HIGH/MEDIUM/LOW
```

**If confidence < MEDIUM or false positives found:** REJECT

---

## Implementation

### File Structure

```
vulnhunter/
├── validation/
│   └── validation-pipeline.sh          ← Main validation script
├── run.sh                              ← Modified to call validation
└── AUTONOMOUS_VALIDATION_GUIDE.md      ← This file
```

### How It Works in run.sh

```bash
# After complete_analysis phase:

PHASE_OUTPUT=$(run_phase "complete_analysis" "$IS_RESUME")

# NEW: Mandatory validation before reporting
log "INFO" "Running autonomous validation pipeline..."
if ! bash "$SCRIPT_DIR/validation/validation-pipeline.sh" \
    "$FINDINGS_FILE" "$TARGET"; then
    
    log "ERROR" "Validation failed - report rejected"
    exit 1
fi

# Only if validation PASSED:
log "INFO" "Validation passed - generating report"
generate_report
```

### Modified run.sh Section

Add this after the phases loop (around line 575):

```bash
# ============================================================================
# MANDATORY VALIDATION PIPELINE
# ============================================================================

if [ ${#PHASES_TO_RUN[@]} -gt 0 ]; then
    log "INFO" "========================================="
    log "INFO" "VALIDATION PIPELINE - Autonomous Check"
    log "INFO" "========================================="
    
    # Run validation pipeline
    if bash "$SCRIPT_DIR/validation/validation-pipeline.sh" \
        "$FINDINGS_FILE" "$TARGET"; then
        
        log "INFO" "✅ Validation PASSED"
        VALIDATION_PASSED=true
    else
        log "ERROR" "❌ Validation FAILED"
        log "ERROR" "Report generation ABORTED"
        VALIDATION_PASSED=false
    fi
    
    # Only generate report if validation passed
    if [ "$VALIDATION_PASSED" = false ]; then
        log "ERROR" "Analysis findings did not pass validation"
        log "ERROR" "To review validation logs, see: $VALIDATION_LOG"
        exit 1
    fi
fi
```

---

## Usage

### Run with validation (default, automatic):

```bash
./run.sh --provider google --target targets/protobuf --background
```

This automatically:
1. Analyzes (Codex)
2. Validates (4-gate pipeline)
3. Reports (only if passed validation)

### Skip validation (for testing only):

```bash
SKIP_VALIDATION=true ./run.sh --provider google --target targets/protobuf
```

**NOT RECOMMENDED for real submissions**

### Check validation results:

```bash
tail -f validation.log

# Sample output:
[VALIDATION] === GATE 1: AUTOMATIC REJECTION FILTERS ===
[VALIDATION] Gate 1 Result: 2 findings rejected by automatic filters
[ERROR] VALIDATION FAILED: Gate 2 - Contradictions found in documentation
```

---

## Scoring System

Each finding gets a confidence score (0-100):

| Component | Points | Criteria |
|-----------|--------|----------|
| Base | +10/finding | Number of findings × 10 |
| PoC Code | +25 | Has proof of concept |
| CVSS Score | +10 | Includes CVSS v3.1 |
| Official Docs | +15 | Cites target's documentation |
| Multi-Impl | +20 | Shows implementation divergence |
| All Gates Pass | +30 | Passes all validation gates |

**Score ranges:**
- **80+:** Safe to report ✅
- **60-79:** Borderline (manual review recommended)
- **<60:** DO NOT REPORT ❌

---

## What Happens to False Positives

When a finding fails validation:

1. **Gate 1 rejects it** → Log: "REJECTED: Finding documented as intentional"
2. **Gate 2 finds contradictions** → Log: "CONTRADICTION: Finding documented in docs/"
3. **Gate 3 validates CVSS** → Log: "INFLATED: CVSS score unjustified"
4. **Gate 4 reviewer disagrees** → Log: "Code-reviewer found FALSE_POSITIVE"

Result: **Entire report is rejected**, preventing false submission

---

## Example: Protocol Buffers

**Before validation pipeline:**
```
Codex: Found 4 JSON parser vulnerabilities
Report generated: GOOGLE_VRP_REPORT.md
Ready to submit to Google
❌ MISTAKE: Most are false positives
```

**After validation pipeline:**
```
Codex: Found 4 JSON parser vulnerabilities
Gate 1: Rejects 2 (documented as design trade-offs)
Gate 2: Rejects 1 (contradicted by edition-zero-json-handling.md)
Gate 3: Rejects 1 (CVSS score inflated)
Gate 4: Code-reviewer confirms 3 false positives

Result: ❌ VALIDATION FAILED
Report NOT generated
Prevents false submission to Google ✅
```

---

## Customization

### Add more rejection filters

Edit `validation-pipeline.sh`, function `gate_1_rejection_filters()`:

```bash
# FILTER 5: Add your custom filter
while IFS= read -r line; do
    if echo "$line" | grep -q "your_pattern"; then
        warn "REJECTED: Custom reason: $line"
        rejected_count=$((rejected_count + 1))
    fi
done < <(echo "$findings" | grep "FINDING")
```

### Change confidence threshold

Edit the validation script at the bottom:

```bash
if [ "$CONFIDENCE" -ge 85 ]; then  # Changed from 80
    log "✅ VALIDATION PASSED"
    exit 0
fi
```

### Disable individual gates (for testing)

Set environment variables:

```bash
SKIP_GATE_1=true ./run.sh --provider google --target targets/protobuf
SKIP_GATE_2=true ./run.sh --provider google --target targets/protobuf
```

---

## Monitoring & Debugging

### View validation logs:

```bash
tail -100 validation.log

# Filter by gate:
grep "GATE 1" validation.log
grep "CONTRADICTION" validation.log
grep "INFLATED" validation.log
```

### Test validation pipeline manually:

```bash
bash validation/validation-pipeline.sh \
    findings/findings_20260412_*.txt \
    targets/protobuf

# Output:
# [VALIDATION] === GATE 1: AUTOMATIC REJECTION FILTERS ===
# [WARN] REJECTED: Finding documented as intentional: ...
# [VALIDATION] Gate 1 Result: 2 findings rejected
# ...
# [ERROR] VALIDATION FAILED: Gate 2 - Contradictions found
```

---

## FAQ

**Q: Can a finding pass all 4 gates and still be wrong?**

A: Unlikely but possible. The system is designed to be conservative (reject more than necessary) rather than permissive. If you're 100% certain it's valid, you can override with `--skip-validation` (not recommended).

**Q: How long does validation take?**

A: ~2-5 minutes depending on:
- Gate 2 (document search): 1-2 min
- Gate 4 (code-reviewer): 1-3 min

Acceptable for production use.

**Q: What if Code-Reviewer gets it wrong?**

A: Then your findings don't get reported. This is safer than reporting false positives. You can manually review and escalate if confident.

**Q: Can I customize the gates?**

A: Yes, edit `validation-pipeline.sh`. But be careful - weakening validation defeats the purpose.

---

## Summary

The autonomous validation pipeline ensures:

✅ **No false positives** submitted to Google  
✅ **High confidence** in reported findings  
✅ **Zero human intervention** required  
✅ **Consistent criteria** across all analyses  
✅ **Defensible reports** that Google accepts  

**Result:** Higher acceptance rate, higher rewards, zero wasted effort.
