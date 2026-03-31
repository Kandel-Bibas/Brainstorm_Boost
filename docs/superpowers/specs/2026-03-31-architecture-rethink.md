# Architecture Rethink: Local-First Meeting Intelligence

## The Problem We're Solving

We built Brainstorm Boost's extraction pipeline around Gemini Flash — a cloud model with strong instruction following, 1M context, and reliable JSON output. When we added local model support, we tried to shoehorn 7B models into the same architecture. The results:

| Model | Decisions Found | Action Items | made_by filled | Time |
|-------|----------------|--------------|----------------|------|
| Gemini Flash | 10 | 15 | 10/10 | ~15s |
| Mistral Nemo 12B | 5 | 15 | 0/5 | ~4min |
| Qwen 2.5 7B | 0 | 0 | N/A | ~2min |

The 7B model found ZERO decisions from a meeting with 10+ clear decisions. This isn't a prompt problem — it's an architecture problem.

## What We Got Wrong

1. **Single-model cognitive overload**: We send 2800-char chunks to a 7B model and ask it to simultaneously identify entities, classify confidence, extract verbatim quotes, attribute speakers, and output valid JSON. Too many tasks for a small model.

2. **Processing everything**: 70-80% of a meeting transcript is small talk, information sharing, or context setting. Only 20-30% contains actual decisions/actions/risks. We process all of it equally.

3. **No constrained output**: We generate free-form text and hope it parses as JSON. Constrained decoding (Instructor, llama.cpp grammars) improves both format compliance AND extraction accuracy by 3-4%.

4. **No specialization**: We use a general-purpose model for a specialized task. Research shows fine-tuned 3B models outperform prompted 7B models on specific extraction tasks.

## What the Research Shows

### Competitors
- **Meetily** (7K GitHub stars): Does NOT do structured extraction. Just sends transcript to LLM for prose summaries. Our approach is more sophisticated.
- **Otter.ai, Fireflies**: Cloud-based, likely fine-tuned models. No published architecture.
- **No open-source tool does what we do locally.** This is genuinely novel.

### Key Findings

1. **Hybrid pipelines beat single-model by 11+ F1 points** (ACL 2025). Fast classifier + targeted LLM outperforms LLM-on-everything.

2. **GLiNER2** (205M params, CPU, 200ms): Zero-shot entity extraction with arbitrary custom types. Can classify sentences and extract entities without any training.

3. **SetFit + ModernBERT**: Few-shot text classification with just 8-16 examples per class. Competitive with fine-tuning RoBERTa-Large on 3K examples. 1600x smaller than GPT-3.

4. **Constrained decoding** (Instructor/Pydantic): Improves extraction accuracy by 3-4% beyond just format compliance (JSONSchemaBench, Jan 2025).

5. **Fine-tuning with Unsloth + QLoRA**: 300-500 annotated examples, 1 hour on Google Colab free tier, produces a specialized 3-4B model that outperforms prompted 7B.

6. **ONNX INT8 quantized ModernBERT**: ~20ms per utterance classification on CPU. 2.9-6x speedup over standard inference.

### Available Datasets
- **AMI Corpus**: 100+ hours, 279 meetings, annotated action items and decisions
- **MeetingBank**: 1,366 meetings, 3,579 hours, segment-level annotations
- **QMSum**: Academic/business/governance meetings with query-based summaries

## Three Architectural Options

### Option A: Hybrid Pipeline (Recommended First Step)

```
Transcript (each utterance)
         |
         v
[SetFit/ModernBERT classifier - 86M params, CPU, ~20ms/utterance]
   Classifies: decision | action_item | risk | commitment | other
   Filters out 70-80% of utterances (small talk, info sharing)
         |
         v
[GLiNER2 - 205M params, CPU, ~200ms total]
   Extracts: person names, dates, organizations, topics
   From ALL utterances (fast enough to process everything)
         |
         v
[Qwen 2.5 7B + Instructor - GPU/CPU, ~3-5s per batch]
   Only sees the 20-30% of utterances flagged as decisions/actions/risks
   With surrounding context (2 utterances before/after)
   Constrained JSON output via Pydantic schema
   2-3 few-shot examples in prompt
         |
         v
[Code post-processing]
   Dedup, attribution mapping, relationship building
   Confidence scoring, source quote verification
```

