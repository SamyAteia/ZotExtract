var ZotExtractQuoteRecovery = {
    /** Normalize typography, not wording, for source-backed quotation matching. */
    normalizeEvidenceQuote(text) {
        return String(text || '').normalize('NFKC')
            .replace(/\u00ad/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
            .replace(/[‐‑–]/g, '-').replace(/\s+/g, ' ').trim();
    },

    buildEvidenceQuoteIndex(lines) {
        const records = (lines || []).filter(line => line?.id && line.text);
        const chunks = [];
        const lineAt = [];
        records.forEach((line, index) => {
            const text = this.normalizeEvidenceQuote(line.text);
            if (chunks.length) { chunks.push(' '); lineAt.push(index); }
            chunks.push(text);
            for (let offset = 0; offset < text.length; offset++) lineAt.push(index);
        });
        const text = chunks.join('');
        const variants = [{ text, lineAt, normalization: 'typography-whitespace' }];
        // Preserve a printed hyphen, or remove a PDF line-wrap hyphen.
        // No arbitrary within-line punctuation removal or fuzzy matching.
        for (const retainHyphen of [true, false]) {
            const pattern = /([\p{L}])-(\s+)(?=[\p{L}])/gu;
            const parts = [];
            const positions = [];
            let start = 0;
            let match;
            while ((match = pattern.exec(text))) {
                const next = match.index + match[0].length;
                if (lineAt[match.index] === lineAt[next]) continue;
                const keepEnd = match.index + match[1].length + (retainHyphen ? 1 : 0);
                parts.push(text.slice(start, keepEnd));
                for (let offset = start; offset < keepEnd; offset++) positions.push(lineAt[offset]);
                start = match.index + match[0].length;
            }
            parts.push(text.slice(start));
            for (let offset = start; offset < lineAt.length; offset++) positions.push(lineAt[offset]);
            const joined = parts.join('');
            if (joined !== text) variants.push({ text: joined, lineAt: positions,
                normalization: retainHyphen ? 'wrapped-hyphen-spacing' : 'wrapped-hyphen-removed' });
        }
        return { records, variants };
    },

    evidenceRecoveryEntries(scanAnswer, parsedEvidence = []) {
        const raw = String(scanAnswer || '').trim();
        const sections = this.extractSectionMarkers(raw);
        if (!sections.has('context') && /^[\[{]/.test(raw.replace(/^```(?:json)?\s*/i, ''))) return parsedEvidence;
        const text = raw;
        let inContext = sections.size === 0;
        const entries = [];
        let pending = null;
        const flush = () => {
            if (pending && (pending.lines || pending.note.trim())) entries.push(pending);
            pending = null;
        };
        for (const original of text.split(/\r?\n/)) {
            let line = original.trim();
            const heading = line.match(/^##\s*(reasoning|context|answer)\s*$/i);
            if (heading) { flush(); inContext = heading[1].toLowerCase() === 'context'; continue; }
            if (!inContext) continue;
            if (!line || /^##|^```/.test(line)) { flush(); continue; }
            line = line.replace(/^[-*•]\s+/, '');
            const match = this.lineCitationPattern().exec(line);
            if (match && match.index === 0) {
                flush();
                pending = { lines: this.normalizeLineRanges(match[0])[0] || '',
                    note: line.slice(match[0].length).replace(/^\s*[-–:;,]\s*/, '') };
            } else if (pending) {
                pending.note += '\n' + line;
            } else {
                pending = { lines: '', note: line };
            }
        }
        flush();
        return entries.length ? entries : parsedEvidence;
    },

    findEvidenceQuote(index, quote, citedRange = '') {
        let needle = this.normalizeEvidenceQuote(quote);
        if ((needle.startsWith('"') && needle.endsWith('"'))
            || (needle.startsWith("'") && needle.endsWith("'"))) needle = needle.slice(1, -1).trim();
        needle = needle.replace(/\.$/, '');
        if (needle.length < 24 || (needle.match(/[\p{L}\p{N}]+/gu) || []).length < 4) return { status: 'too-short' };
        const candidates = new Map();
        const word = value => !!value && /[\p{L}\p{N}]/u.test(value);
        for (const variant of index.variants) {
            for (const candidate of [needle]) {
                let position = variant.text.indexOf(candidate);
                while (position >= 0) {
                    const end = position + candidate.length;
                    if (!(word(candidate[0]) && word(variant.text[position - 1]))
                        && !(word(candidate[candidate.length - 1]) && word(variant.text[end]))) {
                        const first = variant.lineAt[position];
                        const last = variant.lineAt[end - 1];
                        const range = this.normalizeLineRange(index.records[first].id, index.records[last].id);
                        if (!candidates.has(range)) candidates.set(range, {
                            lines: range, normalization: variant.normalization
                        });
                    }
                    if (candidates.size > 100) return { status: 'ambiguous' };
                    position = variant.text.indexOf(candidate, position + 1);
                }
            }
        }
        const matches = [...candidates.values()];
        if (matches.length === 1) return { status: 'matched', ...matches[0] };
        if (matches.length > 1 && citedRange) {
            const overlapping = matches.filter(match => index.records.some(line =>
                this.lineRecordInRange(line, citedRange) && this.lineRecordInRange(line, match.lines)));
            if (overlapping.length === 1) return { status: 'matched', ...overlapping[0] };
        }
        return { status: matches.length ? 'ambiguous' : 'unmatched' };
    },

    /** Return source text only, correcting ranges for unambiguous verbatim quotes. */
    recoverEvidenceSourceLines(lines, parsedEvidence, scanAnswer, options = {}) {
        const index = options.quoteIndex || this.buildEvidenceQuoteIndex(lines);
        const citationLines = options.citationLines || lines;
        const entries = this.evidenceRecoveryEntries(scanAnswer, parsedEvidence);
        const accepted = [];
        const diagnostics = [];
        const selected = [];
        const seen = new Set();
        const collectSource = (source, range) => {
            for (const line of source) {
                if (!this.lineRecordInRange(line, range) || seen.has(line.id)) continue;
                selected.push(line);
                seen.add(line.id);
            }
        };
        for (const entry of entries) {
            const found = this.findEvidenceQuote(index, entry.note, entry.lines);
            if (found.status === 'matched') {
                accepted.push({ lines: found.lines, note: entry.note || '' });
                collectSource(lines, found.lines);
                diagnostics.push({ originalLines: entry.lines || '', lines: found.lines,
                    status: found.lines === entry.lines ? 'quote-verified' : 'quote-recovered',
                    normalization: found.normalization });
            } else {
                const bounded = entry.lines
                    ? citationLines.filter(line => this.lineRecordInRange(line, entry.lines))
                    : [];
                if (bounded.length) {
                    // Unverified notes cannot expand a citation beyond the
                    // original scan window. Only matched quotations may do so.
                    const range = this.normalizeLineRange(bounded[0].id, bounded[bounded.length - 1].id);
                    accepted.push({ lines: range, note: '' });
                    collectSource(bounded, range);
                    diagnostics.push({ originalLines: entry.lines, lines: range,
                        status: 'source-citation-only', quoteStatus: found.status,
                        windowClipped: range !== entry.lines });
                } else {
                    diagnostics.push({ originalLines: entry.lines || '', lines: '',
                        status: 'discarded', quoteStatus: found.status });
                }
            }
        }
        return { text: this.formatNumberedLines(selected), evidence: accepted, diagnostics,
            recoveredCount: diagnostics.filter(entry => entry.status === 'quote-recovered').length,
            discardedCount: diagnostics.filter(entry => entry.status === 'discarded').length };
    }
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractQuoteRecovery);
}
