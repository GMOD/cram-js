# CRAM Decoder Investigation Results

This directory contains investigation results from validating the CRAM decoder against samtools.

## Files

### Summary Documents
- **final-investigation-summary.txt** - Complete investigation report with all findings and recommendations (START HERE)
- **non-matching-files.txt** - Quick overview of all 14 non-matching files with categories
- **detailed-discrepancies.txt** - Detailed breakdown of each discrepancy with specific counts and priority levels

### Technical Details
- **investigation-results.txt** - Initial investigation findings for top 3 priority files
- **bug-fix-summary.txt** - Technical details of the code change made to fix silent failures

## Key Findings

### Overall Results
- **Total files validated**: ~183 CRAM files
- **Exact matches**: ~169 files (92.3%)
- **Discrepancies**: 14 files (7.7%)

### Critical Bugs Found

**Bug #1: Unmapped/No-Sequence Record Loss**
- Affects: c1#noseq.tmp.cram, human_g1k_v37 files
- Issue: Decoder silently drops unmapped reads and records with edge-case quality scores
- Impact: 14-22% data loss on affected files

**Bug #2: Massive Record Loss in Large Files**
- Affects: ce#1000.tmp.cram
- Issue: Only 602 of 1000 records decoded (40% data loss!)
- Likely cause: Container/slice iteration issue

### Code Change Made
- **File**: `src/cramFile/slice/index.ts` (lines 440-450)
- **Change**: Silent failures now throw descriptive errors instead of silently dropping records
- **Impact**: Users will be notified of decoding failures

## Test Files

Investigation test files created:
- `test/investigate-noseq.test.ts` - Investigates c1#noseq.tmp.cram
- `test/investigate-human-g1k.test.ts` - Investigates human_g1k file
- `test/investigate-ce1000.test.ts` - Investigates ce#1000.tmp.cram
- `test/samtools-validation.test.ts` - 100 validation tests for IndexedCramFile
- `test/samtools-validation-snapshots.test.ts` - 169 validation tests for snapshot files

Run with: `yarn test samtools-validation samtools-validation-snapshots`

## Next Steps

See `final-investigation-summary.txt` for detailed recommendations on:
1. Fixing unmapped record handling
2. Debugging container/slice processing
3. Improving test coverage
4. Adding samtools validation to CI/CD

## Generated

Date: 2025-11-19
Tool: Claude Code validation suite
Method: Compared CRAM decoder output against samtools view -c for all test files