**Performance estimate (1-hour meeting, ~600 utterances):**
- Classifier: 600 x 20ms = 12 seconds
- GLiNER: ~1 second total
- LLM: ~150 flagged utterances in ~10-15 batches x 5s = 50-75 seconds
- Total: ~1.5 minutes (vs ~30 minutes current approach)

**RAM: ~8GB** (ModernBERT 300MB + GLiNER 400MB + Qwen 7B Q4 5GB + overhead)

**Quality estimate:** ~80% of Gemini on explicit items, ~60% on emergent decisions

**Effort:** 2-3 days to implement

### Option B: Fine-tuned Small Model (Best Quality/Size Ratio)

```
Transcript (chunked)
         |
         v
[Fine-tuned Qwen 2.5 3B Q5 + Instructor]
   Trained on 300-500 meeting extraction examples
   Single model, specifically trained for our JSON schema
   With constrained output
         |
         v
[Code post-processing]
   Same dedup, attribution, relationships
```

**Training data source:** Every Gemini-analyzed meeting becomes a training example. We already have 3 meetings analyzed. Need ~300-500 total.

**Performance:** ~5GB RAM, very fast inference, specialized = better quality than prompted 7B

**Quality estimate:** ~85% of Gemini on our specific task

**Effort:** Need to accumulate training data first. Can use AMI corpus + MeetingBank to bootstrap. Fine-tuning itself is ~1 hour on Colab.

### Option C: Maximum Quality (Endgame)

```
Transcript
         |
         v
[ModernBERT classifier - ONNX INT8, ~12ms/utterance]
   Trained on 500+ annotated utterances
         |
         v
[Fine-tuned Qwen 2.5 3B - QLoRA, ~3GB]
   Trained on 500+ meeting extractions
   Only processes classified utterances
   Constrained output
         |
         v
[Code post-processing]
```

**Quality estimate:** ~90% of Gemini, fully offline, under 5GB RAM, under 2 minutes

## Recommendation

**Start with Option A now. Build toward Option B/C over time.**

Option A can be built in 2-3 days using existing libraries (SetFit, GLiNER2, Instructor). It will immediately improve local quality because the LLM sees only relevant sentences — a much easier task.

Meanwhile, every meeting analyzed through Gemini accumulates training data for Option B. Once we have 300+ annotated examples, we fine-tune a specialized 3B model that replaces both the classifier AND the LLM in a single pass.

The key insight: **don't try to make a 7B general model match Gemini. Instead, decompose the problem so each component does something simple.**

## Implementation Plan for Option A

### Step 1: Add SetFit utterance classifier
- Install setfit, sentence-transformers
- Train on 8-16 examples per class (decision, action_item, risk, commitment, other)
- Use ModernBERT as base encoder
- Save model locally for offline use

### Step 2: Add GLiNER2 entity extraction
- Install gliner
- Configure entity types: person, date, organization, topic, deadline
- Run on all utterances (fast enough)

### Step 3: Restructure pipeline
- Parse transcript into individual utterances (already done in transcript_parser.py)
- Classify each utterance
- Extract entities from each utterance
- Batch flagged utterances for LLM processing
- LLM only structures the pre-identified items

### Step 4: Add Instructor for constrained output
- Install instructor
- Define Pydantic models matching our AiOutput schema
- Replace raw generate() calls with instructor-wrapped calls

### Step 5: Eval and iterate
- Compare hybrid pipeline vs current pipeline on sample meeting
- Tune classifier threshold
- Add few-shot examples to LLM prompt if needed
