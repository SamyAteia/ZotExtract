var ZotExtractProviderRuntime = {
        getProviderSettings() {
            return ZotExtractProviderSettings.load();
        },

        saveProviderSettings(provider) {
            return ZotExtractProviderSettings.save(provider);
        },

        async resolveProviderContext(provider, options = {}) {
            const resolved = { ...(provider || {}) };
            const existing = Number(resolved.contextWindowTokens || 0);
            if (Number.isFinite(existing) && existing > 0 && !options.refresh) return resolved;

            const detected = await this.detectProviderContextWindow(resolved).catch(error => {
                Zotero.debug(`ZotExtract: Could not detect provider context window: ${error.message}`);
                return null;
            });
            if (!detected?.contextWindowTokens && Number.isFinite(existing) && existing > 0) return resolved;
            const contextInfo = detected?.contextWindowTokens ? detected : this.fallbackProviderContextWindow(resolved);
            if (!contextInfo?.contextWindowTokens) return resolved;

            resolved.contextWindowTokens = contextInfo.contextWindowTokens;
            resolved.maxContextWindowTokens = contextInfo.maxContextWindowTokens || contextInfo.contextWindowTokens;
            resolved.contextWindowSource = contextInfo.contextWindowSource || 'Detected provider context';
            if (options.persist !== false) {
                try {
                    this.saveProviderSettings(resolved);
                } catch (e) {
                    Zotero.debug(`ZotExtract: Could not persist detected provider context window: ${e.message}`);
                }
            }
            return resolved;
        },

        async detectProviderContextWindow(provider) {
            const id = this.inferProviderId(provider);
            if (id === 'lm-studio') return this.detectLmStudioContextWindow(provider);
            if (id === 'ollama') return this.detectOllamaContextWindow(provider);
            if (id === 'llama-cpp') return this.detectLlamaCppContextWindow(provider);
            if (id === 'openrouter') return this.detectOpenRouterContextWindow(provider);
            return null;
        },

        async detectLmStudioContextWindow(provider) {
            const origin = this.providerOrigin(provider.baseUrl);
            const endpoints = [
                { url: `${origin}/api/v0/models`, kind: 'v0' },
                { url: `${origin}/api/v1/models`, kind: 'v1' }
            ];
            for (const endpoint of endpoints) {
                try {
                    const data = await this.fetchJsonWithShortTimeout(endpoint.url, 2500);
                    const model = this.findLmStudioModel(data, provider.model || '', endpoint.kind);
                    if (!model) continue;
                    const loadedContext = this.firstPositiveNumber(
                        model.loaded_context_length,
                        model.loaded_instances?.[0]?.config?.context_length
                    );
                    const maxContext = this.firstPositiveNumber(model.max_context_length);
                    if (loadedContext) {
                        return {
                            contextWindowTokens: loadedContext,
                            maxContextWindowTokens: maxContext || loadedContext,
                            contextWindowSource: 'LM Studio loaded model context'
                        };
                    }
                } catch (_) {}
            }
            return null;
        },

        findLmStudioModel(data, modelId, kind) {
            const models = kind === 'v1' ? (data?.models || []) : (data?.data || []);
            const ids = model => [model.id, model.key, model.display_name].filter(Boolean);
            return models.find(model => ids(model).includes(modelId))
                || models.find(model => model.loaded_context_length || model.loaded_instances?.length)
                || models[0]
                || null;
        },

        async detectOllamaContextWindow(provider) {
            if (!provider.model) return null;
            try {
                const data = await this.fetchJsonWithShortTimeout(`${this.providerOrigin(provider.baseUrl)}/api/show`, 2500, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: provider.model })
                });
                const info = data?.model_info || {};
                const contextKey = Object.keys(info).find(key => /context_length$/i.test(key));
                const context = this.firstPositiveNumber(contextKey ? info[contextKey] : 0, data?.parameters?.num_ctx);
                return context ? {
                    contextWindowTokens: context,
                    maxContextWindowTokens: context,
                    contextWindowSource: 'Ollama model metadata'
                } : null;
            } catch (_) {
                return null;
            }
        },

        async detectLlamaCppContextWindow(provider) {
            try {
                const data = await this.fetchJsonWithShortTimeout(`${this.providerOrigin(provider.baseUrl)}/props`, 2000);
                const context = this.firstPositiveNumber(data?.default_generation_settings?.n_ctx, data?.n_ctx, data?.context_length);
                return context ? {
                    contextWindowTokens: context,
                    maxContextWindowTokens: context,
                    contextWindowSource: 'llama.cpp server props'
                } : null;
            } catch (_) {
                return null;
            }
        },

        async detectOpenRouterContextWindow(provider) {
            if (!provider.model) return null;
            try {
                const baseUrl = this.normalizeBaseUrl(provider.baseUrl || 'https://openrouter.ai/api/v1');
                const headers = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined;
                const data = await this.fetchJsonWithShortTimeout(`${baseUrl}/models`, 2500, { headers });
                const models = data?.data || data?.models || [];
                const target = this.normalizedModelId(provider.model);
                const model = models.find(entry => this.normalizedModelId(entry.id || entry.name || '') === target);
                const context = this.firstPositiveNumber(
                    model?.context_length,
                    model?.contextWindow,
                    model?.context_window,
                    model?.top_provider?.context_length
                );
                const maxOutput = this.firstPositiveNumber(
                    model?.max_completion_tokens,
                    model?.max_output_tokens,
                    model?.top_provider?.max_completion_tokens
                );
                return context ? {
                    contextWindowTokens: context,
                    maxContextWindowTokens: context,
                    maxOutputTokens: maxOutput || 0,
                    contextWindowSource: 'OpenRouter model metadata'
                } : null;
            } catch (_) {
                return null;
            }
        },

        fallbackProviderContextWindow(provider) {
            const id = this.inferProviderId(provider);
            const model = String(provider?.model || '').toLowerCase();
            const known = this.knownContextWindowForModel(provider?.model);
            if (known && !this.isLocalProvider(provider)) return known;
            if (id === 'lm-studio') {
                return {
                    contextWindowTokens: 12000,
                    maxContextWindowTokens: 0,
                    contextWindowSource: 'Conservative LM Studio fallback'
                };
            }
            if (id === 'ollama' || id === 'llama-cpp' || id === 'jan' || this.isLocalProvider(provider)) {
                return {
                    contextWindowTokens: 8000,
                    maxContextWindowTokens: 0,
                    contextWindowSource: 'Conservative local-provider fallback'
                };
            }
            if (/gpt-4o|gpt-4\.1|gpt-5|o3|o4/.test(model)) {
                return {
                    contextWindowTokens: 128000,
                    maxContextWindowTokens: 128000,
                    contextWindowSource: 'Known OpenAI-compatible model family'
                };
            }
            return {
                contextWindowTokens: 12000,
                maxContextWindowTokens: 0,
                contextWindowSource: 'Conservative provider fallback'
            };
        },

        inferProviderId(provider) {
            if (typeof ZotExtractProviderSettings !== 'undefined' && ZotExtractProviderSettings.inferProviderId) {
                return ZotExtractProviderSettings.inferProviderId(provider);
            }
            const value = `${provider?.name || ''} ${provider?.baseUrl || ''}`.toLowerCase();
            if (value.includes('lm studio') || /:123[4-6]\b/.test(value)) return 'lm-studio';
            if (value.includes('ollama') || value.includes(':11434')) return 'ollama';
            if (value.includes('llama.cpp') || value.includes(':8080')) return 'llama-cpp';
            if (value.includes('jan') || value.includes(':1337')) return 'jan';
            return '';
        },

        normalizedModelId(model) {
            return String(model || '').trim().replace(/^models\//i, '').toLowerCase();
        },

        knownContextWindowForModel(model) {
            if (typeof ZotExtractProviderSettings !== 'undefined' && ZotExtractProviderSettings.knownContextForModel) {
                return ZotExtractProviderSettings.knownContextForModel(model);
            }
            return null;
        },

        isLocalProvider(provider) {
            const value = String(provider?.baseUrl || '').toLowerCase();
            return /localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal/.test(value);
        },

        providerOrigin(baseUrl) {
            try {
                const url = new URL(baseUrl || 'http://127.0.0.1');
                return `${url.protocol}//${url.host}`;
            } catch (_) {
                return String(baseUrl || '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
            }
        },

        firstPositiveNumber(...values) {
            for (const value of values) {
                const number = Number(value);
                if (Number.isFinite(number) && number > 0) return Math.round(number);
            }
            return 0;
        },

        async fetchJsonWithShortTimeout(url, timeoutMs, options = {}) {
            let timeout = null;
            if (typeof AbortController === 'undefined') {
                const response = await Promise.race([
                    fetch(url, options),
                    new Promise((resolve, reject) => {
                        timeout = setTimeout(() => reject(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
                    })
                ]);
                if (timeout) clearTimeout(timeout);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            }

            const controller = new AbortController();
            timeout = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, { ...options, signal: controller.signal });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            } finally {
                clearTimeout(timeout);
            }
        },

        getPrompts() {
            try {
                const stored = Zotero.Prefs.get(this.PREFS.prompts, true);
                if (stored) return JSON.parse(stored);
            } catch (e) {
                Zotero.logError(e);
            }
            return this.defaultPrompts();
        },

        promptFieldLabel(fieldId) {
            if (typeof ZotExtractPromptPresets !== 'undefined') {
                const pack = ZotExtractPromptPresets.getFieldPack(fieldId);
                if (pack) return pack.name;
            }
            return fieldId || '';
        },

        defaultPrompts() {
            if (typeof ZotExtractPromptPresets !== 'undefined') {
                return ZotExtractPromptPresets.allPrompts();
            }
            return [];
        },

        async getFullText(attachmentID, options = {}) {
            const attachment = Zotero.Items.get(attachmentID);
            if (!attachment) {
                throw new Error("Attachment not found.");
            }

            let text = null;
            let lineSourceMap = null;
            
            // Method 1: Prefer Zotero's indexed full-text cache. Coordinate extraction can be partial.
            try {
                const cacheFile = Zotero.Attachments.getStorageDirectory(attachment);
                if (cacheFile) {
                    const cachePath = PathUtils.join(cacheFile.path, '.zotero-ft-cache');
                    if (await IOUtils.exists(cachePath)) {
                        const content = await IOUtils.readUTF8(cachePath);
                        if (content) {
                            text = content;
                        }
                    }
                }
            } catch (e) {
                Zotero.debug('ZotExtract: Could not read from cache: ' + e.message);
            }

            // Method 2: Try Zotero.Fulltext API variations
            if (!text) {
                try {
                    // Try getTextForItem if available
                    if (typeof Zotero.Fulltext?.getTextForItem === 'function') {
                        text = await Zotero.Fulltext.getTextForItem(attachmentID);
                    } else if (typeof Zotero.Fulltext?.getItemContent === 'function') {
                        const content = await Zotero.Fulltext.getItemContent(attachmentID);
                        text = content?.text || content;
                    }
                } catch (e) {
                    Zotero.debug('ZotExtract: Fulltext API error: ' + e.message);
                }
            }

            // Method 3: Use PDFWorker to extract text directly from PDF
            if (!text) {
                try {
                    const filePath = await attachment.getFilePathAsync();
                    if (filePath && typeof Zotero.PDFWorker?.getFullText === 'function') {
                        const result = await Zotero.PDFWorker.getFullText(attachmentID);
                        text = result?.text || result;
                    }
                } catch (e) {
                    Zotero.debug('ZotExtract: PDFWorker error: ' + e.message);
                }
            }

            // Method 4: Trigger indexing and wait
            if (!text) {
                try {
                    if (typeof Zotero.Fulltext?.indexItems === 'function') {
                        await Zotero.Fulltext.indexItems([attachmentID], { complete: true });
                        // Try to get text again after indexing
                        if (typeof Zotero.Fulltext?.getTextForItem === 'function') {
                            text = await Zotero.Fulltext.getTextForItem(attachmentID);
                        }
                    }
                } catch (e) {
                    Zotero.debug('ZotExtract: Indexing error: ' + e.message);
                }
            }

            if (!text) {
                throw new Error("Could not extract text from PDF. The PDF may not be indexed or text extraction is not available.");
            }

            const coordinateAware = !!(options.coordinateAware || options.coordinates);
            if (coordinateAware) {
                try {
                    lineSourceMap = await this.buildLineSourceMapForAttachment(attachment, options.provider);
                } catch (e) {
                    Zotero.debug('ZotExtract: Could not build coordinate-aware line source map: ' + (e.message || String(e)));
                }
            }

            const textInfo = this.truncateText(text, this.maxTextCharactersForProvider(options.provider));
            const coordinateTextLength = this.textFromLineRecords(lineSourceMap?.records || []).length;
            const coordinateCoverage = textInfo.text.length ? coordinateTextLength / textInfo.text.length : 0;
            if (!lineSourceMap?.records?.length || coordinateCoverage < 0.8) {
                lineSourceMap = this.fallbackLineSourceMap(textInfo.text);
            } else {
                lineSourceMap = this.truncateLineSourceMap(lineSourceMap, textInfo.maxLength);
                textInfo.text = this.textFromLineRecords(lineSourceMap.records);
            }
            textInfo.lineSourceMap = lineSourceMap;
            textInfo.lineRecords = lineSourceMap.records || [];
            return options.info ? textInfo : textInfo.text;
        },

        truncateText(text, maxTextCharacters = this.maxTextCharactersForProvider()) {
            const sourceText = String(text || '');
            const cap = this.maxTextCharactersForProvider({ maxTextCharacters });
            if (sourceText.length > cap) {
                return {
                    text: sourceText.substring(0, cap),
                    truncated: true,
                    originalLength: sourceText.length,
                    maxLength: cap,
                    warnings: [
                        `Full text was truncated from ${sourceText.length.toLocaleString()} to ${cap.toLocaleString()} characters before extraction. Results may miss later sections.`
                    ]
                };
            }
            return {
                text: sourceText,
                truncated: false,
                originalLength: sourceText.length,
                maxLength: cap,
                warnings: []
            };
        },

        estimateUsdCost(model, inputTokens) {
            const normalized = String(model || '').toLowerCase();
            let perMillion = null;
            if (normalized.includes('gpt-4o-mini')) perMillion = 0.15;
            else if (normalized.includes('gpt-4o')) perMillion = 2.50;
            else if (normalized.includes('gpt-4.1-mini')) perMillion = 0.40;
            else if (normalized.includes('gpt-4.1')) perMillion = 2.00;
            if (!perMillion) return null;
            const dollars = (inputTokens / 1000000) * perMillion;
            return `~$${dollars < 0.01 ? dollars.toFixed(4) : dollars.toFixed(2)}`;
        },

        validateProviderSettings(provider) {
            const errors = [];
            const baseUrl = (provider.baseUrl || '').trim();
            const model = (provider.model || '').trim();
            if (!baseUrl) errors.push('Set an API base URL in ZotExtract preferences.');
            if (!model) errors.push('Set a model id in ZotExtract preferences.');
            const id = this.inferProviderId(provider);
            if (!this.isLocalProvider(provider) && ['openai', 'openrouter', 'google'].includes(id) && !(provider.apiKey || '').trim()) {
                const label = id === 'google' ? 'Google Gemini' : id === 'openrouter' ? 'OpenRouter' : 'OpenAI';
                errors.push(`${label} endpoints require an API key. Local OpenAI-compatible endpoints can leave it empty.`);
            }
            return { valid: errors.length === 0, errors };
        },

        buildStructuredResult(answer, source, selection, chunks, contextInfo = {}) {
            const parsedRaw = this.parseJsonAnswer(answer);
            const parsed = parsedRaw.ok
                ? { ...parsedRaw, value: this.normalizeParsedExtractionValue(parsedRaw.value) }
                : parsedRaw;
            const provenance = {
                chunkCount: chunks.length,
                chunks: chunks.map(chunk => ({ id: chunk.id, start: chunk.start, end: chunk.end }))
            };
            if (contextInfo.evidenceCollectionMode || contextInfo.usedEvidenceCollection || contextInfo.usedMetadataOnlyFallback) {
                provenance.evidenceCollectionMode = contextInfo.evidenceCollectionMode
                    || (contextInfo.usedMetadataOnlyFallback ? 'metadata-only' : (contextInfo.usedSlidingWindow ? 'sliding-window' : 'single-window'));
                provenance.evidenceWindowCount = Number(contextInfo.evidenceWindowCount || contextInfo.lineWindows?.length || 0);
                provenance.finalContextMode = contextInfo.finalContextMode
                    || (contextInfo.usedMetadataOnlyFallback ? 'metadata-only' : 'collected-evidence');
            }
            if (contextInfo.lineCount) {
                provenance.lineCitationMode = 'line-numbered-context';
                provenance.lineCount = contextInfo.lineCount;
                provenance.lineWindows = contextInfo.lineWindows || [];
            }
            if (contextInfo.lineSourceMap) {
                provenance.lineSourceMap = {
                    version: contextInfo.lineSourceMap.version || 1,
                    source: contextInfo.lineSourceMap.source || 'unknown',
                    hasCoordinates: !!contextInfo.lineSourceMap.hasCoordinates,
                    recordCount: (contextInfo.lineSourceMap.records || []).length
                };
            }
            const hasRequiredAnswer = !parsed.ok || selection.output !== 'json' || this.structuredValueHasAnswer(parsed.value);
            const validationError = parsed.error || (parsed.ok && !hasRequiredAnswer ? 'Structured JSON omitted top-level "answer".' : null);
            const parsedEvidence = parsed.ok ? this.extractRelevantContextEntries(parsed.value) : this.extractLineRangesFromText(answer);
            const evidence = this.attachSourceTextToEvidence(parsedEvidence, contextInfo.lineSourceMap);
            const base = {
                schemaId: this.schemaId,
                schemaVersion: this.schemaVersion,
                source,
                paper: {
                    title: source.title || parsed.value?.title || '',
                    doi: source.doi || '',
                    authors: []
                },
                concepts: [],
                methods: [],
                datasets: [],
                limitations: [],
                extraction: parsed.ok ? parsed.value : null,
                evidence,
                provenance,
                validation: {
                    requestedJson: selection.output === 'json',
                    parsed: parsed.ok && hasRequiredAnswer,
                    error: validationError
                }
            };

            if (parsed.ok && parsed.value && typeof parsed.value === 'object') {
                const extractionPayload = parsed.value.answer && typeof parsed.value.answer === 'object' && !Array.isArray(parsed.value.answer)
                    ? parsed.value.answer
                    : parsed.value;
                base.paper.title = extractionPayload.title || parsed.value.title || base.paper.title;
                base.concepts = Array.isArray(extractionPayload.concepts) ? extractionPayload.concepts : [];
                base.methods = Array.isArray(extractionPayload.methods) ? extractionPayload.methods : [];
                base.datasets = Array.isArray(extractionPayload.datasets) ? extractionPayload.datasets : [];
                base.limitations = Array.isArray(extractionPayload.limitations) ? extractionPayload.limitations : [];
            }

            return base;
        },

        normalizeParsedExtractionValue(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value) || this.structuredValueHasAnswer(value)) return value;
            const hasSupportMetadata = Object.prototype.hasOwnProperty.call(value, 'reasoning')
                || Object.prototype.hasOwnProperty.call(value, 'relevant_context')
                || Object.prototype.hasOwnProperty.call(value, 'relevantContext');
            return hasSupportMetadata ? value : { reasoning: '', relevant_context: [], answer: value };
        },

        structuredValueHasAnswer(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
            if (!Object.prototype.hasOwnProperty.call(value, 'answer')) return false;
            const answer = value.answer;
            if (answer === null || typeof answer === 'undefined') return false;
            if (typeof answer === 'string') return answer.trim().length > 0;
            if (Array.isArray(answer)) return answer.length > 0;
            if (typeof answer === 'object') return Object.keys(answer).length > 0;
            return true;
        },

        extractRelevantContextEntries(value) {
            const entries = [];
            const add = (lines, note = '') => {
                for (const range of this.normalizeLineRanges(lines)) {
                    entries.push({ lines: range, note: String(note || '').trim() });
                }
            };
            const relevant = value?.relevant_context || value?.relevantContext || value?.evidence || [];
            if (Array.isArray(relevant)) {
                for (const entry of relevant) {
                    if (typeof entry === 'string') {
                        add(entry, entry);
                    } else if (entry && typeof entry === 'object') {
                        add(
                            entry.lines || entry.lineRange || entry.line_range || entry.range || entry.lineIds || entry.line_numbers || '',
                            entry.note || entry.reason || entry.context || entry.text || entry.quote || ''
                        );
                    }
                }
            } else if (typeof relevant === 'string') {
                add(relevant, relevant);
            }
            if (!entries.length) return this.extractLineRangesFromText(JSON.stringify(value || {}));
            const seen = new Set();
            return entries.filter(entry => {
                const key = `${entry.lines}:${entry.note}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        },

        attachSourceTextToEvidence(evidence, lineSourceMap) {
            const entries = Array.isArray(evidence) ? evidence : [];
            const records = lineSourceMap?.records || [];
            if (!entries.length || !records.length) return entries;
            return entries.map(entry => {
                const sourceText = this.sourceTextForLineRange(records, entry.lines);
                return sourceText ? { ...entry, sourceText } : entry;
            });
        },

        sourceTextForLineRange(records, range) {
            const selected = [];
            for (const record of records || []) {
                if (!this.lineRecordInRange(record, range) || !record.text) continue;
                selected.push(`${record.id}: ${String(record.text).replace(/\s+/g, ' ').trim()}`);
            }
            return selected.join('\n');
        },

        extractLineRangesFromText(text) {
            return this.normalizeLineRanges(text).map(lines => ({ lines, note: '' }));
        },

        lineCitationPattern() {
            const prefix = '(?:Line[ \\t]+Numbers?|Line[ \\t]+No\\.?|Lines?|L)';
            const space = '[ \\t]*';
            const marker = `${prefix}\\.?${space}[:#]?${space}`;
            const separator = '(?:[-–]|to|through|thru|and)';
            // A short number after a dash can start the note (e.g. "32. Team"
            // or "48 participants"), not a range. Require a marked/padded end
            // ID, or an explicit word separator such as "through".
            const rangeAhead = `(?=${space}${separator}${space}(?:${marker}\\d{1,6}|\\d{6})\\b`
                + `|[ \\t]+(?:to|through|thru)[ \\t]+\\d{1,6}\\b)`;
            const rangeEnd = `(?:${rangeAhead}${space}${separator}${space}(?:${marker})?(\\d{1,6}))?`;
            return new RegExp(
                `\\b${marker}(\\d{1,6})${rangeEnd}\\b`
                    + `|\\b(\\d{6})${rangeEnd}\\b`,
                'gi'
            );
        },

        normalizeLineRanges(value) {
            const text = Array.isArray(value) ? value.join(' ') : String(value || '');
            const ranges = [];
            const pattern = this.lineCitationPattern();
            let match;
            while ((match = pattern.exec(text))) {
                const startNumber = match[1] || match[3];
                const endNumber = match[2] || match[4] || startNumber;
                const start = `L${String(startNumber).padStart(6, '0')}`;
                const end = `L${String(endNumber).padStart(6, '0')}`;
                ranges.push(this.normalizeLineRange(start, end));
            }
            return Array.from(new Set(ranges));
        },

        normalizeLineRange(start, end = start) {
            const startNumber = this.lineIdToNumber(start);
            const endNumber = this.lineIdToNumber(end);
            if (!startNumber || !endNumber) return String(start || '').trim();
            const first = Math.min(startNumber, endNumber);
            const last = Math.max(startNumber, endNumber);
            const firstId = `L${String(first).padStart(6, '0')}`;
            const lastId = `L${String(last).padStart(6, '0')}`;
            return firstId === lastId ? firstId : `${firstId}-${lastId}`;
        },

        lineIdToNumber(lineId) {
            const match = String(lineId || '').match(/L?(\d{6})/i);
            return match ? Number(match[1]) : 0;
        },

        lineRecordInRange(record, range) {
            const [startRaw, endRaw] = String(range || '').split(/\s*[-–]\s*/);
            const start = this.lineIdToNumber(startRaw);
            const end = this.lineIdToNumber(endRaw || startRaw);
            const current = this.lineIdToNumber(record?.id);
            if (!start || !end || !current) return false;
            return current >= Math.min(start, end) && current <= Math.max(start, end);
        },

        parseJsonAnswer(answer) {
            const raw = String(answer || '').trim();
            if (!raw) return { ok: false, value: null, error: 'Empty response.' };
            const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
            const candidate = fenced ? fenced[1].trim() : raw;
            const sectioned = this.parseSectionedAnswer(candidate);
            if (sectioned.ok) return sectioned;
            const prefixed = this.parsePrefixedStructuredAnswer(candidate);
            if (prefixed.ok) return prefixed;
            const adjacent = this.parseJsonObjectWithAdjacentAnswer(candidate);
            if (adjacent.ok) return adjacent;
            const jsonText = this.bestJsonObjectText(candidate) || candidate;
            try {
                return { ok: true, value: this.parseJsonCandidate(jsonText), error: null };
            } catch (e) {
                return { ok: false, value: null, error: e.message };
            }
        },

        parseSectionedAnswer(text) {
            const raw = String(text || '').trim();
            const sections = this.extractSectionMarkers(raw);
            if (!sections.size) return { ok: false, value: null, error: 'No section markers found.' };
            const contextText = (sections.get('context') || '').trim();
            const answerText = (sections.get('answer') || '').trim();
            if (!answerText && sections.has('answer')) return { ok: false, value: null, error: 'Sectioned response omitted answer content.' };
            if (!answerText) {
                const evidenceOnly = this.evidenceEntriesFromSection(contextText);
                return evidenceOnly.length
                    ? { ok: true, value: { reasoning: '', relevant_context: evidenceOnly }, error: null }
                    : { ok: false, value: null, error: 'Sectioned response omitted answer content.' };
            }
            return {
                ok: true,
                value: {
                    reasoning: (sections.get('reasoning') || '').replace(/\s+/g, ' ').trim(),
                    relevant_context: this.evidenceEntriesFromSection(contextText),
                    answer: this.parseSectionAnswerValue(answerText)
                },
                error: null
            };
        },

        extractSectionMarkers(text) {
            const source = String(text || '');
            const markerPattern = /(?:^|\n)[ \t]*##[ \t]*(reasoning|context|answer)[ \t]*(?:##)?[ \t]*(?:\r?\n|$)/gi;
            const matches = [];
            let match;
            while ((match = markerPattern.exec(source))) {
                matches.push({
                    name: match[1].toLowerCase(),
                    markerStart: match.index,
                    contentStart: markerPattern.lastIndex
                });
            }
            const sections = new Map();
            for (let index = 0; index < matches.length; index++) {
                const current = matches[index];
                const next = matches[index + 1];
                const end = next ? next.markerStart : source.length;
                sections.set(current.name, source.slice(current.contentStart, end).trim());
            }
            return sections;
        },

        parseSectionAnswerValue(text) {
            const answerText = String(text || '').trim();
            if (!answerText) return '';
            if (answerText.startsWith('{') || answerText.startsWith('[')) {
                try {
                    return this.parseJsonCandidate(answerText);
                } catch (_) {
                    return answerText;
                }
            }
            return answerText;
        },

        evidenceEntriesFromSection(text) {
            const entries = [];
            const addLine = line => {
                const ranges = this.normalizeLineRanges(line);
                if (!ranges.length) return;
                const note = String(line || '')
                    .replace(this.lineCitationPattern(), '')
                    .replace(/^[-–:;,\s*•]+/, '')
                    .trim();
                for (const lines of ranges) entries.push({ lines, note });
            };
            for (const line of String(text || '').split(/\r?\n/)) addLine(line);
            if (!entries.length) return this.extractLineRangesFromText(text);
            const seen = new Set();
            return entries.filter(entry => {
                const key = `${entry.lines}:${entry.note}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        },

        parseJsonObjectWithAdjacentAnswer(text) {
            const source = String(text || '').trim();
            for (let index = 0; index < source.length; index++) {
                if (source[index] !== '{') continue;
                const end = this.matchingJsonObjectEnd(source, index);
                if (end === -1) continue;
                let root = null;
                try {
                    root = this.parseJsonCandidate(source.slice(index, end + 1));
                } catch (_) {
                    continue;
                }
                if (!root || typeof root !== 'object' || Array.isArray(root) || this.structuredValueHasAnswer(root)) continue;
                const tail = source.slice(end + 1);
                const match = /^\s*,?\s*"answer"\s*:\s*/i.exec(tail);
                if (!match) continue;
                const parsedAnswer = this.parseFirstJsonObject(tail.slice(match[0].length));
                if (!parsedAnswer.ok) return parsedAnswer;
                return {
                    ok: true,
                    value: {
                        ...root,
                        answer: parsedAnswer.value
                    },
                    error: null
                };
            }
            return { ok: false, value: null, error: 'No adjacent answer property found.' };
        },

        parsePrefixedStructuredAnswer(text) {
            const raw = String(text || '').trim();
            const answerMatch = /\banswer\s*:/i.exec(raw);
            if (!answerMatch) return { ok: false, value: null, error: 'No prefixed answer section.' };
            const answerSection = raw.slice(answerMatch.index + answerMatch[0].length);
            const parsedAnswer = this.parseFirstJsonObject(answerSection);
            if (!parsedAnswer.ok) return parsedAnswer;

            const value = parsedAnswer.value;
            if (value && typeof value === 'object' && (value.answer || value.relevant_context || value.relevantContext)) {
                return { ok: true, value, error: null };
            }

            const reasoning = this.prefixedFieldText(raw, 'reasoning', ['relevant_context', 'answer']);
            const evidenceText = raw.slice(0, answerMatch.index);
            return {
                ok: true,
                value: {
                    reasoning,
                    relevant_context: this.extractLineRangesFromText(evidenceText),
                    answer: value
                },
                error: null
            };
        },

        prefixedFieldText(text, field, stopFields = []) {
            const source = String(text || '');
            const startMatch = new RegExp(`\\b${field}\\s*:`, 'i').exec(source);
            if (!startMatch) return '';
            let end = source.length;
            for (const stop of stopFields || []) {
                const match = new RegExp(`\\b${stop}\\s*:`, 'i').exec(source.slice(startMatch.index + startMatch[0].length));
                if (match) {
                    end = Math.min(end, startMatch.index + startMatch[0].length + match.index);
                }
            }
            return source.slice(startMatch.index + startMatch[0].length, end).replace(/\s+/g, ' ').trim();
        },

        parseFirstJsonObject(text) {
            const source = String(text || '');
            const start = source.indexOf('{');
            if (start === -1) return { ok: false, value: null, error: 'No JSON object found.' };
            const end = this.matchingJsonObjectEnd(source, start);
            const candidates = [];
            if (end !== -1) candidates.push(source.slice(start, end + 1));
            for (const candidate of candidates) {
                try {
                    return { ok: true, value: this.parseJsonCandidate(candidate), error: null };
                } catch (_) {
                    // Try the next candidate.
                }
            }
            return { ok: false, value: null, error: 'JSON object section did not parse.' };
        },

        bestJsonObjectText(text) {
            const source = String(text || '').trim();
            const candidates = [];
            for (let index = 0; index < source.length; index++) {
                if (source[index] !== '{') continue;
                const end = this.matchingJsonObjectEnd(source, index);
                if (end === -1) continue;
                const jsonText = source.slice(index, end + 1);
                try {
                    const value = this.parseJsonCandidate(jsonText);
                    const score = value && typeof value === 'object'
                        ? (value.answer ? 4 : 0) + (value.relevant_context || value.relevantContext ? 2 : 0) + jsonText.length / 100000
                        : jsonText.length / 100000;
                    candidates.push({ jsonText, score });
                } catch (_) {
                    // Ignore non-JSON brace groups.
                }
            }
            if (!candidates.length) return '';
            candidates.sort((a, b) => b.score - a.score);
            return candidates[0].jsonText;
        },

        parseJsonCandidate(jsonText) {
            return JSON.parse(String(jsonText || ''));
        },

        matchingJsonObjectEnd(text, start) {
            const source = String(text || '');
            let depth = 0;
            let inString = false;
            let escaped = false;
            for (let index = start; index < source.length; index++) {
                const char = source[index];
                if (inString) {
                    if (escaped) escaped = false;
                    else if (char === '\\') escaped = true;
                    else if (char === '"') inString = false;
                    continue;
                }
                if (char === '"') {
                    inString = true;
                } else if (char === '{') {
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0) return index;
                }
            }
            return -1;
        },

        previewValue(value) {
            if (value === null || typeof value === 'undefined' || value === '') return '';
            if (Array.isArray(value)) {
                if (!value.length) return '';
                return value.slice(0, 5).map(entry => {
                    if (entry && typeof entry === 'object') {
                        return entry.name || entry.label || entry.claim || entry.field || JSON.stringify(entry);
                    }
                    return String(entry);
                }).join('; ');
            }
            if (typeof value === 'object') {
                return JSON.stringify(value);
            }
            return String(value);
        },

        humanizeKey(key) {
            return String(key || '')
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .replace(/[_-]+/g, ' ')
                .replace(/^./, c => c.toUpperCase());
        },

        async callWithText(provider, text, promptText, runState, options = {}) {
            const url = this.normalizeBaseUrl(provider.baseUrl || 'https://api.openai.com/v1') + '/chat/completions';
            const headers = {
                'Content-Type': 'application/json'
            };
            if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;
            if (this.inferProviderId(provider) === 'openrouter') headers['X-OpenRouter-Title'] = 'ZotExtract';

            const body = {
                model: provider.model || this.defaultChatModel(provider),
                messages: [
                    { role: "system", content: provider.systemPrompt || this.defaultSystemPrompt },
                    { role: "user", content: this.buildUserPrompt(provider, text, promptText, options) }
                ]
            };
            if (this.shouldSendChatTemperature(provider)) {
                body.temperature = Number.isFinite(Number(provider.temperature)) ? Number(provider.temperature) : 0.2;
            }
            body[this.chatMaxTokensParameter(provider)] = this.maxCompletionTokens(provider);
            const reasoningEffort = this.chatReasoningEffort(provider);
            if (reasoningEffort) body.reasoning_effort = reasoningEffort;

            Zotero.debug(`[ZotExtract] Calling ${url} with model ${body.model}`);

            const requestOptions = {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                };

            let response;
            try {
                response = await this.fetchTextRequestWithRetry(url, requestOptions, provider, runState);
            } catch (fetchError) {
                throw new Error(fetchError.message.startsWith('Request ') ? fetchError.message : 'Network error: ' + fetchError.message);
            }

            const responseText = await response.text();

            if (!response.ok) {
                throw new Error(`API Error ${response.status}: ${responseText}`);
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                throw new Error('Failed to parse API response: ' + parseError.message);
            }

            return data.choices?.[0]?.message?.content || '';
        },

        defaultChatModel(provider) {
            if (typeof ZotExtractProviderSettings !== 'undefined' && ZotExtractProviderSettings.defaultModelForProvider) {
                return ZotExtractProviderSettings.defaultModelForProvider(provider) || 'gpt-5.4-nano';
            }
            return 'gpt-5.4-nano';
        },

        chatModelKey(provider) {
            return String(provider?.model || this.defaultChatModel(provider) || '')
                .trim()
                .replace(/^openai\//i, '')
                .toLowerCase();
        },

        isOpenAIReasoningStyleModel(provider) {
            return /^(gpt-[56](?:[.\-]|$)|o[34])/.test(this.chatModelKey(provider));
        },

        chatMaxTokensParameter(provider) {
            return this.inferProviderId(provider) === 'openai' && this.isOpenAIReasoningStyleModel(provider)
                ? 'max_completion_tokens'
                : 'max_tokens';
        },

        shouldSendChatTemperature(provider) {
            const id = this.inferProviderId(provider);
            if (id === 'google') return false;
            if (id === 'openai' && this.isOpenAIReasoningStyleModel(provider)) return false;
            return true;
        },

        isContextSizeError(error) {
            const text = String(error?.message || error || '').toLowerCase();
            return /context (size|length|window).*exceed|context.*too large|maximum context|too many tokens|n_ctx/.test(text);
        },

        chatReasoningEffort(provider) {
            const reasoningEffort = this.normalizeReasoningEffort(provider?.reasoningEffort);
            if (!reasoningEffort) return '';
            const id = this.inferProviderId(provider);
            const model = this.chatModelKey(provider);
            if (id === 'openai' && /^gpt-6(?:[.\-]|$)/.test(model)) {
                if (reasoningEffort === 'minimal') return 'low';
                if (reasoningEffort === 'none' && /^gpt-(?:6-astra|6\.1-sol)(?:-|$)/.test(model)) return 'low';
            }
            if (reasoningEffort === 'none') {
                if (id === 'lm-studio') return 'none';
                if (id === 'openai' && this.isOpenAIReasoningStyleModel(provider)) return 'none';
                return '';
            }
            if (id === 'openai') return this.isOpenAIReasoningStyleModel(provider) ? reasoningEffort : '';
            if (id === 'google') return reasoningEffort === 'minimal' ? '' : reasoningEffort;
            if (id === 'openrouter') return '';
            if (!this.isLocalProvider(provider)) return '';
            return reasoningEffort;
        },

        conservativeRetryProvider(provider) {
            const contextWindow = this.effectiveContextWindowTokens(provider);
            if (!Number.isFinite(contextWindow) || contextWindow <= 0) return provider;
            return {
                ...provider,
                contextWindowTokens: Math.max(2048, Math.floor(contextWindow * 0.72)),
                maxCompletionTokens: this.maxCompletionTokens(provider)
            };
        },

        maxCompletionTokens(provider) {
            const raw = Number(provider?.maxCompletionTokens || provider?.maxTokens);
            if (Number.isFinite(raw) && raw > 0) return Math.max(128, Math.min(8192, Math.round(raw)));
            const contextWindow = this.effectiveContextWindowTokens(provider);
            if (Number.isFinite(contextWindow) && contextWindow > 0) {
                return Math.max(1200, Math.min(3000, Math.floor(contextWindow * 0.18)));
            }
            return 1200;
        },

        normalizeReasoningEffort(value) {
            if (typeof ZotExtractProviderSettings !== 'undefined' && ZotExtractProviderSettings.normalizeReasoningEffort) {
                return ZotExtractProviderSettings.normalizeReasoningEffort(value);
            }
            const normalized = String(value || '').trim().toLowerCase();
            return ['none', 'minimal', 'low', 'medium', 'high'].includes(normalized) ? normalized : '';
        },

        requestTimeoutMs(provider) {
            const raw = Number(provider.timeoutSeconds || provider.timeoutMs / 1000);
            if (!Number.isFinite(raw) || raw <= 0) return this.defaultRequestTimeoutMs;
            return Math.max(5000, Math.min(10 * 60 * 1000, Math.round(raw * 1000)));
        },

        providerFetchRetryCount(provider) {
            const explicit = Number(provider?.retryCount ?? provider?.requestRetries);
            if (Number.isFinite(explicit) && explicit >= 0) return Math.max(0, Math.min(3, Math.round(explicit)));
            return this.isLocalProvider(provider) ? 1 : 0;
        },

        transientFetchError(error) {
            const message = String(error?.message || error || '');
            if (/cancelled by user/i.test(message)) return false;
            return /networkerror|network error|failed to fetch|load failed|timed out|aborted|connection.*(reset|closed|refused)/i.test(message);
        },

        async fetchTextRequestWithRetry(url, options, provider, runState) {
            const retries = this.providerFetchRetryCount(provider);
            let lastError = null;
            for (let attempt = 0; attempt <= retries; attempt++) {
                try {
                    return await this.fetchWithTimeout(url, options, provider, runState);
                } catch (e) {
                    lastError = e;
                    if (runState?.cancelled || attempt >= retries || !this.transientFetchError(e)) {
                        throw e;
                    }
                    const delayMs = Math.min(3000, 750 * (attempt + 1));
                    Zotero.debug(`[ZotExtract] Retrying provider request after transient error: ${e.message || e}`);
                    if (Zotero.Promise?.delay) await Zotero.Promise.delay(delayMs);
                    else await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }
            throw lastError || new Error('Provider request failed.');
        },

        async fetchWithTimeout(url, options, provider, runState) {
            const timeoutMs = this.requestTimeoutMs(provider || {});
            this.throwIfRunCancelled?.(runState);
            const cancellation = this.runCancellationWaiter ? this.runCancellationWaiter(runState) : null;
            let timedOut = false;
            if (typeof AbortController === 'undefined') {
                let timeout = null;
                try {
                    const racers = [
                        fetch(url, options),
                        new Promise((resolve, reject) => {
                            timeout = setTimeout(() => reject(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
                        })
                    ];
                    if (cancellation) racers.push(cancellation.promise);
                    return await Promise.race(racers);
                } finally {
                    if (timeout) clearTimeout(timeout);
                    this.releaseRunCancellationWaiter?.(runState, cancellation?.waiter);
                }
            }

            const controller = new AbortController();
            const previousController = runState ? runState.controller : null;
            if (runState) runState.controller = controller;
            if (runState?.controllers) runState.controllers.add(controller);
            let timeout = null;

            try {
                const fetchPromise = fetch(url, { ...options, signal: controller.signal });
                const timeoutPromise = new Promise((resolve, reject) => {
                    timeout = setTimeout(() => {
                        timedOut = true;
                        try {
                            controller.abort();
                        } catch (_) {}
                        reject(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`));
                    }, timeoutMs);
                });
                const racers = [fetchPromise, timeoutPromise];
                if (cancellation) racers.push(cancellation.promise);
                return await Promise.race(racers);
            } catch (e) {
                if (runState && runState.cancelled) throw new Error('Request cancelled by user.');
                if (timedOut) throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s.`);
                throw e;
            } finally {
                if (timeout) clearTimeout(timeout);
                this.releaseRunCancellationWaiter?.(runState, cancellation?.waiter);
                if (runState?.controllers) runState.controllers.delete(controller);
                if (runState && runState.controller === controller) {
                    runState.controller = previousController;
                }
            }
        },

        normalizeBaseUrl(url) {
            return String(url || '').trim()
                .replace(/\/+$/, '')
                .replace(/\/models$/i, '')
                .replace(/\/chat\/completions$/i, '');
        },
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractProviderRuntime);
}
