var ZotExtractContext = {
        itemTitle(item) {
            return item && item.getField ? (item.getField('title') || `Item ${item.id}`) : `Item ${item?.id || ''}`;
        },

        itemAbstract(item) {
            if (!item || !item.getField) return '';
            return item.getField('abstractNote') || item.getField('abstract') || '';
        },

        itemDoi(item) {
            if (!item || !item.getField) return '';
            return item.getField('DOI') || item.getField('doi') || '';
        },

        async getItemById(itemId) {
            return Zotero.Items.getAsync ? await Zotero.Items.getAsync(itemId) : Zotero.Items.get(itemId);
        },

        async bestPdfAttachment(item) {
            if (!item || !item.getBestAttachment) return null;
            const attachment = await item.getBestAttachment();
            if (!attachment) return null;
            const contentType = attachment.attachmentContentType || attachment.contentType;
            return contentType === 'application/pdf' ? attachment : null;
        },

        async buildMaximumContext(item, attachment, provider = null) {
            const warnings = [];
            const metadata = [
                `Title: ${this.itemTitle(item)}`,
                this.itemAbstract(item) ? `Abstract: ${this.itemAbstract(item)}` : '',
                this.itemDoi(item) ? `DOI: ${this.itemDoi(item)}` : ''
            ].filter(Boolean).join('\n');

            let fullText = '';
            let lineSourceMap = null;
            if (attachment) {
                try {
                    const textInfo = await this.getFullText(attachment.id, { info: true, coordinateAware: true, provider });
                    warnings.push(...(textInfo.warnings || []));
                    fullText = textInfo.text || '';
                    lineSourceMap = textInfo.lineSourceMap || null;
                } catch (e) {
                    warnings.push(`Could not use indexed PDF full text: ${e.message}`);
                }
            } else {
                warnings.push('No PDF attachment was available; ZotExtract used Zotero metadata only.');
            }

            const numberedLines = lineSourceMap?.records?.length ? lineSourceMap.records : this.lineNumberText(fullText);
            const formattedFullText = numberedLines.length
                ? `\n\nFull text with line numbers:\n${this.formatNumberedLines(numberedLines)}`
                : '';
            return {
                text: `${metadata}${formattedFullText}`.trim(),
                metadata,
                fullText,
                chunks: [],
                lineCount: numberedLines.length,
                lineSourceMap: lineSourceMap || this.fallbackLineSourceMap(fullText),
                warnings
            };
        },

        async prepareContextForQuestion(provider, context, promptText, runState, options = {}) {
            const budgetTokens = this.contextBudgetTokens(provider, promptText);
            const warnings = [...(context.warnings || [])];
            const directFits = !options.forceSliding && await this.requestFitsContextWindowAsync(provider, context.text, promptText);
            if (!directFits) {
                const contextTokens = this.estimateTokens(context.text, provider);
                const requestTokens = this.requestInputTokens(provider, context.text, promptText);
                const budgetLabel = budgetTokens ? `${budgetTokens.toLocaleString()} tokens` : 'the active provider context';
                warnings.push(`Full paper context was estimated at ${contextTokens.toLocaleString()} tokens and the rendered request at ${requestTokens.toLocaleString()} input tokens, above ${budgetLabel}. ZotExtract scanned the full text with overlapping line-numbered evidence windows, collected relevant evidence, then answered from the collected context.`);
            }

            const fullText = String(context.fullText || '').trim();
            if (!fullText) {
                return {
                    ...context,
                    text: [
                        context.metadata || '',
                        'No indexed PDF full text was available for a line-numbered evidence scan.'
                    ].filter(Boolean).join('\n\n'),
                    chunks: [],
                    usedMetadataOnlyFallback: true,
                    evidenceCollectionMode: 'metadata-only',
                    evidenceWindowCount: 0,
                    finalContextMode: 'metadata-only',
                    warnings: [...warnings, 'No indexed PDF full text was available; ZotExtract answered from metadata only.']
                };
            }

            const numberedLines = context.lineSourceMap?.records?.length ? context.lineSourceMap.records : this.lineNumberText(fullText);
            if (!numberedLines.length) {
                return {
                    ...context,
                    text: [
                        context.metadata || '',
                        'Indexed PDF full text contained no non-empty lines for ZotExtract to scan.'
                    ].filter(Boolean).join('\n\n'),
                    chunks: [],
                    usedMetadataOnlyFallback: true,
                    evidenceCollectionMode: 'metadata-only',
                    evidenceWindowCount: 0,
                    finalContextMode: 'metadata-only',
                    warnings: [...warnings, 'Indexed PDF full text contained no non-empty lines; ZotExtract answered from metadata only.']
                };
            }

            const collected = await this.collectRelevantLineEvidence(provider, numberedLines, promptText, budgetTokens, runState, warnings, {
                forceSliding: !!options.forceSliding
            });
            this.throwIfRunCancelled(runState);
            if (!collected.length && directFits && !options.forceSliding) {
                return {
                    ...context,
                    chunks: [],
                    lineCount: numberedLines.length,
                    usedEvidenceCollection: true,
                    usedFullContextAfterEmptyEvidence: true,
                    usedSlidingWindow: false,
                    evidenceCollectionMode: 'single-window',
                    evidenceWindowCount: 1,
                    finalContextMode: 'full-line-context',
                    lineWindows: [{
                        windowIndex: 1,
                        windowCount: 1,
                        range: this.lineRecordRange(numberedLines)
                    }],
                    warnings: [
                        ...warnings,
                        'The evidence pass returned no cited lines, so ZotExtract answered from the full line-numbered context because it fit the provider window.'
                    ]
                };
            }
            const extractedText = this.formatCollectedLineEvidence(collected);
            const preparedText = await this.fitEvidenceAnswerContext(provider, context.metadata || '', extractedText, promptText, warnings);
            const evidenceCollectionMode = collected.evidenceCollectionMode || (collected.windowCount > 1 ? 'sliding-window' : 'single-window');
            const evidenceWindowCount = Number(collected.windowCount || collected.evidenceWindowCount || 0);

            return {
                ...context,
                text: preparedText,
                chunks: [],
                lineCount: numberedLines.length,
                usedEvidenceCollection: true,
                usedSlidingWindow: evidenceCollectionMode === 'sliding-window',
                evidenceCollectionMode,
                evidenceWindowCount,
                finalContextMode: 'collected-evidence',
                lineWindows: collected.map(entry => ({
                    windowIndex: entry.windowIndex,
                    windowCount: entry.windowCount,
                    range: entry.range,
                    recoveredQuoteCount: entry.recoveredQuoteCount || 0,
                    discardedEvidenceCount: entry.discardedEvidenceCount || 0,
                    recovery: entry.recovery || []
                })),
                warnings
            };
        },

        metadataOnlyFallbackContext(context, warning) {
            return {
                ...context,
                text: [
                    context.metadata || '',
                    'The indexed PDF full text could not fit in the active provider context window after retrying with smaller evidence windows. Use Zotero metadata only and mark unsupported facts as not stated.'
                ].filter(Boolean).join('\n\n'),
                chunks: [],
                lineWindows: [],
                evidenceCollectionMode: 'metadata-only',
                evidenceWindowCount: 0,
                finalContextMode: 'metadata-only',
                usedMetadataOnlyFallback: true,
                warnings: [
                    ...(context.warnings || []),
                    warning || 'ZotExtract fell back to metadata only because the provider rejected the full-text context.'
                ]
            };
        },

        slidingEvidenceInstruction() {
            return this.evidenceCollectionInstruction();
        },

        evidenceCollectionInstruction() {
            return 'Relevant context collected during ZotExtract\'s first evidence pass. Answer only from the metadata and listed line-numbered evidence.';
        },

        formatCollectedLineEvidence(collected) {
            if (!collected?.length) return 'No relevant evidence was returned by the line-numbered evidence pass.';
            return collected.map(entry => [
                `Evidence ${entry.windowIndex}/${entry.windowCount} (${entry.range})`,
                entry.text
            ].join('\n')).join('\n\n');
        },

        buildSlidingEvidenceContext(metadata, evidenceText) {
            return this.buildEvidenceAnswerContext(metadata, evidenceText);
        },

        buildEvidenceAnswerContext(metadata, evidenceText) {
            return [
                metadata || '',
                this.evidenceCollectionInstruction(),
                evidenceText || 'No relevant evidence could fit in the final request.'
            ].filter(Boolean).join('\n\n');
        },

        async fitSlidingEvidenceContext(provider, metadata, evidenceText, promptText, warnings = []) {
            return this.fitEvidenceAnswerContext(provider, metadata, evidenceText, promptText, warnings);
        },

        async fitEvidenceAnswerContext(provider, metadata, evidenceText, promptText, warnings = []) {
            const initialText = this.buildEvidenceAnswerContext(metadata, evidenceText);
            if (await this.requestFitsContextWindowAsync(provider, initialText, promptText)) return initialText;

            const initialRequestTokens = (await this.requestInputTokenInfo(provider, initialText, promptText)).tokens + this.maxCompletionTokens(provider);
            const lines = String(evidenceText || '').split('\n');
            let low = 0;
            let high = lines.length;
            let bestEvidence = '';
            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                const candidateEvidence = lines.slice(0, mid).join('\n').trim();
                const candidateText = this.buildEvidenceAnswerContext(metadata, candidateEvidence);
                if (this.requestFitsContextWindow(provider, candidateText, promptText)) {
                    bestEvidence = candidateEvidence;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }

            if (!bestEvidence && evidenceText) {
                const source = String(evidenceText);
                low = 0;
                high = source.length;
                while (low <= high) {
                    const mid = Math.floor((low + high) / 2);
                    const candidateEvidence = source.slice(0, mid).trim();
                    const candidateText = this.buildEvidenceAnswerContext(metadata, candidateEvidence);
                    if (this.requestFitsContextWindow(provider, candidateText, promptText)) {
                        bestEvidence = candidateEvidence;
                        low = mid + 1;
                    } else {
                        high = mid - 1;
                    }
                }
            }

            const fallbackEvidence = 'Collected evidence did not fit after accounting for prompt and output reserves. Use the metadata only and state when requested facts are not supported by the available context.';
            const fittedText = this.buildEvidenceAnswerContext(metadata, bestEvidence || fallbackEvidence);
            let finalText = await this.requestFitsContextWindowAsync(provider, fittedText, promptText)
                ? fittedText
                : [
                    metadata || '',
                    'The indexed PDF text was too large to fit in the configured model context after prompt and output reserves. Use the metadata only and state when requested facts are not supported by the available context.'
                ].filter(Boolean).join('\n\n');
            if (!(await this.requestFitsContextWindowAsync(provider, finalText, promptText))) {
                finalText = metadata || 'No Zotero metadata was available.';
            }
            const finalRequestTokens = (await this.requestInputTokenInfo(provider, finalText, promptText)).tokens + this.maxCompletionTokens(provider);
            const usableWindow = this.usableContextWindowTokens(provider);
            warnings.push(`Collected line-numbered evidence was shortened from ${initialRequestTokens.toLocaleString()} to ${finalRequestTokens.toLocaleString()} request tokens to fit the ${usableWindow.toLocaleString()}-token provider window.`);
            return finalText;
        },

        contextBudgetTokens(provider, promptText) {
            const contextWindow = this.effectiveContextWindowTokens(provider);
            if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
            const usableWindow = this.usableContextWindowTokens(provider);
            const promptReserve = this.estimateTokens([
                provider.systemPrompt || this.defaultSystemPrompt,
                this.renderPromptTemplate(this.wholePromptTemplate(provider), {
                    question: promptText || '',
                    context: ''
                })
            ].join('\n'), provider);
            const outputReserve = Math.max(this.maxCompletionTokens(provider), 1200, Math.ceil(usableWindow * 0.15));
            return Math.max(1000, usableWindow - promptReserve - outputReserve);
        },

        buildChatRequestText(provider, contextText, promptText, options = {}) {
            return [
                provider?.systemPrompt || this.defaultSystemPrompt,
                this.buildUserPrompt(provider, contextText, promptText, options)
            ].join('\n');
        },

        requestInputTokens(provider, contextText, promptText, options = {}) {
            return this.estimateTokens(this.buildChatRequestText(provider, contextText, promptText, options), provider);
        },

        async requestInputTokenInfo(provider, contextText, promptText, options = {}) {
            return this.countTextTokens(provider, this.buildChatRequestText(provider, contextText, promptText, options), options);
        },

        requestFitsContextWindow(provider, contextText, promptText, options = {}) {
            const usableWindow = this.usableContextWindowTokens(provider);
            if (!Number.isFinite(usableWindow) || usableWindow <= 0) return true;
            return this.requestInputTokens(provider, contextText, promptText, options) + this.maxCompletionTokens(provider) <= usableWindow;
        },

        async requestFitsContextWindowAsync(provider, contextText, promptText, options = {}) {
            const info = await this.requestInputTokenInfo(provider, contextText, promptText, options);
            const usableWindow = this.usableContextWindowTokens(provider, info);
            if (!Number.isFinite(usableWindow) || usableWindow <= 0) return true;
            return info.tokens + this.maxCompletionTokens(provider) <= usableWindow;
        },

        usableContextWindowTokens(provider, tokenInfo = null) {
            const contextWindow = this.effectiveContextWindowTokens(provider);
            if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
            if (!this.isLocalProvider(provider)) return contextWindow;
            return Math.floor(contextWindow * (tokenInfo?.exact ? 0.9 : 0.75));
        },

        effectiveContextWindowTokens(provider) {
            const contextWindow = Number(provider?.contextWindowTokens || 0);
            if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 0;
            return contextWindow;
        },

        tokenEstimatorProfile(provider = null) {
            const model = String(provider?.model || '').toLowerCase();
            const name = String(provider?.name || '').toLowerCase();
            const baseUrl = String(provider?.baseUrl || '').toLowerCase();
            if (/gemma/.test(model)) {
                return { charsPerToken: 4.25, pieceFactor: 0.7, lineIdOverhead: 1, method: 'estimated-gemma' };
            }
            if (/gpt-|gpt4|gpt5|o[134]|text-embedding|openai/.test(`${model} ${name} ${baseUrl}`)) {
                return { charsPerToken: 4.0, pieceFactor: 0.75, lineIdOverhead: 1, method: 'estimated-openai' };
            }
            if (/llama|mistral|mixtral|qwen|deepseek|phi|yi-|command-r|granite|falcon|mpt/.test(model)) {
                return { charsPerToken: 3.8, pieceFactor: 0.78, lineIdOverhead: 1, method: 'estimated-local-bpe' };
            }
            if (this.isLocalProvider(provider)) {
                return { charsPerToken: 3.6, pieceFactor: 0.85, lineIdOverhead: 1.5, method: 'estimated-local-conservative' };
            }
            return { charsPerToken: 3.8, pieceFactor: 0.8, lineIdOverhead: 1.2, method: 'estimated-generic' };
        },

        estimateTokens(text, provider = null) {
            const source = String(text || '');
            if (!source) return 0;
            const profile = this.tokenEstimatorProfile(provider);
            const charEstimate = Math.ceil(source.length / profile.charsPerToken);
            const pieces = source.match(/[A-Za-z]+|\d+|[^\sA-Za-z\d]/g) || [];
            const pieceEstimate = Math.ceil(pieces.length * profile.pieceFactor);
            const lineIdOverhead = Math.ceil((source.match(/\bL\d{6}\b/g) || []).length * profile.lineIdOverhead);
            return Math.max(charEstimate, pieceEstimate + lineIdOverhead);
        },

        tokensToApproxCharacters(tokens, provider = null) {
            return Math.max(1, Math.floor(Number(tokens || 0) * this.tokenEstimatorProfile(provider).charsPerToken));
        },

        async countTextTokens(provider, text, options = {}) {
            const source = String(text || '');
            const profile = this.tokenEstimatorProfile(provider);
            const fallback = () => ({
                tokens: this.estimateTokens(source, provider),
                exact: false,
                method: profile.method
            });
            if (!source) return { tokens: 0, exact: true, method: 'empty' };
            const key = this.tokenCountCacheKey(provider, source, options);
            if (this.tokenCountCache.has(key)) return this.tokenCountCache.get(key);

            let info = null;
            if (options.useProviderTokenizer !== false) {
                info = await this.countTextTokensWithProvider(provider, source);
            }
            if (!info) info = fallback();
            this.tokenCountCache.set(key, info);
            return info;
        },

        tokenCountCacheKey(provider, text, options = {}) {
            return [
                this.inferProviderId(provider) || 'provider',
                provider?.baseUrl || '',
                provider?.model || '',
                options.rawUserPrompt ? 'raw' : 'chat',
                this.fastTextHash(text)
            ].join('|');
        },

        fastTextHash(text) {
            const source = String(text || '');
            let hash = 2166136261;
            for (let i = 0; i < source.length; i++) {
                hash ^= source.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return `${source.length}:${(hash >>> 0).toString(36)}`;
        },

        async countTextTokensWithProvider(provider, text) {
            const endpoints = this.tokenizerEndpointCandidates(provider);
            if (!endpoints.length) return null;
            for (const endpoint of endpoints) {
                const failureKey = `${provider?.model || ''}|${endpoint.url}|${endpoint.shape}`;
                if (this.tokenEndpointFailures.has(failureKey)) continue;
                try {
                    const data = await this.fetchJsonWithShortTimeout(endpoint.url, 1200, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(this.tokenizerRequestBody(provider, text, endpoint.shape))
                    });
                    const count = this.extractTokenCount(data);
                    if (count) return { tokens: count, exact: true, method: endpoint.method };
                    this.tokenEndpointFailures.add(failureKey);
                } catch (_) {
                    this.tokenEndpointFailures.add(failureKey);
                }
            }
            return null;
        },

        tokenizerEndpointCandidates(provider) {
            const id = this.inferProviderId(provider);
            const origin = this.providerOrigin(provider?.baseUrl || '');
            if (!origin) return [];
            if (id === 'llama-cpp') {
                return [
                    { url: `${origin}/tokenize`, shape: 'llama-cpp', method: 'provider-tokenizer:llama.cpp' },
                    { url: `${origin}/api/tokenize`, shape: 'llama-cpp', method: 'provider-tokenizer:llama.cpp' }
                ];
            }
            if (id === 'lm-studio') {
                return [
                    { url: `${origin}/api/v0/tokenize`, shape: 'lm-studio-input', method: 'provider-tokenizer:lm-studio' },
                    { url: `${origin}/api/v0/tokenize`, shape: 'lm-studio-text', method: 'provider-tokenizer:lm-studio' },
                    { url: `${origin}/tokenize`, shape: 'llama-cpp', method: 'provider-tokenizer:local' }
                ];
            }
            return [];
        },

        tokenizerRequestBody(provider, text, shape) {
            if (shape === 'lm-studio-input') return { model: provider?.model || '', input: text };
            if (shape === 'lm-studio-text') return { model: provider?.model || '', text };
            return { content: text };
        },

        extractTokenCount(data) {
            if (!data) return 0;
            for (const key of ['token_count', 'tokenCount', 'num_tokens', 'numTokens', 'n_tokens', 'count']) {
                const value = Number(data[key]);
                if (Number.isFinite(value) && value > 0) return Math.round(value);
            }
            if (Array.isArray(data.tokens)) return data.tokens.length;
            if (Number.isFinite(Number(data.tokens)) && Number(data.tokens) > 0) return Math.round(Number(data.tokens));
            if (data.data) return this.extractTokenCount(data.data);
            return 0;
        },

        wholePromptTemplate(provider) {
            if (provider?.wholePromptTemplate) return provider.wholePromptTemplate;
            if (typeof ZotExtractProviderSettings !== 'undefined' && ZotExtractProviderSettings.defaultWholePromptTemplate) {
                return ZotExtractProviderSettings.defaultWholePromptTemplate;
            }
            return this.defaultWholePromptTemplate;
        },

        chunkPromptTemplate(provider) {
            if (provider?.chunkPromptTemplate) return provider.chunkPromptTemplate;
            if (typeof ZotExtractProviderSettings !== 'undefined' && ZotExtractProviderSettings.defaultChunkPromptTemplate) {
                return ZotExtractProviderSettings.defaultChunkPromptTemplate;
            }
            return this.defaultChunkPromptTemplate;
        },

        renderPromptTemplate(template, values = {}) {
            const source = String(template || '');
            return source.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key) => {
                const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : '';
                return value == null ? '' : String(value);
            });
        },

        buildUserPrompt(provider, text, promptText, options = {}) {
            if (options.rawUserPrompt) return String(promptText || '');
            return this.renderPromptTemplate(options.template || this.wholePromptTemplate(provider), {
                question: promptText || '',
                context: text || '',
                windowIndex: options.windowIndex || '',
                windowCount: options.windowCount || '',
                windowRange: options.windowRange || ''
            });
        },

        lineNumberText(text) {
            return String(text || '')
                .replace(/\r\n/g, '\n')
                .replace(/\r/g, '\n')
                .split('\n')
                .map((line, index) => {
                    const lineNumber = index + 1;
                    const id = `L${String(lineNumber).padStart(6, '0')}`;
                    const cleaned = String(line || '').replace(/\s+/g, ' ').trim();
                    return {
                        id,
                        lineNumber,
                        text: cleaned,
                        formatted: `${id}: ${cleaned}`
                    };
                })
                .filter(line => line.text);
        },

        textFromLineRecords(lineRecords) {
            return (lineRecords || []).map(line => line.text || '').join('\n');
        },

        fallbackLineSourceMap(text) {
            const records = this.lineNumberText(text).map(line => ({
                id: line.id,
                lineNumber: line.lineNumber,
                text: line.text,
                page: null,
                rects: []
            }));
            return {
                version: 1,
                source: 'zotero-fulltext-fallback',
                hasCoordinates: false,
                records
            };
        },

        truncateLineSourceMap(sourceMap, maxTextCharacters) {
            const records = [];
            const cap = this.maxTextCharactersForProvider({ maxTextCharacters });
            let used = 0;
            for (const record of sourceMap?.records || []) {
                const sourceText = String(record.text || '');
                const separator = records.length ? 1 : 0;
                if (used + separator + sourceText.length > cap) {
                    const remaining = Math.max(0, cap - used - separator);
                    if (remaining > 0) {
                        records.push({
                            ...record,
                            text: sourceText.slice(0, remaining),
                            truncated: true
                        });
                    }
                    break;
                }
                records.push(record);
                used += separator + sourceText.length;
            }
            return {
                ...(sourceMap || {}),
                records,
                hasCoordinates: !!(sourceMap?.hasCoordinates && records.some(record => (record.rects || []).length))
            };
        },

        async buildLineSourceMapForAttachment(attachment, provider = null) {
            this.lastLineSourceMapDiagnostics = {
                attachmentId: attachment?.id || null,
                attempts: []
            };
            try {
                const pdfJsMap = await this.extractPdfJsLineSourceMap(attachment);
                this.lastLineSourceMapDiagnostics.attempts.push({
                    source: 'pdfjs-text-layer',
                    ok: !!pdfJsMap?.records?.length,
                    records: pdfJsMap?.records?.length || 0,
                    hasCoordinates: !!pdfJsMap?.hasCoordinates
                });
                if (pdfJsMap?.records?.length) return pdfJsMap;
            } catch (e) {
                this.lastLineSourceMapDiagnostics.attempts.push({
                    source: 'pdfjs-text-layer',
                    ok: false,
                    error: e.message || String(e)
                });
                Zotero.debug(`ZotExtract: PDF.js line source-map extraction failed: ${e.message || String(e)}`);
            }
            try {
                const recognizerMap = await this.extractRecognizerLineSourceMap(attachment);
                this.lastLineSourceMapDiagnostics.attempts.push({
                    source: 'zotero-recognizer-data',
                    ok: !!recognizerMap?.records?.length,
                    records: recognizerMap?.records?.length || 0,
                    hasCoordinates: !!recognizerMap?.hasCoordinates
                });
                if (recognizerMap?.records?.length) return recognizerMap;
            } catch (e) {
                this.lastLineSourceMapDiagnostics.attempts.push({
                    source: 'zotero-recognizer-data',
                    ok: false,
                    error: e.message || String(e)
                });
                Zotero.debug(`ZotExtract: recognizer line source-map extraction failed: ${e.message || String(e)}`);
            }
            return null;
        },

        async loadPdfJsModule() {
            if (this._pdfjsModule) return this._pdfjsModule;
            this.ensurePdfJsRuntimeGlobals();
            const uris = [
                'resource://zotero/reader/pdf/build/pdf.mjs',
                'chrome://zotero/content/reader/pdf/build/pdf.mjs'
            ];
            const errors = [];
            for (const uri of uris) {
                if (typeof ChromeUtils !== 'undefined' && typeof ChromeUtils.importESModule === 'function') {
                    try {
                        const module = ChromeUtils.importESModule(uri);
                        if (module?.getDocument) {
                            this._pdfjsModule = module;
                            return module;
                        }
                        errors.push(`${uri}: imported module did not expose getDocument`);
                    } catch (e) {
                        errors.push(`${uri}: ${e.message || String(e)}`);
                    }
                }
                if (typeof Components !== 'undefined' && typeof Components.utils?.importESModule === 'function') {
                    try {
                        const module = Components.utils.importESModule(uri);
                        if (module?.getDocument) {
                            this._pdfjsModule = module;
                            return module;
                        }
                        errors.push(`${uri}: imported module did not expose getDocument`);
                    } catch (e) {
                        errors.push(`${uri}: ${e.message || String(e)}`);
                    }
                }
                const hasChromeModuleImporter =
                    (typeof ChromeUtils !== 'undefined' && typeof ChromeUtils.importESModule === 'function') ||
                    (typeof Components !== 'undefined' && typeof Components.utils?.importESModule === 'function');
                if (typeof process === 'undefined' && hasChromeModuleImporter) {
                    try {
                        const module = await import(uri);
                        if (module?.getDocument) {
                            this._pdfjsModule = module;
                            return module;
                        }
                        errors.push(`${uri}: imported module did not expose getDocument`);
                    } catch (e) {
                        errors.push(`${uri}: ${e.message || String(e)}`);
                    }
                }
            }
            throw new Error(`PDF.js module import is unavailable in this runtime. ${errors.join(' | ')}`.trim());
        },

        ensurePdfJsRuntimeGlobals() {
            try {
                const root = typeof globalThis !== 'undefined' ? globalThis : null;
                if (!root) return;
                if (typeof root.navigator === 'undefined') {
                    root.navigator = {
                        userAgent: 'Zotero',
                        platform: typeof Services !== 'undefined' ? Services.appinfo?.OS || '' : ''
                    };
                }
            } catch (_) {}
        },

        async extractPdfJsLineSourceMap(attachment) {
            if (!attachment || !attachment.getFilePathAsync || typeof IOUtils === 'undefined') return null;
            const hasChromeModuleImporter =
                (typeof ChromeUtils !== 'undefined' && typeof ChromeUtils.importESModule === 'function') ||
                (typeof Components !== 'undefined' && typeof Components.utils?.importESModule === 'function');
            if (!hasChromeModuleImporter) return null;
            const pdfjs = await this.loadPdfJsModule();
            if (!pdfjs?.getDocument) return null;
            const filePath = await attachment.getFilePathAsync();
            if (!filePath) return null;
            const bytes = await IOUtils.read(filePath);
            const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const loadingTask = pdfjs.getDocument({
                data,
                disableWorker: true,
                stopAtErrors: false,
                useSystemFonts: true
            });
            const pdf = await loadingTask.promise;
            const records = [];
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                const page = await pdf.getPage(pageNumber);
                const viewport = page.getViewport ? page.getViewport({ scale: 1 }) : null;
                const pageHeight = viewport?.height || Math.abs((page.view?.[3] || 0) - (page.view?.[1] || 0)) || 0;
                const pageWidth = viewport?.width || Math.abs((page.view?.[2] || 0) - (page.view?.[0] || 0)) || 0;
                const content = await page.getTextContent({ disableNormalization: false });
                const pageRecords = this.reconstructPdfJsLineRecords(content?.items || [], pageNumber, pageWidth, pageHeight);
                records.push(...pageRecords);
            }
            records.forEach((record, index) => {
                record.lineNumber = index + 1;
                record.id = `L${String(index + 1).padStart(6, '0')}`;
            });
            return {
                version: 1,
                source: 'pdfjs-text-layer',
                hasCoordinates: records.some(record => (record.rects || []).length),
                records
            };
        },

        reconstructPdfJsLineRecords(items, pageNumber, pageWidth, pageHeight) {
            const positioned = (items || [])
                .map(item => this.pdfJsTextItemRecord(item, pageNumber, pageWidth, pageHeight))
                .filter(item => item && item.text);
            positioned.sort((a, b) => (a.y - b.y) || (a.x - b.x));
            const bands = [];
            for (const item of positioned) {
                const tolerance = Math.max(3, Math.min(8, item.height * 0.65 || 4));
                let band = bands.find(candidate => Math.abs(candidate.y - item.y) <= tolerance);
                if (!band) {
                    band = { y: item.y, items: [] };
                    bands.push(band);
                }
                band.items.push(item);
                band.y = (band.y * (band.items.length - 1) + item.y) / band.items.length;
            }
            const records = [];
            for (const band of bands.sort((a, b) => a.y - b.y)) {
                const lineItems = band.items.sort((a, b) => a.x - b.x);
                const clusters = [];
                let current = [];
                for (const item of lineItems) {
                    const previous = current[current.length - 1];
                    const gap = previous ? item.x - (previous.x + previous.width) : 0;
                    if (previous && gap > Math.max(48, pageWidth * 0.08)) {
                        clusters.push(current);
                        current = [];
                    }
                    current.push(item);
                }
                if (current.length) clusters.push(current);
                for (const cluster of clusters) {
                    const text = cluster.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
                    if (!text) continue;
                    records.push({
                        id: '',
                        lineNumber: 0,
                        text,
                        page: pageNumber,
                        rects: this.mergeRectsForLine(cluster)
                    });
                }
            }
            return records;
        },

        pdfJsTextItemRecord(item, pageNumber, pageWidth, pageHeight) {
            const text = String(item?.str || '').replace(/\s+/g, ' ').trim();
            if (!text) return null;
            const transform = item.transform || [1, 0, 0, 1, 0, 0];
            const x = Number(transform[4] || 0);
            const baseline = Number(transform[5] || 0);
            const width = Math.max(1, Number(item.width || 0));
            const height = Math.max(1, Number(item.height || Math.hypot(transform[2] || 0, transform[3] || 0) || 10));
            const y = pageHeight ? Math.max(0, pageHeight - baseline - height) : Math.max(0, baseline);
            return {
                text,
                page: pageNumber,
                x: this.roundRectNumber(x),
                y: this.roundRectNumber(y),
                width: this.roundRectNumber(width),
                height: this.roundRectNumber(height),
                pageWidth: this.roundRectNumber(pageWidth),
                pageHeight: this.roundRectNumber(pageHeight)
            };
        },

        mergeRectsForLine(items) {
            if (!items?.length) return [];
            const page = items[0].page;
            const x1 = Math.min(...items.map(item => item.x));
            const y1 = Math.min(...items.map(item => item.y));
            const x2 = Math.max(...items.map(item => item.x + item.width));
            const y2 = Math.max(...items.map(item => item.y + item.height));
            return [{
                page,
                x: this.roundRectNumber(x1),
                y: this.roundRectNumber(y1),
                width: this.roundRectNumber(x2 - x1),
                height: this.roundRectNumber(y2 - y1),
                pageWidth: this.roundRectNumber(items[0].pageWidth),
                pageHeight: this.roundRectNumber(items[0].pageHeight)
            }];
        },

        roundRectNumber(value) {
            const number = Number(value || 0);
            return Math.round(number * 100) / 100;
        },

        async extractRecognizerLineSourceMap(attachment) {
            if (!attachment || typeof Zotero.PDFWorker?.getRecognizerData !== 'function') return null;
            const data = await Zotero.PDFWorker.getRecognizerData(attachment.id);
            const records = [];
            for (let pageIndex = 0; pageIndex < (data?.pages || []).length; pageIndex++) {
                const page = data.pages[pageIndex];
                const pageNumber = pageIndex + 1;
                const pageWidth = Number(page?.[0] || 0);
                const pageHeight = Number(page?.[1] || 0);
                for (const line of this.flattenRecognizerLines(page)) {
                    const words = (line || []).filter(word => Array.isArray(word) && typeof word[13] === 'string');
                    const text = words.map(word => word[13]).join(' ').replace(/\s+/g, ' ').trim();
                    if (!text) continue;
                    records.push({
                        id: '',
                        lineNumber: 0,
                        text,
                        page: pageNumber,
                        rects: this.mergeRecognizerWordRects(words, pageNumber, pageWidth, pageHeight)
                    });
                }
            }
            records.forEach((record, index) => {
                record.lineNumber = index + 1;
                record.id = `L${String(index + 1).padStart(6, '0')}`;
            });
            return {
                version: 1,
                source: 'zotero-recognizer-data',
                hasCoordinates: records.some(record => (record.rects || []).length),
                records
            };
        },

        flattenRecognizerLines(value) {
            const lines = [];
            const visit = node => {
                if (!Array.isArray(node)) return;
                if (node.length && node.every(entry => Array.isArray(entry) && typeof entry[13] === 'string')) {
                    lines.push(node);
                    return;
                }
                for (const child of node) visit(child);
            };
            visit(value);
            return lines;
        },

        mergeRecognizerWordRects(words, pageNumber, pageWidth = 0, pageHeight = 0) {
            if (!words?.length) return [];
            const x1 = Math.min(...words.map(word => Number(word[0] || 0)));
            const y1 = Math.min(...words.map(word => Number(word[1] || 0)));
            const x2 = Math.max(...words.map(word => Number(word[2] || 0)));
            const y2 = Math.max(...words.map(word => Number(word[3] || 0)));
            return [{
                page: pageNumber,
                x: this.roundRectNumber(x1),
                y: this.roundRectNumber(y1),
                width: this.roundRectNumber(x2 - x1),
                height: this.roundRectNumber(y2 - y1),
                pageWidth: this.roundRectNumber(pageWidth),
                pageHeight: this.roundRectNumber(pageHeight)
            }];
        },

        formatNumberedLines(lines) {
            return (lines || []).map(line => `${line.id}: ${line.text}`).join('\n');
        },

        slidingLineWindows(lines, maxChars) {
            const windows = [];
            let start = 0;
            while (start < lines.length) {
                const windowLines = [];
                let size = 0;
                let index = start;
                while (index < lines.length) {
                    const line = lines[index];
                    const lineSize = line.id.length + String(line.text || '').length + 3;
                    if (windowLines.length && size + lineSize > maxChars) break;
                    windowLines.push(line);
                    size += lineSize;
                    index++;
                }
                if (!windowLines.length) {
                    windowLines.push(lines[start]);
                    index = start + 1;
                }
                const first = windowLines[0];
                const last = windowLines[windowLines.length - 1];
                windows.push({
                    index: windows.length + 1,
                    lines: windowLines,
                    startLine: first.id,
                    endLine: last.id,
                    range: first.id === last.id ? first.id : `${first.id}-${last.id}`,
                    text: this.formatNumberedLines(windowLines)
                });
                if (index >= lines.length) break;
                const overlapLines = Math.min(50, Math.max(1, Math.floor(windowLines.length * 0.1)));
                start = Math.max(start + 1, index - overlapLines);
            }
            return windows;
        },

        lineRecordRange(lines) {
            const records = (lines || []).filter(Boolean);
            if (!records.length) return '';
            const first = records[0];
            const last = records[records.length - 1];
            return first.id === last.id ? first.id : `${first.id}-${last.id}`;
        },

        lineWindowCharBudget(provider, budgetTokens, promptText) {
            const contextWindow = this.usableContextWindowTokens(provider);
            const scanPromptReserve = this.estimateTokens([
                provider?.systemPrompt || this.defaultSystemPrompt,
                promptText || '',
                'Scan this line-numbered paper window for evidence and return concise cited lines.'
            ].join('\n'), provider);
            const outputReserve = contextWindow ? Math.max(800, Math.ceil(contextWindow * 0.1)) : 800;
            const availableTokens = contextWindow
                ? Math.max(512, contextWindow - scanPromptReserve - outputReserve)
                : budgetTokens;
            const windowTokens = Math.max(512, Math.floor(Math.min(budgetTokens || availableTokens, availableTokens) * 0.72));
            return Math.max(2000, Math.min(this.maxTextCharactersForProvider(provider), this.tokensToApproxCharacters(windowTokens, provider)));
        },

        async evidenceCollectionWindowPlan(provider, numberedLines, promptText, budgetTokens, options = {}) {
            const lines = numberedLines || [];
            if (!lines.length) return { mode: 'metadata-only', windows: [] };
            const allText = this.formatNumberedLines(lines);
            const allRange = this.lineRecordRange(lines);
            if (!options.forceSliding) {
                const scanProvider = {
                    ...provider,
                    maxCompletionTokens: Math.min(this.maxCompletionTokens(provider), 500)
                };
                const prompt = this.renderPromptTemplate(this.chunkPromptTemplate(provider), {
                    question: promptText || '',
                    context: allText,
                    windowIndex: 1,
                    windowCount: 1,
                    windowRange: allRange
                });
                if (await this.requestFitsContextWindowAsync(scanProvider, allText, prompt, { rawUserPrompt: true })) {
                    return {
                        mode: 'single-window',
                        windows: [{
                            index: 1,
                            lines,
                            startLine: lines[0].id,
                            endLine: lines[lines.length - 1].id,
                            range: allRange,
                            text: allText
                        }]
                    };
                }
            }
            const windowCharBudget = this.lineWindowCharBudget(provider, budgetTokens, promptText);
            const windows = this.slidingLineWindows(lines, windowCharBudget);
            return {
                mode: windows.length > 1 ? 'sliding-window' : 'single-window',
                windows
            };
        },

        sourceLinesForEvidence(lines, evidence) {
            const ranges = (evidence || []).map(entry => entry.lines).filter(Boolean);
            if (!ranges.length) return '';
            const selected = [];
            const seen = new Set();
            for (const range of ranges) {
                for (const line of lines || []) {
                    if (!this.lineRecordInRange(line, range) || seen.has(line.id)) continue;
                    selected.push(line);
                    seen.add(line.id);
                }
            }
            return this.formatNumberedLines(selected);
        },

        async collectRelevantLineEvidence(provider, numberedLines, promptText, budgetTokens, runState, warnings = [], options = {}) {
            const plan = await this.evidenceCollectionWindowPlan(provider, numberedLines, promptText, budgetTokens, options);
            const windows = plan.windows || [];
            const quoteIndex = this.buildEvidenceQuoteIndex(numberedLines);
            const collected = [];
            collected.evidenceCollectionMode = plan.mode || (windows.length > 1 ? 'sliding-window' : 'single-window');
            collected.windowCount = windows.length;
            let failedWindows = 0;
            for (const window of windows) {
                if (runState?.cancelled) break;
                const prompt = this.renderPromptTemplate(this.chunkPromptTemplate(provider), {
                    question: promptText || '',
                    context: window.text,
                    windowIndex: window.index,
                    windowCount: windows.length,
                    windowRange: window.range
                });
                const scanProvider = {
                    ...provider,
                    maxCompletionTokens: Math.min(this.maxCompletionTokens(provider), 500)
                };
                let answer = '';
                try {
                    answer = await this.callWithProgress(scanProvider, window.text, prompt, runState, { rawUserPrompt: true });
                } catch (e) {
                    if (runState?.cancelled) break;
                    failedWindows++;
                    if (failedWindows <= 5) {
                        warnings.push(`Line-window scan ${window.index}/${windows.length} (${window.range}) failed and was skipped: ${e.message || String(e)}`);
                    }
                    continue;
                }
                const clean = String(answer || '').trim();
                if (clean && !/^no relevant evidence\.?$/i.test(clean)) {
                    const parsed = this.parseJsonAnswer(clean);
                    const evidence = parsed.ok
                        ? this.extractRelevantContextEntries(parsed.value)
                        : this.extractLineRangesFromText(clean);
                    const recovery = this.recoverEvidenceSourceLines(numberedLines, evidence, clean, {
                        citationLines: window.lines, quoteIndex
                    });
                    const sourceText = recovery.text;
                    if (!sourceText) continue;
                    collected.push({
                        windowIndex: window.index,
                        windowCount: windows.length,
                        range: window.range,
                        text: sourceText,
                        scanAnswer: clean,
                        recovery: recovery.diagnostics,
                        recoveredQuoteCount: recovery.recoveredCount,
                        discardedEvidenceCount: recovery.discardedCount
                    });
                }
            }
            collected.evidenceCollectionMode = plan.mode || collected.evidenceCollectionMode;
            collected.windowCount = windows.length;
            return collected;
        },

};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractContext);
}
