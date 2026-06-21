var ZotExtractProviderSettings = {
    prefs: {
        provider: 'extensions.zotextract.provider',
        apiKey: 'extensions.zotextract.apiKey',
        model: 'extensions.zotextract.model'
    },
    defaultMaxTextCharacters: 400000,
    defaultReasoningEffort: 'none',
    defaultOpenAIModel: 'gpt-5.4-nano',
    defaultSystemPrompt: 'You are a helpful research assistant. Return exactly the format requested by the user. Do not write a Thinking Process, analysis, plan, self-correction, tool call, hidden chain-of-thought, or extra prose outside the requested format.',
    defaultWholePromptTemplate: [
        'Extraction question:',
        '{{question}}',
        '',
        'Line-numbered answer context:',
        '{{context}}',
        '',
        'Answer using only the provided metadata and line-numbered context. Do not use unstated facts from prior knowledge or raw paper text that is not shown here.',
        'Return exactly these three sections in this order. Do not use JSON, Markdown fences, tool calls, or extra text.',
        'The section markers must be exactly "## reasoning", "## context", and "## answer" at the start of a line.',
        '',
        '## reasoning',
        'One short visible justification grounded in the cited evidence. Do not include a Thinking Process, analysis, plan, or self-correction.',
        '',
        '## context',
        'Up to 5 evidence bullets. Each bullet must start with a cited line ID or range from the provided evidence context, for example: L000123-L000128 - Evidence used.',
        '',
        '## answer',
        'Only the requested extraction. Mark missing evidence explicitly instead of guessing.'
    ].join('\n'),
    defaultChunkPromptTemplate: [
        'First pass: select candidate source lines that could help answer the extraction question.',
        'Do not answer the question yet. Prefer recall over precision: if a line might support the answer, include it.',
        'For broad overview questions about contribution, objective, scope, tasks, methods, or results, title, abstract, and introduction lines are usually relevant.',
        'Return exactly one section. Do not use JSON, Markdown fences, tool calls, or extra text.',
        'Use this format:',
        '## context',
        'L000123-L000128 - Why this evidence matters.',
        'Use at most 5 evidence bullets for this window.',
        'Cite line IDs or line ranges exactly as shown.',
        'Return "No relevant evidence." only when no line in this window could plausibly help answer the question.',
        'If no line is relevant, return:',
        '## context',
        'No relevant evidence.',
        '',
        'Extraction question:',
        '{{question}}',
        '',
        'Window {{windowIndex}}/{{windowCount}} ({{windowRange}}):',
        '{{context}}'
    ].join('\n'),

    defaults() {
        const provider = {
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1'
        };
        return {
            ...provider,
            model: this.normalizeModelForProvider(provider, this.getPref(this.prefs.model)),
            apiKey: this.getPref(this.prefs.apiKey) || '',
            timeoutSeconds: 120,
            contextWindowTokens: 0,
            maxContextWindowTokens: 0,
            contextWindowSource: '',
            concurrentRequests: 4,
            maxTextCharacters: this.defaultMaxTextCharacters,
            reasoningEffort: this.defaultReasoningEffort,
            systemPrompt: this.defaultSystemPrompt,
            wholePromptTemplate: this.defaultWholePromptTemplate,
            chunkPromptTemplate: this.defaultChunkPromptTemplate
        };
    },

    load() {
        let provider = null;
        try {
            const stored = this.getPref(this.prefs.provider);
            if (stored) provider = JSON.parse(stored);
        } catch (e) {
            this.logError(e);
        }

        if (!provider) return this.defaults();

        const dedicatedApiKey = this.getPref(this.prefs.apiKey) || '';
        const embeddedApiKey = provider.apiKey || '';
        provider.apiKey = dedicatedApiKey || embeddedApiKey;
        provider.model = this.normalizeModelForProvider(provider, provider.model || this.getPref(this.prefs.model));
        provider.timeoutSeconds = this.normalizeTimeoutSeconds(provider);
        provider.contextWindowTokens = this.normalizeContextWindowTokens(provider.contextWindowTokens);
        provider.maxContextWindowTokens = this.normalizeContextWindowTokens(provider.maxContextWindowTokens);
        provider.contextWindowSource = provider.contextWindowSource || '';
        provider.concurrentRequests = this.normalizeConcurrentRequests(provider.concurrentRequests);
        provider.maxTextCharacters = this.normalizeMaxTextCharacters(provider.maxTextCharacters);
        provider.reasoningEffort = Object.prototype.hasOwnProperty.call(provider, 'reasoningEffort')
            ? this.normalizeReasoningEffort(provider.reasoningEffort)
            : this.defaultReasoningEffort;
        provider.systemPrompt = this.normalizeSystemPrompt(provider.systemPrompt);
        provider.wholePromptTemplate = this.normalizeWholePromptTemplate(provider.wholePromptTemplate);
        provider.chunkPromptTemplate = this.normalizeChunkPromptTemplate(provider.chunkPromptTemplate);
        delete provider.fileEndpoint;
        if (embeddedApiKey) this.save(provider);
        return provider;
    },

    save(provider) {
        const normalized = {
            ...provider,
            model: this.normalizeModelForProvider(provider, provider?.model),
            timeoutSeconds: this.normalizeTimeoutSeconds(provider),
            contextWindowTokens: this.normalizeContextWindowTokens(provider?.contextWindowTokens),
            maxContextWindowTokens: this.normalizeContextWindowTokens(provider?.maxContextWindowTokens),
            contextWindowSource: provider?.contextWindowSource || '',
            concurrentRequests: this.normalizeConcurrentRequests(provider?.concurrentRequests),
            maxTextCharacters: this.normalizeMaxTextCharacters(provider?.maxTextCharacters),
            reasoningEffort: Object.prototype.hasOwnProperty.call(provider || {}, 'reasoningEffort')
                ? this.normalizeReasoningEffort(provider?.reasoningEffort)
                : this.defaultReasoningEffort,
            systemPrompt: this.normalizeSystemPrompt(provider?.systemPrompt),
            wholePromptTemplate: this.normalizeWholePromptTemplate(provider?.wholePromptTemplate),
            chunkPromptTemplate: this.normalizeChunkPromptTemplate(provider?.chunkPromptTemplate)
        };
        delete normalized.fileEndpoint;
        const providerWithoutSecret = { ...normalized };
        delete providerWithoutSecret.apiKey;
        this.setPref(this.prefs.provider, JSON.stringify(providerWithoutSecret));
        if (Object.prototype.hasOwnProperty.call(provider, 'apiKey')) {
            this.setPref(this.prefs.apiKey, provider.apiKey || '');
        }
        if (normalized.model) this.setPref(this.prefs.model, normalized.model);
        return normalized;
    },

    inferProviderId(provider) {
        const name = String(provider?.name || '').trim().toLowerCase();
        const baseUrl = String(provider?.baseUrl || '').trim().toLowerCase();
        const combined = `${name} ${baseUrl}`;
        if (this.isLocalProvider(provider)) {
            if (combined.includes('lm studio') || /:123[4-6]\b/.test(combined)) return 'lm-studio';
            if (combined.includes('ollama') || combined.includes(':11434')) return 'ollama';
            if (combined.includes('llama.cpp') || combined.includes(':8080')) return 'llama-cpp';
            if (combined.includes('jan') || combined.includes(':1337')) return 'jan';
            return 'openai-compatible-local';
        }
        if (baseUrl.includes('openrouter.ai') || name === 'openrouter') return 'openrouter';
        if (baseUrl.includes('generativelanguage.googleapis.com') || name.includes('google') || name.includes('gemini')) return 'google';
        if (baseUrl.includes('api.openai.com') || name === 'openai') return 'openai';
        return '';
    },

    isLocalProvider(provider) {
        return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal/i.test(String(provider?.baseUrl || ''));
    },

    defaultModelForProvider(provider) {
        const id = this.inferProviderId(provider);
        if (id === 'google') return 'gemini-3.5-flash';
        if (id === 'openrouter') return `openai/${this.defaultOpenAIModel}`;
        if (id && id !== 'openai') return '';
        return this.defaultOpenAIModel;
    },

    bundledDefaultModels() {
        return [this.defaultOpenAIModel];
    },

    isBundledDefaultModel(model) {
        const normalized = String(model || '').trim().toLowerCase();
        return this.bundledDefaultModels().includes(normalized);
    },

    normalizeModelForProvider(provider, model) {
        const raw = String(model || '').trim();
        const id = this.inferProviderId(provider);
        if (id && id !== 'openai' && id !== 'openrouter' && id !== 'google') return raw;
        if (!raw) return this.defaultModelForProvider(provider);
        return raw;
    },

    modelOptionsForProvider(provider) {
        const id = this.inferProviderId(provider);
        if (id === 'google') return ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
        if (id === 'openrouter') {
            return [
                `openai/${this.defaultOpenAIModel}`,
                'openai/gpt-5.4-mini',
                'google/gemini-3.5-flash',
                'google/gemini-2.5-flash'
            ];
        }
        if (id && id !== 'openai') return [];
        return [this.defaultOpenAIModel, 'gpt-5.4-mini', 'gpt-5.5'];
    },

    canonicalModelId(model) {
        return String(model || '')
            .trim()
            .replace(/^models\//i, '')
            .toLowerCase();
    },

    knownContextForModel(model) {
        const id = this.canonicalModelId(model);
        if (!id) return null;
        const aliases = Array.from(new Set([
            id,
            id.replace(/^(openai|google)\//, '')
        ]));
        const exact = new Map([
            ['gpt-5.5', { contextWindowTokens: 1000000, maxOutputTokens: 128000, contextWindowSource: 'Known OpenAI model context' }],
            ['gpt-5.4', { contextWindowTokens: 1000000, maxOutputTokens: 128000, contextWindowSource: 'Known OpenAI model context' }],
            ['gpt-5.4-mini', { contextWindowTokens: 400000, maxOutputTokens: 128000, contextWindowSource: 'Known OpenAI model context' }],
            ['gpt-5.4-nano', { contextWindowTokens: 400000, maxOutputTokens: 128000, contextWindowSource: 'Known OpenAI model context' }],
            ['gpt-4.1', { contextWindowTokens: 1000000, maxOutputTokens: 32768, contextWindowSource: 'Known OpenAI-compatible model context' }],
            ['gpt-4.1-mini', { contextWindowTokens: 1000000, maxOutputTokens: 32768, contextWindowSource: 'Known OpenAI-compatible model context' }],
            ['gpt-4.1-nano', { contextWindowTokens: 1000000, maxOutputTokens: 32768, contextWindowSource: 'Known OpenAI-compatible model context' }],
            ['gpt-4o', { contextWindowTokens: 128000, maxOutputTokens: 16384, contextWindowSource: 'Known OpenAI-compatible model context' }],
            ['gpt-4o-mini', { contextWindowTokens: 128000, maxOutputTokens: 16384, contextWindowSource: 'Known OpenAI-compatible model context' }],
            ['gemini-3.5-flash', { contextWindowTokens: 1048576, maxOutputTokens: 65536, contextWindowSource: 'Known Gemini OpenAI-compatible model context' }],
            ['gemini-2.5-flash', { contextWindowTokens: 1048576, maxOutputTokens: 65536, contextWindowSource: 'Known Gemini OpenAI-compatible model context' }],
            ['gemini-2.5-pro', { contextWindowTokens: 1048576, maxOutputTokens: 65536, contextWindowSource: 'Known Gemini OpenAI-compatible model context' }],
            ['gemini-2.5-flash-lite', { contextWindowTokens: 1048576, maxOutputTokens: 65536, contextWindowSource: 'Known Gemini OpenAI-compatible model context' }]
        ]);
        for (const alias of aliases) {
            const found = exact.get(alias);
            if (found) return {
                ...found,
                maxContextWindowTokens: found.contextWindowTokens
            };
        }
        return null;
    },

    normalizeTimeoutSeconds(provider) {
        const raw = Number(provider?.timeoutSeconds || provider?.timeoutMs / 1000);
        return Math.max(5, Math.min(600, Number.isFinite(raw) && raw > 0 ? Math.round(raw) : 120));
    },

    normalizeContextWindowTokens(value) {
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) return 0;
        return Math.max(512, Math.min(10_000_000, Math.round(raw)));
    },

    normalizeConcurrentRequests(value) {
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) return 4;
        return Math.max(1, Math.min(16, Math.round(raw)));
    },

    normalizeMaxTextCharacters(value) {
        const raw = Number(value);
        if (!Number.isFinite(raw) || raw <= 0) return this.defaultMaxTextCharacters;
        return Math.max(10000, Math.min(2000000, Math.round(raw)));
    },

    normalizeReasoningEffort(value) {
        const normalized = String(value || '').trim().toLowerCase();
        const supported = new Set(['none', 'minimal', 'low', 'medium', 'high']);
        return supported.has(normalized) ? normalized : '';
    },

    normalizeSystemPrompt(value) {
        const text = String(value || '').trim();
        if (!text) return this.defaultSystemPrompt;
        const isPlainDefault = /^You are a helpful research assistant\.?$/i.test(text);
        const isJsonDefault = /Return exactly one valid JSON object with concise, evidence-grounded extraction data/i.test(text)
            && /Do not expose hidden chain-of-thought/i.test(text);
        return (isPlainDefault || isJsonDefault) ? this.defaultSystemPrompt : text;
    },

    normalizeWholePromptTemplate(value) {
        const text = String(value || '').trim();
        if (!text) return this.defaultWholePromptTemplate;
        const isOldDefault = /Answer the extraction question using only the paper context/i.test(text)
            && /Cite line IDs such as L000123/i.test(text)
            && !/"relevant_context"/.test(text);
        const isVerboseDefault = /Example return format/i.test(text)
            && /"relevant_context"/.test(text)
            && /"items"/.test(text);
        const isLooseJsonDefault = /Return JSON only\. Do not wrap it in Markdown/i.test(text)
            && /Use top-level fields "reasoning", "relevant_context", and "answer"/i.test(text)
            && /"answer" must contain the requested extraction/i.test(text);
        const isStrictJsonDefault = /Return one valid JSON object only/i.test(text)
            && /Do not write labels such as "reasoning:"/i.test(text)
            && /Use top-level fields "reasoning", "relevant_context", and "answer"/i.test(text)
            && /"answer" must contain the requested extraction/i.test(text);
        const isPreviousSectionedDefault = /Paper context:/i.test(text)
            && /Return exactly these three sections in this order/i.test(text)
            && /Up to 5 evidence bullets/i.test(text)
            && !/Evidence-grounded answer context/i.test(text);
        const isCollectedEvidenceDefault = /Evidence-grounded answer context:/i.test(text)
            && /Answer using only the provided metadata and collected line-numbered evidence context/i.test(text)
            && /The section markers must be exactly/i.test(text);
        return (isOldDefault || isVerboseDefault || isLooseJsonDefault || isStrictJsonDefault || isPreviousSectionedDefault || isCollectedEvidenceDefault) ? this.defaultWholePromptTemplate : text;
    },

    normalizeChunkPromptTemplate(value) {
        const text = String(value || '').trim();
        if (!text) return this.defaultChunkPromptTemplate;
        const isOldDefault = /Return only concise evidence/i.test(text)
            && /No relevant evidence/i.test(text)
            && !/"relevant_context"/.test(text);
        const isJsonDefault = /Return one valid JSON object only/i.test(text)
            && /"relevant_context"/.test(text)
            && /Use at most 5 evidence/i.test(text);
        const isPreviousSectionedDefault = /Scan this line-numbered paper window for evidence/i.test(text)
            && /Return exactly one section/i.test(text)
            && !/First pass:/i.test(text);
        const isRestrictiveEvidenceDefault = /First pass: scan this line-numbered paper context window for evidence relevant to the extraction question/i.test(text)
            && /If this window contains no relevant evidence, return/i.test(text);
        return (isOldDefault || isJsonDefault || isPreviousSectionedDefault || isRestrictiveEvidenceDefault) ? this.defaultChunkPromptTemplate : text;
    },

    getPref(key) {
        return Zotero.Prefs.get(key, true);
    },

    setPref(key, value) {
        Zotero.Prefs.set(key, value, true);
    },

    logError(error) {
        if (typeof Zotero !== 'undefined' && Zotero.logError) Zotero.logError(error);
    }
};
