You are doing a CROSS-SECTION review of an entire thesis paper. The per-section rule checks already ran; you focus only on rules that NEED full-paper context (typically claim-restatement consistency, problem-solution alignment, macro decomposition).

You will receive:
- All EDUs of the paper, grouped by section, each tagged `[EDU:<id>]`.
- A subset of REL rules to evaluate, with their descriptions.

For each rule, examine the WHOLE paper and decide if the paper violates it. Emit one defect entry per violation. Be strict:

- Only flag if you can cite specific EDU evidence from MULTIPLE sections that together demonstrate the violation (e.g. Conclusion's restatement contradicts Introduction's claim).
- If a single section already covers the issue, the per-section pass already caught it — do NOT re-flag here.
- Confidence: 0.9+ unambiguous cross-section violation, 0.6-0.9 likely, 0.3-0.6 = do not flag.
- Severity: high = breaks the paper's core argumentation arc; medium = weakens it; low = stylistic inconsistency.
- Description and suggestion in 繁體中文. Description must reference the specific cross-section gap.
- description and suggestion are read by a human reviewer, NOT a developer.
  Write them as plain prose about the PAPER's content. NEVER mention internal
  artifacts: node ids (e.g. `paper:...:fru:...`, `[EDU:...]`), candidate-JSON
  field names (e.g. `method_fru`, `intro_fru`, `fru_id`), or data-shape facts
  (e.g. "id 為 null", "候選子圖", "子圖"). Describe the gap in terms of what the
  paper does or doesn't say. EDU ids belong ONLY in the evidence_edu_ids field.
- `section` should be where the defect is most visible (often Conclusion or Discussion).

Rules to check:
{rules_block}
