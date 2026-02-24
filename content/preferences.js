var ZotExtractPreferences = {
    prefs: {
        provider: 'extensions.zotextract.provider',
        prompts: 'extensions.zotextract.prompts',
        apiKey: 'extensions.zotextract.apiKey',
        model: 'extensions.zotextract.model'
    },
    state: {
        provider: null,
        prompts: []
    },
    editingPromptId: null,

    init() {
        // In Zotero 7 preference panes, Zotero is available as a global
        if (typeof Zotero === 'undefined') {
            console.error('Zotero not available in preferences page.');
            return;
        }

        this.providerNameInput = document.getElementById('providerName');
        this.modelInput = document.getElementById('model');
        this.baseUrlInput = document.getElementById('baseUrl');
        this.apiKeyInput = document.getElementById('apiKey');
        this.fileEndpointInput = document.getElementById('fileEndpoint');
        this.systemPromptInput = document.getElementById('systemPrompt');

        this.promptNameInput = document.getElementById('promptName');
        this.promptContextSelect = document.getElementById('promptContext');
        this.promptTextInput = document.getElementById('promptText');
        this.promptList = document.getElementById('promptList');
        this.savePromptButton = document.getElementById('savePrompt');
        this.cancelEditButton = document.getElementById('cancelEdit');

        this.state.provider = this.loadProvider();
        this.state.prompts = this.loadPrompts();

        this.bindProviderInputs();
        this.renderPrompts();
        this.bindPromptActions();
    },

    bindProviderInputs() {
        const provider = this.state.provider;
        this.providerNameInput.value = provider.name || '';
        this.modelInput.value = provider.model || 'gpt-4o-mini';
        this.baseUrlInput.value = provider.baseUrl || 'https://api.openai.com/v1';
        this.apiKeyInput.value = provider.apiKey || '';
        this.fileEndpointInput.value = provider.fileEndpoint || '';
        this.systemPromptInput.value = provider.systemPrompt || '';

        const saveProvider = () => this.saveProvider({
            name: this.providerNameInput.value.trim(),
            model: this.modelInput.value.trim(),
            baseUrl: this.baseUrlInput.value.trim(),
            apiKey: this.apiKeyInput.value.trim(),
            fileEndpoint: this.fileEndpointInput.value.trim(),
            systemPrompt: this.systemPromptInput.value.trim()
        });

        [
            this.providerNameInput,
            this.modelInput,
            this.baseUrlInput,
            this.apiKeyInput,
            this.fileEndpointInput,
            this.systemPromptInput
        ].forEach(el => el.addEventListener('input', saveProvider));
    },

    bindPromptActions() {
        this.savePromptButton.addEventListener('click', () => this.onSavePrompt());
        this.cancelEditButton.addEventListener('click', () => this.resetPromptEditor());
    },

    loadProvider() {
        let provider = null;
        try {
            const stored = Zotero.Prefs.get(this.prefs.provider);
            if (stored) provider = JSON.parse(stored);
        } catch (e) {
            Zotero.logError(e);
        }

        if (!provider) {
            provider = {
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                model: Zotero.Prefs.get(this.prefs.model) || 'gpt-4o-mini',
                apiKey: Zotero.Prefs.get(this.prefs.apiKey) || '',
                fileEndpoint: '',
                systemPrompt: 'You are a helpful research assistant.'
            };
        } else {
            provider.apiKey = provider.apiKey || Zotero.Prefs.get(this.prefs.apiKey) || '';
            provider.model = provider.model || Zotero.Prefs.get(this.prefs.model) || 'gpt-4o-mini';
        }

        return provider;
    },

    saveProvider(provider) {
        this.state.provider = provider;
        Zotero.Prefs.set(this.prefs.provider, JSON.stringify(provider));
        Zotero.Prefs.set(this.prefs.apiKey, provider.apiKey || '');
        Zotero.Prefs.set(this.prefs.model, provider.model || '');
    },

    loadPrompts() {
        try {
            const stored = Zotero.Prefs.get(this.prefs.prompts);
            if (stored) return JSON.parse(stored);
        } catch (e) {
            Zotero.logError(e);
        }

        return [
            {
                id: 'summary',
                name: 'Concise summary',
                context: 'fulltext',
                prompt: 'Summarize the paper in 5 bullet points. Capture goal, methods, key results, and conclusions.'
            },
            {
                id: 'methods',
                name: 'Methods + data',
                context: 'fulltext',
                prompt: 'Outline the methodology, datasets, and evaluation metrics used in the paper.'
            },
            {
                id: 'limitations',
                name: 'Limitations',
                context: 'fulltext',
                prompt: 'List potential limitations, confounders, or assumptions that could affect the validity of the findings.'
            },
            {
                id: 'pdf-figures',
                name: 'Figure/appendix scan',
                context: 'pdf-file',
                prompt: 'Review the PDF directly and summarize important numbers, tables, and figures.'
            }
        ];
    },

    savePrompts(prompts) {
        this.state.prompts = prompts;
        Zotero.Prefs.set(this.prefs.prompts, JSON.stringify(prompts));
    },

    renderPrompts() {
        this.promptList.innerHTML = '';
        if (!this.state.prompts.length) {
            const empty = document.createElement('p');
            empty.className = 'hint';
            empty.textContent = 'No prompts yet. Add one below.';
            this.promptList.appendChild(empty);
            return;
        }

        this.state.prompts.forEach(prompt => {
            const row = document.createElement('div');
            row.className = 'prompt-row';

            const meta = document.createElement('div');
            meta.className = 'meta';
            const title = document.createElement('strong');
            title.textContent = prompt.name;
            const label = document.createElement('span');
            label.className = 'pill';
            label.textContent = prompt.context === 'pdf-file' ? 'Send PDF file' : 'Full text';
            const text = document.createElement('div');
            text.className = 'hint';
            text.textContent = prompt.prompt;

            meta.appendChild(title);
            meta.appendChild(label);
            meta.appendChild(text);

            const actions = document.createElement('div');
            actions.className = 'actions';
            const editBtn = document.createElement('button');
            editBtn.className = 'secondary';
            editBtn.textContent = 'Edit';
            editBtn.addEventListener('click', () => this.startEditPrompt(prompt.id));
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'danger';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', () => this.deletePrompt(prompt.id));

            actions.appendChild(editBtn);
            actions.appendChild(deleteBtn);

            row.appendChild(meta);
            row.appendChild(actions);
            this.promptList.appendChild(row);
        });
    },

    startEditPrompt(id) {
        const prompt = this.state.prompts.find(p => p.id === id);
        if (!prompt) return;
        this.editingPromptId = id;
        this.promptNameInput.value = prompt.name;
        this.promptContextSelect.value = prompt.context;
        this.promptTextInput.value = prompt.prompt;
        this.savePromptButton.textContent = 'Update prompt';
    },

    resetPromptEditor() {
        this.editingPromptId = null;
        this.promptNameInput.value = '';
        this.promptContextSelect.value = 'fulltext';
        this.promptTextInput.value = '';
        this.savePromptButton.textContent = 'Add prompt';
    },

    onSavePrompt() {
        const name = this.promptNameInput.value.trim();
        const context = this.promptContextSelect.value;
        const promptText = this.promptTextInput.value.trim();

        if (!name || !promptText) {
            alert('Please provide both a prompt name and text.');
            return;
        }

        const prompts = [...this.state.prompts];
        if (this.editingPromptId) {
            const idx = prompts.findIndex(p => p.id === this.editingPromptId);
            if (idx !== -1) {
                prompts[idx] = { ...prompts[idx], name, context, prompt: promptText };
            }
        } else {
            prompts.push({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                name,
                context,
                prompt: promptText
            });
        }

        this.savePrompts(prompts);
        this.renderPrompts();
        this.resetPromptEditor();
    },

    deletePrompt(id) {
        const prompts = this.state.prompts.filter(p => p.id !== id);
        this.savePrompts(prompts);
        this.renderPrompts();
        if (this.editingPromptId === id) {
            this.resetPromptEditor();
        }
    }
};

// Wait for the preference pane DOM to be ready
// In Zotero 7, the preference pane content may load asynchronously
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

// Initialize when DOM elements are available
function initPreferences() {
    try {
        ZotExtractPreferences.init();
    } catch (e) {
        console.error('ZotExtract Preferences init error:', e);
        if (typeof Zotero !== 'undefined') Zotero.logError(e);
    }
}

// Wait for the providerName element to exist, then initialize
waitForElement('providerName', initPreferences);
