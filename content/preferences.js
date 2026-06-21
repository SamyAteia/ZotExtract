var ZotExtractPreferences = {
    state: {
        provider: null,
        discoveredServers: [],
        discoveryErrors: []
    },

    init() {
        if (typeof Zotero === 'undefined') {
            console.error('Zotero not available in preferences page.');
            return;
        }

        this.providerNameInput = document.getElementById('providerName');
        this.modelInput = document.getElementById('model');
        this.modelOptions = document.getElementById('modelOptions');
        this.modelMenuToggle = document.getElementById('modelMenuToggle');
        this.baseUrlInput = document.getElementById('baseUrl');
        this.apiKeyInput = document.getElementById('apiKey');
        this.timeoutSecondsInput = document.getElementById('timeoutSeconds');
        this.systemPromptInput = document.getElementById('systemPrompt');
        this.contextWindowTokensInput = document.getElementById('contextWindowTokens');
        this.contextWindowReadout = document.getElementById('contextWindowReadout');
        this.checkContextButton = document.getElementById('checkContextWindow');
        this.concurrentRequestsInput = document.getElementById('concurrentRequests');
        this.reasoningEffortInput = document.getElementById('reasoningEffort');
        this.maxTextCharactersInput = document.getElementById('maxTextCharacters');
        this.wholePromptTemplateInput = document.getElementById('wholePromptTemplate');
        this.chunkPromptTemplateInput = document.getElementById('chunkPromptTemplate');
        this.discoverButton = document.getElementById('discoverLocalProviders');
        this.downloadLmStudioButton = document.getElementById('downloadLmStudio');
        this.openSessionsButton = document.getElementById('openSessionsFromPreferences');
        this.deleteDataButton = document.getElementById('deleteZotExtractData');
        this.dataResetStatus = document.getElementById('dataResetStatus');
        this.discoveryStatus = document.getElementById('discoveryStatus');
        this.discoveryResults = document.getElementById('discoveryResults');

        this.state.provider = ZotExtractProviderSettings.load();
        this.bindProviderInputs();
        this.bindDiscovery();
        this.bindExternalLinks();
        this.bindSessionsLink();
        this.bindContextWindowCheck();
        this.bindDataReset();
        this.bindModelAutocomplete();
    },

    bindProviderInputs() {
        const provider = this.state.provider;
        this.populateProviderInputs(provider);

        const saveProvider = () => {
            this.state.provider = ZotExtractProviderSettings.save({
                name: this.providerNameInput.value.trim(),
                model: this.modelInput.value.trim(),
                baseUrl: this.baseUrlInput.value.trim(),
                apiKey: this.apiKeyInput.value.trim(),
                timeoutSeconds: Math.max(5, Math.min(600, Number(this.timeoutSecondsInput.value) || 120)),
                contextWindowTokens: Number(this.contextWindowTokensInput.value) || 0,
                maxContextWindowTokens: this.state.provider?.maxContextWindowTokens || 0,
                contextWindowSource: this.state.provider?.contextWindowSource || '',
                concurrentRequests: Math.max(1, Math.min(16, Number(this.concurrentRequestsInput.value) || 4)),
                reasoningEffort: this.reasoningEffortInput.value,
                maxTextCharacters: ZotExtractProviderSettings.normalizeMaxTextCharacters(this.maxTextCharactersInput.value),
                systemPrompt: this.systemPromptInput.value.trim(),
                wholePromptTemplate: this.wholePromptTemplateInput.value.trim() || ZotExtractProviderSettings.defaultWholePromptTemplate,
                chunkPromptTemplate: this.chunkPromptTemplateInput.value.trim() || ZotExtractProviderSettings.defaultChunkPromptTemplate
            });
            this.updateContextWindowReadout(this.state.provider);
        };

        [
            this.providerNameInput,
            this.modelInput,
            this.baseUrlInput,
            this.apiKeyInput,
            this.timeoutSecondsInput,
            this.concurrentRequestsInput,
            this.reasoningEffortInput,
            this.maxTextCharactersInput,
            this.systemPromptInput,
            this.wholePromptTemplateInput,
            this.chunkPromptTemplateInput
        ].forEach(el => el.addEventListener('input', saveProvider));
        this.reasoningEffortInput.addEventListener('change', saveProvider);
        this.contextWindowTokensInput.addEventListener('input', () => {
            this.state.provider = {
                ...(this.state.provider || {}),
                contextWindowSource: this.contextWindowTokensInput.value ? 'Manual override' : '',
                maxContextWindowTokens: 0
            };
            saveProvider();
        });
        this.saveProvider = saveProvider;
    },

    populateProviderInputs(provider) {
        this.providerNameInput.value = provider.name || '';
        this.modelInput.value = ZotExtractProviderSettings.normalizeModelForProvider(provider, provider.model);
        this.modelInput.placeholder = ZotExtractProviderSettings.defaultModelForProvider(provider) || ZotExtractProviderSettings.defaultOpenAIModel;
        this.baseUrlInput.value = provider.baseUrl || 'https://api.openai.com/v1';
        this.apiKeyInput.value = provider.apiKey || '';
        this.timeoutSecondsInput.value = provider.timeoutSeconds || 120;
        this.systemPromptInput.value = provider.systemPrompt || '';
        this.contextWindowTokensInput.value = provider.contextWindowTokens || '';
        this.concurrentRequestsInput.value = provider.concurrentRequests || 4;
        this.reasoningEffortInput.value = provider.reasoningEffort || '';
        this.maxTextCharactersInput.value = provider.maxTextCharacters || ZotExtractProviderSettings.defaultMaxTextCharacters;
        this.wholePromptTemplateInput.value = provider.wholePromptTemplate || ZotExtractProviderSettings.defaultWholePromptTemplate;
        this.chunkPromptTemplateInput.value = provider.chunkPromptTemplate || ZotExtractProviderSettings.defaultChunkPromptTemplate;
        this.updateContextWindowReadout(provider);
        this.updateModelOptions();
    },

    modelOptionValues(models = []) {
        const discovered = this.state.discoveredServers?.flatMap(server => server.models || []) || [];
        const provider = {
            ...(this.state.provider || {}),
            name: this.providerNameInput?.value || this.state.provider?.name || '',
            baseUrl: this.baseUrlInput?.value || this.state.provider?.baseUrl || ''
        };
        const providerId = this.inferProviderId(provider);
        const localProvider = this.isLocalUrl(provider.baseUrl);
        const typedModel = String(this.modelInput?.value || '').trim();
        const currentModel = String(this.state.provider?.model || '').trim();
        const fallbackModels = localProvider ? [] : ZotExtractProviderSettings.modelOptionsForProvider({
            ...provider,
            id: providerId
        });
        const values = [
            typedModel,
            currentModel,
            ...models,
            ...discovered,
            ...fallbackModels
        ].map(value => String(value || '').trim()).filter(Boolean);
        const seen = new Set();
        return values.filter(value => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    },

    updateModelOptions(models = [], options = {}) {
        if (!this.modelOptions) return;
        const query = options.showAll ? '' : String(this.modelInput?.value || '').trim().toLowerCase();
        const values = this.modelOptionValues(models)
            .filter(value => !query || value.toLowerCase().includes(query));
        this.modelOptions.innerHTML = values.length
            ? values.map((value, index) => `<div class="model-option ${index === 0 ? 'active' : ''}" role="option" data-model-option="${this.escapeHtml(value)}">${this.escapeHtml(value)}</div>`).join('')
            : '<div class="model-option empty">No discovered models match.</div>';
        this.modelOptions.querySelectorAll('[data-model-option]').forEach(option => {
            option.addEventListener('mousedown', event => event.preventDefault());
            option.addEventListener('click', () => this.selectModelOption(option.getAttribute('data-model-option') || ''));
        });
    },

    bindModelAutocomplete() {
        if (!this.modelInput || !this.modelOptions) return;
        const open = () => this.openModelMenu();
        this.modelInput.addEventListener('focus', open);
        this.modelInput.addEventListener('input', () => {
            this.updateModelOptions();
            this.openModelMenu();
        });
        this.modelInput.addEventListener('keydown', event => this.onModelKeydown(event));
        this.modelMenuToggle?.addEventListener('click', event => {
            event.preventDefault();
            if (this.modelOptions.classList.contains('visible')) this.closeModelMenu();
            else this.openModelMenu({ showAll: true });
        });
        document.addEventListener('mousedown', event => {
            if (event.target?.closest?.('[data-model-combobox]')) return;
            this.closeModelMenu();
        });
    },

    openModelMenu(options = {}) {
        if (!this.modelOptions || !this.modelInput) return;
        if (options.showAll) {
            this.updateModelOptions([], { showAll: true });
        } else {
            this.updateModelOptions();
        }
        this.modelOptions.classList.add('visible');
        this.modelInput.setAttribute('aria-expanded', 'true');
    },

    closeModelMenu() {
        this.modelOptions?.classList.remove('visible');
        this.modelInput?.setAttribute('aria-expanded', 'false');
    },

    selectModelOption(value) {
        if (!value) return;
        this.modelInput.value = value;
        this.saveProvider?.();
        this.closeModelMenu();
    },

    onModelKeydown(event) {
        if (!this.modelOptions?.classList.contains('visible')) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.openModelMenu();
            }
            return;
        }
        const options = Array.from(this.modelOptions.querySelectorAll('[data-model-option]'));
        if (!options.length) {
            if (event.key === 'Escape') this.closeModelMenu();
            return;
        }
        const activeIndex = Math.max(0, options.findIndex(option => option.classList.contains('active')));
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const nextIndex = event.key === 'ArrowDown'
                ? Math.min(options.length - 1, activeIndex + 1)
                : Math.max(0, activeIndex - 1);
            options.forEach(option => option.classList.remove('active'));
            options[nextIndex].classList.add('active');
            options[nextIndex].scrollIntoView?.({ block: 'nearest' });
        } else if (event.key === 'Enter') {
            event.preventDefault();
            this.selectModelOption(options[activeIndex].getAttribute('data-model-option') || '');
        } else if (event.key === 'Escape') {
            this.closeModelMenu();
        }
    },

    bindDiscovery() {
        if (!this.discoverButton) return;
        this.discoverButton.addEventListener('click', () => this.discoverLocalProviders());
    },

    bindExternalLinks() {
        this.downloadLmStudioButton?.addEventListener('click', () => this.openExternalUrl('https://lmstudio.ai/download'));
    },

    openExternalUrl(url) {
        try {
            if (typeof Zotero.launchURL === 'function') {
                Zotero.launchURL(url);
                return;
            }
            if (typeof Zotero.openInViewer === 'function') {
                Zotero.openInViewer(url);
                return;
            }
            if (typeof Services !== 'undefined' && Services.io && typeof Cc !== 'undefined' && typeof Ci !== 'undefined') {
                const uri = Services.io.newURI(url);
                Cc['@mozilla.org/uriloader/external-protocol-service;1']
                    .getService(Ci.nsIExternalProtocolService)
                    .loadURI(uri);
                return;
            }
            window.open(url, '_blank', 'noopener');
        } catch (e) {
            Zotero.logError(e);
            if (typeof window.alert === 'function') window.alert(`Open this URL in your browser:\n${url}`);
        }
    },

    bindSessionsLink() {
        if (!this.openSessionsButton) return;
        this.openSessionsButton.addEventListener('click', event => {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            this.openSessionsForUser();
        });
    },

    bindContextWindowCheck() {
        if (!this.checkContextButton) return;
        this.checkContextButton.addEventListener('click', () => this.checkContextWindowForCurrentProvider());
    },

    bindDataReset() {
        if (!this.deleteDataButton) return;
        this.deleteDataButton.addEventListener('click', () => this.deleteZotExtractData());
    },

    async deleteZotExtractData() {
        const message = [
            'Delete all ZotExtract data from this local Zotero profile?',
            '',
            'This deletes ZotExtract sessions, extraction results, saved question sets, provider settings, prompts, and ZotExtract preferences.',
            '',
            'It does not delete Zotero library items, PDFs, notes, collections, or Zotero account data.'
        ].join('\n');
        const confirmed = typeof Services !== 'undefined' && Services.prompt?.confirm
            ? Services.prompt.confirm(window, 'Delete ZotExtract Data', message)
            : window.confirm(message);
        if (!confirmed) return;

        this.deleteDataButton.disabled = true;
        this.setDataResetStatus('Deleting ZotExtract data...', true);
        try {
            const win = (Zotero.getMainWindow && Zotero.getMainWindow()) || null;
            if (!win?.ZotExtract?.deleteAllLocalData) {
                throw new Error('ZotExtract cleanup API is not available. Return to the Zotero library window and try again.');
            }
            await win.ZotExtract.deleteAllLocalData();
            this.state.provider = ZotExtractProviderSettings.load();
            this.populateProviderInputs(this.state.provider);
            this.state.discoveredServers = [];
            if (this.discoveryResults) this.discoveryResults.innerHTML = '';
            this.setDiscoveryStatus('', false);
            this.setDataResetStatus('ZotExtract local data was deleted. Restart Zotero if the Plugins window still shows staged plugin state.', true);
        } catch (e) {
            Zotero.logError(e);
            this.setDataResetStatus(`Could not delete ZotExtract data: ${e.message || String(e)}`, true);
        } finally {
            this.deleteDataButton.disabled = false;
        }
    },

    openSessionsForUser() {
        try {
            const win = (Zotero.getMainWindow && Zotero.getMainWindow()) || null;
            if (!win || !win.ZotExtract || typeof win.ZotExtract.openSessionsTab !== 'function') {
                const message = 'Could not open ZotExtract sessions. Return to the Zotero library and open "My ZotExtract Sessions" from the left library panel.';
                if (typeof window.alert === 'function') window.alert(message);
                if (typeof Zotero.debug === 'function') {
                    Zotero.debug(`ZotExtract: ${message}`);
                }
                return;
            }
            win.ZotExtract.openSessionsTab(win);
        } catch (e) {
            Zotero.logError(e);
            const message = 'Could not open ZotExtract sessions. Please open the Zotero library and select My ZotExtract Sessions.';
            if (typeof window.alert === 'function') window.alert(message);
            if (typeof Zotero.debug === 'function') {
                Zotero.debug(`ZotExtract: ${message} ${String(e && e.message || e)}`);
            }
        }
    },

    async discoverLocalProviders() {
        const candidates = this.localProviderCandidates();
        this.discoverButton.disabled = true;
        this.setDiscoveryStatus('Scanning common local model server ports...', true);
        this.discoveryResults.innerHTML = '';
        this.state.discoveryErrors = [];

        try {
            const results = await Promise.all(candidates.map(candidate => this.probeLocalProvider(candidate)));
            this.state.discoveredServers = this.uniqueDiscoveredServers(results.filter(Boolean));
            this.renderDiscoveryResults();
        } finally {
            this.discoverButton.disabled = false;
        }
    },

    localProviderCandidates() {
        const candidates = [];
        const addLocalCandidates = (definitions) => {
            ['127.0.0.1', 'localhost'].forEach(host => {
                definitions.forEach(definition => {
                    const probes = definition.probes || [definition];
                    probes.forEach(probe => {
                        candidates.push({
                            id: definition.id,
                            name: definition.name,
                            baseUrl: `http://${host}:${definition.port}${probe.basePath || definition.basePath || '/v1'}`,
                            probeUrl: `http://${host}:${definition.port}${probe.probePath}`,
                            timeoutMs: probe.timeoutMs || definition.timeoutMs,
                            parser: probe.parser || definition.parser
                        });
                    });
                });
            });
        };
        addLocalCandidates([
            {
                id: 'ollama',
                name: 'Ollama',
                port: 11434,
                probePath: '/api/tags',
                parser: data => (data.models || []).map(model => model.name).filter(Boolean)
            },
            {
                id: 'lm-studio',
                name: 'LM Studio',
                port: 1234,
                timeoutMs: 4000,
                probes: this.lmStudioDiscoveryProbes()
            },
            {
                id: 'lm-studio',
                name: 'LM Studio',
                port: 1236,
                timeoutMs: 4000,
                probes: this.lmStudioDiscoveryProbes()
            },
            {
                id: 'lm-studio',
                name: 'LM Studio',
                port: 1235,
                timeoutMs: 4000,
                probes: this.lmStudioDiscoveryProbes()
            },
            {
                id: 'llama-cpp',
                name: 'llama.cpp server',
                port: 8080,
                probePath: '/v1/models',
                parser: data => (data.data || []).map(model => model.id).filter(Boolean)
            },
            {
                id: 'jan',
                name: 'Jan local server',
                port: 1337,
                probePath: '/v1/models',
                parser: data => (data.data || []).map(model => model.id).filter(Boolean)
            }
        ]);
        const typedBaseUrl = this.normalizeBaseUrl(this.baseUrlInput?.value || '');
        if (typedBaseUrl && this.isLocalUrl(typedBaseUrl)) {
            const providerId = this.inferProviderId({ name: this.providerNameInput?.value || '', baseUrl: typedBaseUrl }) || 'openai-compatible-local';
            candidates.unshift({
                id: providerId,
                name: this.providerNameInput?.value?.trim() || 'OpenAI-compatible local server',
                baseUrl: typedBaseUrl,
                probeUrl: this.typedProviderProbeUrl(typedBaseUrl, providerId),
                parser: data => this.parseOpenAiModelList(data)
            });
        }
        const seen = new Set();
        return candidates.filter(candidate => {
            const key = `${candidate.id}:${candidate.probeUrl}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    },

    lmStudioDiscoveryProbes() {
        const parser = data => this.parseLmStudioModelList(data);
        return [
            { probePath: '/v1/models', basePath: '/v1', parser },
            { probePath: '/api/v1/models', basePath: '/v1', parser },
            { probePath: '/api/v0/models', basePath: '/v1', parser }
        ];
    },

    typedProviderProbeUrl(baseUrl, providerId) {
        const value = String(baseUrl || '').replace(/\/+$/, '');
        if (!value) return '';
        if (providerId === 'ollama') return `${this.providerOrigin(value)}/api/tags`;
        if (/\/v1$/i.test(value)) return `${value}/models`;
        if (providerId === 'lm-studio' || providerId === 'llama-cpp' || providerId === 'jan') {
            return `${this.providerOrigin(value)}/v1/models`;
        }
        return `${value}/models`;
    },

    parseOpenAiModelList(data) {
        return (data?.data || data?.models || [])
            .map(model => model.id || model.name || model.key || model.display_name)
            .filter(Boolean);
    },

    parseLmStudioModelList(data) {
        return this.parseOpenAiModelList(data);
    },

    async probeLocalProvider(candidate) {
        try {
            const data = await this.fetchJsonWithTimeout(candidate.probeUrl, candidate.timeoutMs || 1800);
            const models = candidate.parser(data);
            const model = models[0] || this.modelInput.value.trim();
            const contextInfo = await this.detectContextWindowForProvider({
                id: candidate.id,
                name: candidate.name,
                baseUrl: candidate.baseUrl,
                model
            });
            return {
                ...candidate,
                models,
                model,
                ...contextInfo
            };
        } catch (e) {
            this.recordDiscoveryFailure(candidate, e);
            return null;
        }
    },

    async fetchJsonWithTimeout(url, timeoutMs, options = {}) {
        if (this.canUseZoteroHttp()) {
            try {
                return await this.fetchJsonWithZoteroHttp(url, timeoutMs, options);
            } catch (e) {
                if (typeof fetch !== 'function') throw e;
            }
        }
        return this.fetchJsonWithWindowFetch(url, timeoutMs, options);
    },

    canUseZoteroHttp() {
        return typeof Zotero !== 'undefined'
            && Zotero.HTTP
            && typeof Zotero.HTTP.request === 'function';
    },

    async fetchJsonWithZoteroHttp(url, timeoutMs, options = {}) {
        const method = options.method || 'GET';
        const requestOptions = {
            responseType: 'json',
            timeout: timeoutMs
        };
        if (options.headers) requestOptions.headers = options.headers;
        if (options.body) requestOptions.body = options.body;
        const response = await this.withRequestTimeout(
            Zotero.HTTP.request(method, url, requestOptions),
            timeoutMs
        );
        return this.parseJsonResponse(response, url);
    },

    async fetchJsonWithWindowFetch(url, timeoutMs, options = {}) {
        if (typeof fetch !== 'function') {
            throw new Error('No HTTP request API is available in the Zotero preferences pane.');
        }
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
        try {
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers: options.headers,
                body: options.body,
                signal: controller ? controller.signal : undefined
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    },

    async withRequestTimeout(promise, timeoutMs) {
        let timeout = null;
        try {
            return await Promise.race([
                promise,
                new Promise((resolve, reject) => {
                    timeout = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
                })
            ]);
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    },

    parseJsonResponse(response, url) {
        const status = Number(response?.status || response?.statusCode || 0);
        if (status && (status < 200 || status >= 300)) {
            throw new Error(`HTTP ${status}`);
        }
        const values = [
            response?.response,
            response?.responseJSON,
            response?.json,
            response?.responseText
        ];
        for (const value of values) {
            if (value && typeof value === 'object') return value;
            if (typeof value === 'string' && value.trim()) {
                try {
                    return JSON.parse(value);
                } catch (e) {
                    throw new Error(`Invalid JSON from ${url}: ${e.message}`);
                }
            }
        }
        return {};
    },

    recordDiscoveryFailure(candidate, error) {
        if (!this.state.discoveryErrors) this.state.discoveryErrors = [];
        this.state.discoveryErrors.push({
            name: candidate.name,
            url: candidate.probeUrl,
            message: this.discoveryErrorMessage(error, candidate)
        });
    },

    discoveryErrorMessage(error, candidate) {
        const message = String(error?.message || error || 'Request failed');
        if (/abort|timed out|timeout/i.test(message)) {
            if (candidate?.id === 'lm-studio') return 'timed out (LM Studio Local Server may be off)';
            return 'timed out';
        }
        if (/HTTP \d+/.test(message)) return message.match(/HTTP \d+/)[0];
        if (/NetworkError|Failed to fetch|connection refused|ECONNREFUSED/i.test(message)) return 'connection failed';
        return message;
    },

    uniqueDiscoveredServers(servers) {
        const seen = new Set();
        return servers.filter(server => {
            const key = this.discoveryServerKey(server);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    },

    discoveryServerKey(server) {
        try {
            const url = new URL(server.baseUrl);
            const port = url.port || (url.protocol === 'https:' ? '443' : '80');
            return `${server.id}:${url.protocol}//:${port}`;
        } catch (_) {
            return `${server.id}:${server.baseUrl}`;
        }
    },

    async checkContextWindowForCurrentProvider() {
        this.saveProvider();
        this.checkContextButton.disabled = true;
        this.setDiscoveryStatus('Checking model context window...', true);
        try {
            const provider = {
                ...this.state.provider,
                id: this.inferProviderId(this.state.provider)
            };
            const contextInfo = await this.detectContextWindowForProvider(provider, { loadIfNeeded: true });
            this.applyContextWindowInfo(contextInfo, contextInfo.contextWindowTokens ? contextInfo.contextWindowSource : 'Not reported by provider');
            this.saveProvider();
            this.setDiscoveryStatus(
                contextInfo.contextWindowTokens
                    ? `Detected ${this.contextWindowLabel(this.state.provider)}.`
                    : 'This provider did not report a context window. You can enter it manually in Advanced provider configuration.',
                true
            );
        } finally {
            this.checkContextButton.disabled = false;
        }
    },

    async detectContextWindowForProvider(provider, options = {}) {
        const id = provider.id || this.inferProviderId(provider);
        const known = ZotExtractProviderSettings.knownContextForModel(provider.model);
        if (known && !this.isLocalUrl(provider.baseUrl)) return known;
        if (id === 'lm-studio') return this.detectLmStudioContext(provider, options);
        if (id === 'ollama') return this.detectOllamaContext(provider);
        if (id === 'llama-cpp') return this.detectLlamaCppContext(provider);
        if (id === 'openrouter') return this.detectOpenRouterContext(provider);
        return { contextWindowTokens: 0, maxContextWindowTokens: 0, contextWindowSource: '' };
    },

    async detectOpenRouterContext(provider) {
        if (!provider.model) return { contextWindowTokens: 0, maxContextWindowTokens: 0, contextWindowSource: '' };
        try {
            const baseUrl = this.normalizeBaseUrl(provider.baseUrl || 'https://openrouter.ai/api/v1');
            const headers = provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined;
            const data = await this.fetchJsonWithTimeout(`${baseUrl}/models`, 2500, { headers });
            const models = data?.data || data?.models || [];
            const target = this.normalizedModelId(provider.model);
            const match = models.find(model => this.normalizedModelId(model.id || model.name || '') === target);
            const context = this.firstNumber(
                match?.context_length,
                match?.contextWindow,
                match?.context_window,
                match?.top_provider?.context_length
            );
            const output = this.firstNumber(
                match?.max_completion_tokens,
                match?.max_output_tokens,
                match?.top_provider?.max_completion_tokens
            );
            return {
                contextWindowTokens: context || 0,
                maxContextWindowTokens: context || 0,
                maxOutputTokens: output || 0,
                contextWindowSource: context ? 'OpenRouter model metadata' : ''
            };
        } catch (_) {
            return { contextWindowTokens: 0, maxContextWindowTokens: 0, contextWindowSource: '' };
        }
    },

    async detectLmStudioContext(provider, options = {}) {
        const origin = this.providerOrigin(provider.baseUrl);
        const modelId = provider.model || '';
        const loadIfNeeded = !!options.loadIfNeeded;
        let bestMaximum = 0;
        const endpoints = [
            { url: `${origin}/api/v1/models`, kind: 'v1' },
            { url: `${origin}/api/v0/models`, kind: 'v0' }
        ];
        const inspect = async () => {
            for (const endpoint of endpoints) {
                try {
                    const data = await this.fetchJsonWithTimeout(endpoint.url, 2200);
                    const model = this.findLmStudioModel(data, modelId, endpoint.kind);
                    if (!model) continue;
                    const loadedContext = this.firstNumber(
                        model.loaded_context_length,
                        model.loaded_instances?.[0]?.config?.context_length
                    );
                    const maxContext = this.firstNumber(model.max_context_length);
                    bestMaximum = Math.max(bestMaximum, maxContext || 0);
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
        };

        const loaded = await inspect();
        if (loaded) return loaded;

        if (loadIfNeeded && modelId) {
            try {
                this.setDiscoveryStatus(`Loading ${modelId} in LM Studio to read its configured context window...`, true);
                await this.loadLmStudioModel(provider);
                const afterLoad = await inspect();
                if (afterLoad) return afterLoad;
            } catch (_) {}
        }

        return {
            contextWindowTokens: 0,
            maxContextWindowTokens: bestMaximum,
            contextWindowSource: bestMaximum ? 'LM Studio model maximum; active loaded context not reported' : ''
        };
    },

    async loadLmStudioModel(provider) {
        const origin = this.providerOrigin(provider.baseUrl);
        return this.fetchJsonWithTimeout(`${origin}/api/v1/models/load`, 60000, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: provider.model })
        });
    },

    findLmStudioModel(data, modelId, kind) {
        const models = kind === 'v1' ? (data.models || []) : (data.data || []);
        return models.find(model => [model.id, model.key, model.display_name].filter(Boolean).includes(modelId))
            || models.find(model => model.loaded_context_length || model.loaded_instances?.length)
            || models[0];
    },

    async detectOllamaContext(provider) {
        if (!provider.model) return { contextWindowTokens: 0, maxContextWindowTokens: 0, contextWindowSource: '' };
        try {
            const data = await this.fetchJsonWithTimeout(`${this.providerOrigin(provider.baseUrl)}/api/show`, 2200, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: provider.model })
            });
            const info = data.model_info || {};
            const contextKey = Object.keys(info).find(key => /context_length$/i.test(key));
            const context = this.firstNumber(contextKey ? info[contextKey] : 0, data.parameters?.num_ctx);
            return {
                contextWindowTokens: context || 0,
                maxContextWindowTokens: context || 0,
                contextWindowSource: context ? 'Ollama model metadata' : ''
            };
        } catch (_) {
            return { contextWindowTokens: 0, maxContextWindowTokens: 0, contextWindowSource: '' };
        }
    },

    async detectLlamaCppContext(provider) {
        try {
            const data = await this.fetchJsonWithTimeout(`${this.providerOrigin(provider.baseUrl)}/props`, 1800);
            const context = this.firstNumber(data.default_generation_settings?.n_ctx, data.n_ctx, data.context_length);
            return {
                contextWindowTokens: context || 0,
                maxContextWindowTokens: context || 0,
                contextWindowSource: context ? 'llama.cpp server props' : ''
            };
        } catch (_) {
            return { contextWindowTokens: 0, maxContextWindowTokens: 0, contextWindowSource: '' };
        }
    },

    providerOrigin(baseUrl) {
        try {
            const url = new URL(baseUrl || 'http://127.0.0.1');
            return `${url.protocol}//${url.host}`;
        } catch (_) {
            return String(baseUrl || '').replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
        }
    },

    normalizeBaseUrl(baseUrl) {
        const value = String(baseUrl || '').trim();
        if (!value) return '';
        return value.replace(/\/+$/, '').replace(/\/models$/i, '').replace(/\/chat\/completions$/i, '');
    },

    isLocalUrl(baseUrl) {
        return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal/i.test(String(baseUrl || ''));
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

    firstNumber(...values) {
        for (const value of values) {
            const number = Number(value);
            if (Number.isFinite(number) && number > 0) return Math.round(number);
        }
        return 0;
    },

    renderDiscoveryResults() {
        const results = this.state.discoveredServers;
        if (!results.length) {
            const failures = this.discoveryFailureSummary();
            this.setDiscoveryStatus(
                failures
                    ? `No local model server was found. Start Ollama, LM Studio, or another OpenAI-compatible local server, then scan again. Checked endpoints reported: ${failures}.`
                    : 'No local model server was found. Start Ollama, LM Studio, or another OpenAI-compatible local server, then scan again.',
                true
            );
            return;
        }

        this.updateModelOptions(results.flatMap(server => server.models || []));
        this.setDiscoveryStatus(`Found ${results.length} local model server${results.length === 1 ? '' : 's'}.`, true);
        this.discoveryResults.innerHTML = results.map((server, index) => `
            <div class="server-card">
                <div>
                    <div class="name">${this.escapeHtml(server.name)}</div>
                    <div class="meta">${this.escapeHtml(server.baseUrl)}${server.model ? ` - ${this.escapeHtml(server.model)}` : ''}</div>
                    <div class="meta">${server.models.length ? `${server.models.length} model${server.models.length === 1 ? '' : 's'} available` : 'Server responded, but did not list models'}</div>
                    <div class="meta">${this.escapeHtml(this.contextWindowLabel(server))}</div>
                </div>
                <button type="button" class="secondary" data-discovery-index="${index}">Use</button>
            </div>
        `).join('');
        this.discoveryResults.querySelectorAll('[data-discovery-index]').forEach(button => {
            button.addEventListener('click', () => {
                const server = this.state.discoveredServers[Number(button.getAttribute('data-discovery-index'))];
                if (server) this.applyDiscoveredProvider(server);
            });
        });

        if (results.length === 1) {
            this.applyDiscoveredProvider(results[0], { quiet: true });
        }
    },

    applyDiscoveredProvider(server, options = {}) {
        this.providerNameInput.value = server.name;
        this.baseUrlInput.value = server.baseUrl;
        const currentModel = this.modelInput.value.trim();
        const staleDefault = !currentModel || ZotExtractProviderSettings.isBundledDefaultModel(currentModel);
        this.modelInput.value = server.model || (staleDefault ? '' : currentModel);
        this.apiKeyInput.value = '';
        this.applyContextWindowInfo(server, server.contextWindowSource || '');
        this.updateModelOptions(server.models || [], { showAll: true });
        this.saveProvider();
        if (!options.quiet) {
            this.setDiscoveryStatus(`${server.name} selected. The API key field was cleared because this is a local provider. ${this.contextWindowLabel(this.state.provider)}.`, true);
        }
    },

    applyContextWindowInfo(info, source) {
        if (info.contextWindowTokens) {
            this.contextWindowTokensInput.value = info.contextWindowTokens;
        }
        const existingContext = Number(this.contextWindowTokensInput.value) || 0;
        this.state.provider = {
            ...(this.state.provider || {}),
            contextWindowTokens: info.contextWindowTokens || existingContext,
            maxContextWindowTokens: info.maxContextWindowTokens || this.state.provider?.maxContextWindowTokens || 0,
            contextWindowSource: source || info.contextWindowSource || ''
        };
        this.updateContextWindowReadout(this.state.provider);
    },

    updateContextWindowReadout(provider) {
        if (!this.contextWindowReadout) return;
        this.contextWindowReadout.innerHTML = `<strong>Context window:</strong> ${this.escapeHtml(this.contextWindowLabel(provider))}`;
    },

    contextWindowLabel(provider) {
        const context = Number(provider?.contextWindowTokens || 0);
        const max = Number(provider?.maxContextWindowTokens || 0);
        const source = provider?.contextWindowSource ? ` (${provider.contextWindowSource})` : '';
        if (!context) return 'Unknown';
        if (max && max !== context) return `${this.formatInteger(context)} tokens active, ${this.formatInteger(max)} tokens maximum${source}`;
        return `${this.formatInteger(context)} tokens${source}`;
    },

    formatInteger(value) {
        return Number(value || 0).toLocaleString();
    },

    discoveryFailureSummary() {
        const errors = this.state.discoveryErrors || [];
        if (!errors.length) return '';
        const summary = [];
        const seen = new Set();
        errors.forEach(error => {
            let label = error.name || 'local server';
            try {
                const url = new URL(error.url);
                label = `${label} ${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
            } catch (_) {}
            const text = `${label} ${error.message || 'failed'}`;
            if (seen.has(text)) return;
            seen.add(text);
            summary.push(text);
        });
        return summary.slice(0, 4).join('; ');
    },

    setDiscoveryStatus(message, visible) {
        if (!this.discoveryStatus) return;
        this.discoveryStatus.classList.toggle('visible', !!visible);
        this.discoveryStatus.innerHTML = `<strong>Local discovery:</strong> ${this.escapeHtml(message)}`;
    },

    setDataResetStatus(message, visible) {
        if (!this.dataResetStatus) return;
        this.dataResetStatus.classList.toggle('visible', !!visible);
        this.dataResetStatus.innerHTML = `<strong>Plugin data:</strong> ${this.escapeHtml(message)}`;
    },

    escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
};

function waitForElement(id, callback, maxAttempts = 50) {
    let attempts = 0;
    const check = () => {
        const el = document.getElementById(id);
        if (el) {
            callback();
        } else if (attempts < maxAttempts) {
            attempts++;
            setTimeout(check, 100);
        } else {
            console.error('ZotExtract: Preference pane elements not found after ' + maxAttempts + ' attempts');
        }
    };
    check();
}

function initPreferences() {
    try {
        ZotExtractPreferences.init();
    } catch (e) {
        console.error('ZotExtract Preferences init error:', e);
        if (typeof Zotero !== 'undefined') Zotero.logError(e);
    }
}

waitForElement('providerName', initPreferences);
