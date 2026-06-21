var ZotExtractData = {
        nowIso() {
            return new Date().toISOString();
        },

        makeId(prefix) {
            return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        },

        async profileBasePath() {
            const baseDir = (Zotero.DataDirectory && Zotero.DataDirectory.dir) || (Zotero.Profile && Zotero.Profile.dir);
            const basePath = typeof baseDir === 'string' ? baseDir : baseDir?.path;
            if (!basePath) throw new Error('Could not find Zotero profile directory.');
            return basePath;
        },

        async zotextractDataDir() {
            if (typeof IOUtils === 'undefined' || typeof PathUtils === 'undefined') {
                throw new Error('Zotero file APIs are not available in this runtime.');
            }
            const dir = PathUtils.join(await this.profileBasePath(), 'zotextract-data');
            await IOUtils.makeDirectory(dir, { ignoreExisting: true });
            return dir;
        },

        async zotextractResultsDir() {
            const dir = PathUtils.join(await this.zotextractDataDir(), 'results');
            await IOUtils.makeDirectory(dir, { ignoreExisting: true });
            return dir;
        },

        async preserveCorruptJson(path, text, error) {
            try {
                const corruptPath = `${path}.corrupt-${Date.now()}`;
                if (typeof IOUtils !== 'undefined' && typeof IOUtils.writeUTF8 === 'function') {
                    await IOUtils.writeUTF8(corruptPath, text || '');
                    Zotero.debug?.(`ZotExtract: preserved corrupt JSON at ${corruptPath}: ${error?.message || error}`);
                }
            } catch (e) {
                Zotero.logError(e);
            }
        },

        async writeUtf8Atomic(path, text) {
            const tmpPath = `${path}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
            await IOUtils.writeUTF8(tmpPath, text);
            if (typeof IOUtils.move === 'function') {
                try {
                    await IOUtils.move(tmpPath, path, { noOverwrite: false });
                    return path;
                } catch (e) {
                    Zotero.logError(e);
                }
            }
            await IOUtils.writeUTF8(path, text);
            try {
                if (tmpPath !== path && typeof IOUtils.remove === 'function') await IOUtils.remove(tmpPath, { ignoreAbsent: true });
            } catch (_) {}
            return path;
        },

        async readJsonData(fileName, fallback, options = {}) {
            const path = PathUtils.join(await this.zotextractDataDir(), fileName);
            try {
                if (!(await IOUtils.exists(path))) return fallback;
                const text = await IOUtils.readUTF8(path);
                if (!text) return fallback;
                try {
                    return JSON.parse(text);
                } catch (e) {
                    await this.preserveCorruptJson(path, text, e);
                    throw e;
                }
            } catch (e) {
                Zotero.logError(e);
                if (options.throwOnError) throw e;
                return fallback;
            }
        },

        async writeJsonData(fileName, value) {
            const path = PathUtils.join(await this.zotextractDataDir(), fileName);
            await this.writeUtf8Atomic(path, JSON.stringify(value, null, 2));
            return path;
        },

        async readResultCells(sessionId) {
            const path = PathUtils.join(await this.zotextractResultsDir(), `${sessionId}.json`);
            try {
                if (!(await IOUtils.exists(path))) return [];
                const text = await IOUtils.readUTF8(path);
                if (!text) return [];
                try {
                    return JSON.parse(text);
                } catch (e) {
                    await this.preserveCorruptJson(path, text, e);
                    throw e;
                }
            } catch (e) {
                Zotero.logError(e);
                return [];
            }
        },

        async writeResultCells(sessionId, cells) {
            const path = PathUtils.join(await this.zotextractResultsDir(), `${sessionId}.json`);
            await this.writeUtf8Atomic(path, JSON.stringify(cells, null, 2));
            return path;
        },

        async deleteResultCells(sessionId) {
            try {
                const path = PathUtils.join(await this.zotextractResultsDir(), `${sessionId}.json`);
                if (await IOUtils.exists(path)) await IOUtils.remove(path, { ignoreAbsent: true });
            } catch (e) {
                Zotero.logError(e);
            }
        },

        clearUserPref(key) {
            try {
                if (typeof Zotero.Prefs?.clear === 'function') {
                    Zotero.Prefs.clear(key, true);
                    return;
                }
                if (typeof Services?.prefs?.clearUserPref === 'function') {
                    Services.prefs.clearUserPref(key);
                    return;
                }
            } catch (e) {
                Zotero.logError(e);
            }
            try {
                Zotero.Prefs?.set?.(key, '', true);
            } catch (e) {
                Zotero.logError(e);
            }
        },

        resetRuntimeState() {
            this.currentSessionId = null;
            this.sessionFilter = 'all';
            this.sessionSearchQuery = '';
            this.providerSetupPromptScheduled = false;
            this.librarySessionsCollapsed = true;
        },

        async deleteAllLocalData() {
            const basePath = await this.profileBasePath();
            const dataDir = PathUtils.join(basePath, 'zotextract-data');
            const exportDir = PathUtils.join(basePath, 'zotextract-exports');
            if (await IOUtils.exists(dataDir)) {
                await IOUtils.remove(dataDir, { recursive: true, ignoreAbsent: true });
            }
            if (await IOUtils.exists(exportDir)) {
                await IOUtils.remove(exportDir, { recursive: true, ignoreAbsent: true });
            }
            [
                ...Object.values(this.PREFS),
                'extensions.zotextract.appearanceMode',
                'extensions.zotextract.welcomeDismissed',
                'extensions.zotero.extensions.zotextract.apiKey',
                'extensions.zotero.extensions.zotextract.model',
                'extensions.zotero.extensions.zotextract.prompts',
                'extensions.zotero.extensions.zotextract.provider',
                'extensions.zotero.lastSelectedPrefPane',
                'extensions.zotero.panes.zotextract-nfdixcs-org-zotextract-review-panel.open'
            ].forEach(key => this.clearUserPref(key));
            this.resetRuntimeState();
            for (const win of this.windows || []) {
                try {
                    win.document?.getElementById?.('zotextract-install-tip')?.remove?.();
                    win.document?.getElementById?.('zotextract-shortcut-tip')?.remove?.();
                    const panel = win.document?.getElementById?.('zotextract-sessions-panel');
                    if (panel) {
                        if (panel.style) panel.style.display = 'none';
                        panel.setAttribute?.('data-ze-open', 'false');
                    }
                    this.librarySessionsCollapsed = true;
                    this.renderLibrarySessionsNav(win);
                } catch (e) {
                    Zotero.logError(e);
                }
            }
            return { dataDir, exportDir };
        },

        legacyPromptPrefValue() {
            try {
                const stored = Zotero.Prefs.get(this.PREFS.prompts, true);
                if (stored) return JSON.parse(stored);
            } catch (e) {
                Zotero.logError(e);
            }
            return null;
        },

        async loadQuestionSets() {
            let existing = null;
            try {
                existing = await this.readJsonData('question-sets.json', null, { throwOnError: true });
            } catch (_) {
                return this.normalizeQuestionSets(this.builtInQuestionSetsFromPresets());
            }
            if (Array.isArray(existing) && existing.length) {
                const normalized = this.normalizeQuestionSets(existing);
                const upgraded = this.upgradeBuiltInQuestionSets(normalized);
                if (JSON.stringify(existing) !== JSON.stringify(upgraded)) {
                    await this.writeJsonData('question-sets.json', upgraded);
                }
                return upgraded;
            }
            const migrated = this.migrateLegacyPromptsToQuestionSets();
            await this.writeJsonData('question-sets.json', migrated);
            return migrated;
        },

        async saveQuestionSets(questionSets) {
            const normalized = this.normalizeQuestionSets(questionSets);
            await this.writeJsonData('question-sets.json', normalized);
            return normalized;
        },

        applyQuestionEditorValues(questionSets, setId, questionId, values = {}) {
            const set = (questionSets || []).find(candidate => String(candidate.id) === String(setId));
            const question = set?.questions?.find(candidate => String(candidate.id) === String(questionId));
            if (!set || !question) return false;
            const currentName = question.name || 'Untitled question';
            const rawName = values.name === undefined ? currentName : String(values.name || '').trim();
            const nextName = this.cleanQuestionName(rawName || currentName || 'Untitled question');
            const nextPrompt = values.prompt === undefined ? (question.prompt || '') : String(values.prompt || '').trim();
            let changed = false;
            if (question.name !== nextName) {
                question.name = nextName;
                changed = true;
            }
            if ((question.prompt || '') !== nextPrompt) {
                question.prompt = nextPrompt;
                changed = true;
            }
            if (changed) {
                const now = this.nowIso();
                question.updatedAt = now;
                set.updatedAt = now;
            }
            return changed;
        },

        applyQuestionSetEditorValues(questionSets, setId, values = {}) {
            const set = (questionSets || []).find(candidate => String(candidate.id) === String(setId));
            if (!set) return false;
            const currentName = set.name || 'Untitled extraction set';
            const rawName = values.name === undefined ? currentName : String(values.name || '').trim();
            const nextName = this.cleanQuestionSetName(rawName || currentName || 'Untitled extraction set');
            const nextDescription = values.description === undefined ? (set.description || '') : String(values.description || '').trim();
            let changed = false;
            if (set.name !== nextName) {
                set.name = nextName;
                changed = true;
            }
            if ((set.description || '') !== nextDescription) {
                set.description = nextDescription;
                changed = true;
            }
            if (changed) set.updatedAt = this.nowIso();
            return changed;
        },

        normalizeQuestionSets(questionSets) {
            return (Array.isArray(questionSets) ? questionSets : []).map(set => ({
                ...set,
                name: this.cleanQuestionSetName(set.name),
                description: String(set.description || '').trim(),
                questions: (set.questions || []).map(question => ({
                    ...question,
                    name: this.cleanQuestionName(question.name),
                    output: question.output || 'json'
                }))
            }));
        },

        builtInQuestionSetsFromPresets() {
            const now = this.nowIso();
            const bySet = new Map();
            for (const prompt of this.defaultPrompts()) {
                if (prompt.context === 'pdf-file') continue;
                const fieldId = prompt.field || 'my-questions';
                if (!bySet.has(fieldId)) {
                    bySet.set(fieldId, {
                        id: fieldId,
                        name: this.promptFieldLabel(fieldId) || 'My Questions',
                        description: '',
                        questions: [],
                        createdAt: now,
                        updatedAt: now
                    });
                }
                bySet.get(fieldId).questions.push({
                    id: prompt.id || this.makeId('question'),
                    name: this.cleanQuestionName(prompt.name || 'Untitled question'),
                    prompt: prompt.prompt || '',
                    output: prompt.output || 'json',
                    createdAt: now,
                    updatedAt: now
                });
            }
            return Array.from(bySet.values());
        },

        oldBuiltInQuestionIds() {
            return new Set([
                'concept-json',
                'summary',
                'methods',
                'limitations',
                'pdf-figures',
                'se-research-design-json',
                'se-artifacts-reproducibility-json',
                'ml-experiment-card-json',
                'ml-reproducibility-risks',
                'ml-dataset-model-facts',
                'hci-study-json',
                'hci-findings-implications',
                'hci-validity-check',
                'security-threat-model-json',
                'security-evaluation-json',
                'privacy-data-flow-review',
                'systems-benchmark-json',
                'systems-reproducibility-json',
                'systems-performance-claim-check',
                'pl-formal-claims-json',
                'pl-tool-evaluation-json',
                'ir-evaluation-json',
                'digital-library-workflow',
                'algorithm-contribution-json',
                'algorithm-proof-sketch'
            ]);
        },

        builtInQuestionIdAliases() {
            return {
                'concept-json': 'research-facts',
                methods: 'methods-data',
                'pdf-figures': 'figures-tables-appendix',
                'se-research-design-json': 'se-research-design',
                'se-artifacts-reproducibility-json': 'se-artifacts-reproducibility',
                'ml-experiment-card-json': 'ml-experiment-card',
                'hci-study-json': 'hci-study-design',
                'security-threat-model-json': 'security-threat-model',
                'security-evaluation-json': 'security-evaluation',
                'systems-benchmark-json': 'systems-benchmark',
                'systems-reproducibility-json': 'systems-reproducibility',
                'pl-formal-claims-json': 'pl-formal-claims',
                'pl-tool-evaluation-json': 'pl-tool-evaluation',
                'ir-evaluation-json': 'ir-evaluation',
                'algorithm-contribution-json': 'algorithm-contribution'
            };
        },

        questionHasOldPromptArtifact(question) {
            const text = `${question?.id || ''}\n${question?.name || ''}\n${question?.prompt || ''}`.toLowerCase();
            return /\bjson\b/.test(text)
                || /return\s+json|json\s+only|strict\s+json|as\s+json|json\s+with|with this shape|hidden chain-of-thought/.test(text);
        },

        upgradeBuiltInQuestionSets(questionSets) {
            const defaults = new Map(this.builtInQuestionSetsFromPresets().map(set => [set.id, set]));
            const oldIds = this.oldBuiltInQuestionIds();
            return (questionSets || []).map(set => {
                const defaultSet = defaults.get(set.id);
                if (!defaultSet) return set;
                const defaultIds = new Set(defaultSet.questions.map(question => question.id));
                const defaultNames = new Set(defaultSet.questions.map(question => this.cleanQuestionName(question.name).toLowerCase()));
                const keepCustom = (set.questions || []).filter(question => {
                    const id = question.id || '';
                    const name = this.cleanQuestionName(question.name).toLowerCase();
                    if (defaultIds.has(id) || oldIds.has(id) || defaultNames.has(name)) return false;
                    return !this.questionHasOldPromptArtifact(question);
                });
                const existingByName = new Map((set.questions || []).map(question => [this.cleanQuestionName(question.name).toLowerCase(), question]));
                const upgradedDefaults = defaultSet.questions.map(defaultQuestion => {
                    const previous = existingByName.get(this.cleanQuestionName(defaultQuestion.name).toLowerCase());
                    return {
                        ...defaultQuestion,
                        createdAt: previous?.createdAt || defaultQuestion.createdAt,
                        updatedAt: this.nowIso()
                    };
                });
                return {
                    ...set,
                    name: defaultSet.name || set.name,
                    questions: [...upgradedDefaults, ...keepCustom],
                    updatedAt: this.nowIso()
                };
            }).filter(set => (set.questions || []).length);
        },

        migrateLegacyPromptsToQuestionSets() {
            const legacyPrompts = this.legacyPromptPrefValue() || [];
            const prompts = [];
            const seenPromptKeys = new Set();
            for (const prompt of [...legacyPrompts, ...this.defaultPrompts()]) {
                const key = prompt.id || `${prompt.field || 'my-questions'}:${prompt.name || ''}:${prompt.prompt || ''}`;
                if (seenPromptKeys.has(key)) continue;
                seenPromptKeys.add(key);
                prompts.push(prompt);
            }
            const now = this.nowIso();
            const bySet = new Map();
            const ensureSet = (fieldId, label, description) => {
                const id = fieldId || 'my-questions';
                if (!bySet.has(id)) {
                    bySet.set(id, {
                        id,
                        name: label || this.promptFieldLabel(fieldId) || 'My Questions',
                        description: description || '',
                        questions: [],
                        createdAt: now,
                        updatedAt: now
                    });
                }
                return bySet.get(id);
            };

            for (const prompt of prompts || []) {
                if (prompt.context === 'pdf-file') continue;
                const fieldId = prompt.field || 'my-questions';
                const set = ensureSet(fieldId, this.promptFieldLabel(fieldId), '');
                set.questions.push({
                    id: prompt.id || this.makeId('question'),
                    name: this.cleanQuestionName(prompt.name || 'Untitled question'),
                    prompt: prompt.prompt || '',
                    output: prompt.output || 'json',
                    createdAt: now,
                    updatedAt: now
                });
            }

            if (!bySet.size) {
                ensureSet('my-questions', 'My Questions', 'Custom ZotExtract questions').questions.push({
                    id: this.makeId('question'),
                    name: 'SUMMARY',
                    prompt: 'Summarize the selected paper with concise evidence from the available Zotero metadata and full text.',
                    createdAt: now,
                    updatedAt: now
                });
            }
            return Array.from(bySet.values()).filter(set => set.questions.length);
        },

        cleanQuestionName(name) {
            return String(name || 'Untitled question')
                .replace(/\s+JSON\b/gi, '')
                .replace(/\bJSON\s+/gi, '')
                .replace(/\s+/g, ' ')
                .trim() || 'Untitled question';
        },

        cleanQuestionSetName(name) {
            return String(name || 'Untitled extraction set')
                .replace(/\s+/g, ' ')
                .trim() || 'Untitled extraction set';
        },

        async loadSessions() {
            const sessions = await this.readJsonData('sessions.json', []);
            if (!Array.isArray(sessions)) return [];
            let changed = false;
            const recovered = sessions.map(session => {
                if (session?.status === 'running') {
                    if (this.activeSessionRuns?.has(session.id)) return session;
                    changed = true;
                    return {
                        ...session,
                        status: 'draft',
                        recoveryNote: 'Recovered from a previous interrupted run.',
                        updatedAt: this.nowIso()
                    };
                }
                if (session?.status === 'needs-review') {
                    changed = true;
                    return {
                        ...session,
                        status: 'completed',
                        updatedAt: this.nowIso()
                    };
                }
                if (session?.status === 'exported') {
                    changed = true;
                    return {
                        ...session,
                        status: 'completed',
                        exportedAt: session.exportedAt || session.updatedAt || this.nowIso(),
                        exportStale: false,
                        updatedAt: this.nowIso()
                    };
                }
                return session;
            });
            if (changed) await this.saveSessions(recovered);
            return recovered;
        },

        async saveSessions(sessions) {
            await this.writeJsonData('sessions.json', sessions);
            return sessions;
        },

        async saveSession(session) {
            const sessions = await this.loadSessions();
            const index = sessions.findIndex(candidate => candidate.id === session.id);
            const normalized = { ...session, updatedAt: this.nowIso() };
            if (normalized.status === 'needs-review') normalized.status = 'completed';
            if (normalized.status === 'exported') {
                normalized.status = 'completed';
                normalized.exportedAt = normalized.exportedAt || normalized.updatedAt;
                normalized.exportStale = false;
            }
            if (index >= 0) sessions[index] = normalized;
            else sessions.unshift(normalized);
            await this.saveSessions(sessions);
            return normalized;
        },

        async getSession(sessionId) {
            const sessions = await this.loadSessions();
            return sessions.find(session => session.id === sessionId) || null;
        },

        async deleteSession(sessionId, window) {
            const sessions = await this.loadSessions();
            const session = sessions.find(candidate => candidate.id === sessionId);
            if (!session) return false;
            const cells = await this.readResultCells(session.id);
            const lines = [
                `Delete ZotExtract session "${session.name}"?`,
                '',
                `This deletes the session record and ${cells.length} result cell${cells.length === 1 ? '' : 's'}.`,
                'Zotero library items and PDFs are not deleted.'
            ];
            if (Services.prompt && typeof Services.prompt.confirm === 'function') {
                const confirmed = Services.prompt.confirm(null, 'Delete ZotExtract session', lines.join('\n'));
                if (!confirmed) return false;
            }
            await this.saveSessions(sessions.filter(candidate => candidate.id !== session.id));
            await this.deleteResultCells(session.id);
            if (this.currentSessionId === session.id) this.currentSessionId = null;
            await this.renderSessionsList(window || this.mainWindow());
            return true;
        },

        async renameSession(sessionId, name, window, options = {}) {
            let session = await this.getSession(sessionId);
            if (!session) return null;
            const cleanName = String(name || '').trim();
            if (!cleanName) return session;
            session = await this.saveSession({ ...session, name: cleanName });
            if (options.render !== false) {
                const targetWindow = window || this.mainWindow();
                if (options.surface === 'workspace') await this.renderSessionWorkspace(session.id, targetWindow);
                else await this.renderSessionsList(targetWindow);
            }
            return session;
        },

        async beginInlineSessionRename(sessionId, window, trigger, options = {}) {
            const session = await this.getSession(sessionId);
            const doc = trigger?.ownerDocument || window?.document;
            if (!session || !doc) return null;
            const host = trigger?.closest?.('[data-ze-session-name-host]');
            const nameNode = host?.querySelector?.('[data-ze-session-name]');
            if (!host || !nameNode) return session;
            const existingInput = host.querySelector?.('[data-ze-inline-session-name]');
            if (existingInput) {
                existingInput.focus?.();
                existingInput.select?.();
                return session;
            }

            const input = typeof doc.createElement === 'function'
                ? doc.createElement('input')
                : doc.createElementNS?.('http://www.w3.org/1999/xhtml', 'input');
            if (!input) return session;
            input.setAttribute('type', 'text');
            input.setAttribute('class', 'ze-inline-name-input');
            input.setAttribute('data-ze-inline-session-name', session.id);
            input.setAttribute('aria-label', 'Session name');
            input.value = session.name || '';

            let finished = false;
            const restore = () => {
                if (input.parentNode && nameNode.parentNode !== input.parentNode) {
                    input.parentNode.replaceChild(nameNode, input);
                }
            };
            const finish = async save => {
                if (finished) return;
                finished = true;
                const nextName = String(input.value || '').trim();
                if (!save || !nextName || nextName === session.name) {
                    restore();
                    return;
                }
                await this.renameSession(session.id, nextName, window, { surface: options.surface || 'list' });
            };
            input.addEventListener?.('click', event => event.stopPropagation());
            input.addEventListener?.('mousedown', event => event.stopPropagation());
            input.addEventListener?.('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(true);
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false);
                }
            });
            input.addEventListener?.('blur', () => finish(true));
            nameNode.parentNode.replaceChild(input, nameNode);
            input.focus?.();
            input.select?.();
            return session;
        },

        regularItems(items) {
            return (items || []).filter(item => item && item.isRegularItem && item.isRegularItem());
        },

        selectedRegularItems() {
            try {
                return this.regularItems(Zotero.getActiveZoteroPane().getSelectedItems());
            } catch (_) {
                return [];
            }
        },

        async selectedCollectionItems() {
            try {
                const pane = Zotero.getActiveZoteroPane();
                const collection = pane.getSelectedCollection?.() || pane.getSelectedCollectionTreeRow?.()?.ref;
                if (!collection) return [];
                let children = [];
                if (typeof collection.getChildItems === 'function') {
                    children = await collection.getChildItems();
                } else if (typeof collection.getChildItemsAsync === 'function') {
                    children = await collection.getChildItemsAsync();
                }
                const items = [];
                for (const child of children || []) {
                    const item = typeof child === 'number'
                        ? (Zotero.Items.get(child) || await Zotero.Items.getAsync?.(child))
                        : child;
                    if (item) items.push(item);
                }
                return this.regularItems(items);
            } catch (e) {
                Zotero.logError(e);
                return [];
            }
        },

        sessionNameForItems(items) {
            const firstTitle = items[0]?.getField ? (items[0].getField('title') || '') : '';
            if (items.length === 1) return firstTitle ? `ZotExtract - ${firstTitle}` : 'ZotExtract session';
            return firstTitle ? `${firstTitle} + ${items.length - 1} more` : `ZotExtract session - ${items.length} papers`;
        },

        async createEmptySession() {
            const now = this.nowIso();
            return this.saveSession({
                id: this.makeId('session'),
                name: 'New ZotExtract session',
                status: 'draft',
                paperItemIds: [],
                questionRefs: [],
                columnWidths: {},
                rowHeights: {},
                createdAt: now,
                updatedAt: now
            });
        },

        async createSessionFromItems(items) {
            const regularItems = this.regularItems(items);
            if (!regularItems.length) {
                Services.prompt.alert(null, 'ZotExtract', 'Select one or more regular Zotero items first.');
                return null;
            }
            const now = this.nowIso();
            const session = {
                id: this.makeId('session'),
                name: this.sessionNameForItems(regularItems),
                status: 'draft',
                paperItemIds: regularItems.map(item => item.id),
                questionRefs: [],
                columnWidths: {},
                rowHeights: {},
                createdAt: now,
                updatedAt: now
            };
            return this.saveSession(session);
        },

        async startSessionFromItems(items) {
            const session = await this.createSessionFromItems(items);
            if (!session) return null;
            this.currentSessionId = session.id;
            await this.openSessionsTab(null, session.id);
            return session;
        },

        async startSessionFromSelectedCollection() {
            const items = await this.selectedCollectionItems();
            return this.startSessionFromItems(items);
        },

        async startEmptySession() {
            const session = await this.createEmptySession();
            this.currentSessionId = session.id;
            await this.openSessionsTab(null, session.id);
            this.maybeShowEmptySessionHint();
            return session;
        },

        async startSessionFromCurrentZoteroSelection() {
            let items = this.selectedRegularItems();
            if (!items.length) items = await this.selectedCollectionItems();
            if (items.length) return this.startSessionFromItems(items);
            return this.startEmptySession();
        },

        async addSelectedItemsToCurrentSession(items) {
            let session = this.currentSessionId ? await this.getSession(this.currentSessionId) : null;
            if (!session) {
                return this.startSessionFromItems(items);
            }
            const regularItems = this.regularItems(items);
            if (!regularItems.length) {
                Services.prompt.alert(null, 'ZotExtract', 'Select one or more regular Zotero items first.');
                return session;
            }
            const ids = new Set(session.paperItemIds || []);
            const beforeSize = ids.size;
            for (const item of regularItems) ids.add(item.id);
            session.paperItemIds = Array.from(ids);
            if (ids.size > beforeSize) this.markSessionHasPendingWork(session);
            session = await this.saveSession(session);
            await this.openSessionsTab(null, session.id);
            return session;
        },

        async addSelectedCollectionToCurrentSession() {
            const items = await this.selectedCollectionItems();
            return this.addSelectedItemsToCurrentSession(items);
        },

        async addQuestionsToSession(sessionId, questionRefs) {
            let session = await this.getSession(sessionId);
            if (!session) return null;
            const existing = new Set((session.questionRefs || []).map(ref => `${ref.questionSetId}:${ref.questionId}`));
            const refs = [...(session.questionRefs || [])];
            const beforeSize = existing.size;
            for (const ref of questionRefs || []) {
                const key = `${ref.questionSetId}:${ref.questionId}`;
                if (existing.has(key)) continue;
                existing.add(key);
                refs.push(ref);
            }
            session.questionRefs = refs;
            if (existing.size > beforeSize) this.markSessionHasPendingWork(session);
            session = await this.saveSession(session);
            await this.renderSessionWorkspace(session.id);
            return session;
        },

        questionDeletionMatchesRef(ref, deleted) {
            return (deleted || []).some(entry => {
                if (String(ref?.questionId) !== String(entry.questionId)) return false;
                return !entry.questionSetId || !ref?.questionSetId || String(ref.questionSetId) === String(entry.questionSetId);
            });
        },

        questionDeletionMatchesCell(cell, deleted) {
            return (deleted || []).some(entry => {
                if (String(cell?.questionId) !== String(entry.questionId)) return false;
                const cellSetId = cell?.questionSnapshot?.questionSetId || cell?.source?.questionSetId || '';
                return !entry.questionSetId || !cellSetId || String(cellSetId) === String(entry.questionSetId);
            });
        },

        async questionDeletionImpact(deletedQuestions) {
            const sessions = await this.loadSessions();
            const impact = { sessions: 0, questionRefs: 0, resultCells: 0 };
            for (const session of sessions) {
                const refs = session.questionRefs || [];
                const removedRefs = refs.filter(ref => this.questionDeletionMatchesRef(ref, deletedQuestions)).length;
                const cells = await this.readResultCells(session.id);
                const removedCells = cells.filter(cell => this.questionDeletionMatchesCell(cell, deletedQuestions)).length;
                if (removedRefs || removedCells) impact.sessions++;
                impact.questionRefs += removedRefs;
                impact.resultCells += removedCells;
            }
            return impact;
        },

        confirmDeleteQuestionLibraryEntry(kind, label, questionCount, impact) {
            const lines = [
                `Delete ${kind} "${label}"?`,
                '',
                `This removes ${questionCount} question${questionCount === 1 ? '' : 's'} from the ZotExtract question library.`
            ];
            if (impact?.questionRefs || impact?.resultCells) {
                lines.push(`It also removes ${impact.questionRefs} session question reference${impact.questionRefs === 1 ? '' : 's'} and ${impact.resultCells} result cell${impact.resultCells === 1 ? '' : 's'} from ${impact.sessions} session${impact.sessions === 1 ? '' : 's'}.`);
            }
            lines.push('Zotero library items and PDFs are not deleted.');
            if (Services.prompt && typeof Services.prompt.confirm === 'function') {
                return Services.prompt.confirm(null, `Delete ${kind}`, lines.join('\n'));
            }
            return true;
        },

        async cleanupDeletedQuestionsFromSessions(deletedQuestions) {
            const sessions = await this.loadSessions();
            const impact = { sessions: 0, questionRefs: 0, resultCells: 0 };
            for (const session of sessions) {
                const refs = session.questionRefs || [];
                const remainingRefs = refs.filter(ref => !this.questionDeletionMatchesRef(ref, deletedQuestions));
                const removedRefs = refs.length - remainingRefs.length;
                const cells = await this.readResultCells(session.id);
                const remainingCells = cells.filter(cell => !this.questionDeletionMatchesCell(cell, deletedQuestions));
                const removedCells = cells.length - remainingCells.length;
                if (!removedRefs && !removedCells) continue;
                session.questionRefs = remainingRefs;
                if (session.rowHeights) {
                    for (const entry of deletedQuestions || []) delete session.rowHeights[entry.questionId];
                }
                session.status = this.statusAfterSessionEdit(session, remainingCells, removedCells > 0);
                this.markSessionExportStale(session);
                await this.writeResultCells(session.id, remainingCells);
                await this.saveSession(session);
                impact.sessions++;
                impact.questionRefs += removedRefs;
                impact.resultCells += removedCells;
            }
            return impact;
        },

        async deleteQuestionSetFromLibrary(setId) {
            const questionSets = await this.loadQuestionSets();
            const set = questionSets.find(candidate => String(candidate.id) === String(setId));
            if (!set) return null;
            const deletedQuestions = (set.questions || []).map(question => ({
                questionSetId: set.id,
                questionId: question.id
            }));
            const impact = await this.questionDeletionImpact(deletedQuestions);
            if (!this.confirmDeleteQuestionLibraryEntry('question set', set.name || set.id, deletedQuestions.length, impact)) return null;
            const remainingSets = questionSets.filter(candidate => String(candidate.id) !== String(set.id));
            const savedSets = await this.saveQuestionSets(remainingSets);
            const cleanup = await this.cleanupDeletedQuestionsFromSessions(deletedQuestions);
            return { questionSets: savedSets, deletedQuestions, impact: cleanup, deletedSet: set };
        },

        async deleteQuestionFromLibrary(setId, questionId) {
            const questionSets = await this.loadQuestionSets();
            const set = questionSets.find(candidate => String(candidate.id) === String(setId));
            const question = set?.questions?.find(candidate => String(candidate.id) === String(questionId));
            if (!set || !question) return null;
            const deletedQuestions = [{ questionSetId: set.id, questionId: question.id }];
            const impact = await this.questionDeletionImpact(deletedQuestions);
            if (!this.confirmDeleteQuestionLibraryEntry('question', question.name || question.id, 1, impact)) return null;
            set.questions = (set.questions || []).filter(candidate => String(candidate.id) !== String(question.id));
            set.updatedAt = this.nowIso();
            const savedSets = await this.saveQuestionSets(questionSets);
            const cleanup = await this.cleanupDeletedQuestionsFromSessions(deletedQuestions);
            return { questionSets: savedSets, deletedQuestions, impact: cleanup, deletedQuestion: question };
        },

        resultCellHasData(cell) {
            if (!cell) return false;
            if (String(cell.answer || '').trim()) return true;
            if (cell.structured && Object.keys(cell.structured || {}).length) return true;
            return ['completed', 'needs-review', 'failed'].includes(cell.status);
        },

        confirmRemoveSessionData(kind, label, affectedCount) {
            if (!affectedCount) return true;
            const lines = [
                `Remove this ${kind} from the ZotExtract session?`,
                '',
                `${affectedCount} extracted result cell${affectedCount === 1 ? '' : 's'} for "${label}" will be removed from this session.`,
                'This does not delete Zotero items or question presets.'
            ];
            if (Services.prompt && typeof Services.prompt.confirm === 'function') {
                return Services.prompt.confirm(null, `Remove ${kind}`, lines.join('\n'));
            }
            return true;
        },

        statusAfterSessionEdit(session, remainingCells, removedData) {
            if (!removedData) return session.status || 'draft';
            if (session.status === 'running') return 'draft';
            return remainingCells.some(cell => this.resultCellHasData(cell)) ? 'completed' : 'draft';
        },

        markSessionHasPendingWork(session) {
            if (!session) return session;
            if (session.status !== 'running') {
                session.status = 'draft';
            }
            if (session.exportedAt) session.exportStale = true;
            return session;
        },

        markSessionExportStale(session) {
            if (session?.exportedAt) session.exportStale = true;
            return session;
        },

        async removePaperFromSession(sessionId, itemId) {
            let session = await this.getSession(sessionId);
            if (!session) return null;
            const paperId = Number(itemId);
            const item = await this.getItemById(paperId);
            const label = item ? this.itemTitle(item) : `item ${paperId}`;
            const cells = await this.readResultCells(session.id);
            const affectedCells = cells.filter(cell => Number(cell.itemId) === paperId && this.resultCellHasData(cell));
            if (!this.confirmRemoveSessionData('paper', label, affectedCells.length)) return session;
            const remainingCells = cells.filter(cell => Number(cell.itemId) !== paperId);
            session.paperItemIds = (session.paperItemIds || []).filter(id => Number(id) !== paperId);
            if (session.columnWidths) {
                delete session.columnWidths[paperId];
                delete session.columnWidths[String(paperId)];
            }
            session.status = this.statusAfterSessionEdit(session, remainingCells, affectedCells.length > 0);
            this.markSessionExportStale(session);
            await this.writeResultCells(session.id, remainingCells);
            session = await this.saveSession(session);
            await this.renderSessionWorkspace(session.id);
            return session;
        },

        async removeQuestionFromSession(sessionId, questionSetId, questionId) {
            let session = await this.getSession(sessionId);
            if (!session) return null;
            const questions = await this.resolveQuestionRefs(session.questionRefs);
            const question = questions.find(candidate => candidate.questionId === questionId && candidate.questionSetId === questionSetId)
                || questions.find(candidate => candidate.questionId === questionId);
            const label = question?.questionName || questionId;
            const cells = await this.readResultCells(session.id);
            const affectedCells = cells.filter(cell => String(cell.questionId) === String(questionId) && this.resultCellHasData(cell));
            if (!this.confirmRemoveSessionData('question', label, affectedCells.length)) return session;
            const remainingCells = cells.filter(cell => String(cell.questionId) !== String(questionId));
            session.questionRefs = (session.questionRefs || []).filter(ref => {
                if (questionSetId) return !(ref.questionSetId === questionSetId && ref.questionId === questionId);
                return ref.questionId !== questionId;
            });
            if (session.rowHeights) delete session.rowHeights[questionId];
            session.status = this.statusAfterSessionEdit(session, remainingCells, affectedCells.length > 0);
            this.markSessionExportStale(session);
            await this.writeResultCells(session.id, remainingCells);
            session = await this.saveSession(session);
            await this.renderSessionWorkspace(session.id);
            return session;
        },

        async resolveQuestionRefs(questionRefs) {
            const sets = await this.loadQuestionSets();
            const aliases = this.builtInQuestionIdAliases();
            const resolved = [];
            for (const ref of questionRefs || []) {
                const set = sets.find(candidate => candidate.id === ref.questionSetId);
                const aliasId = aliases[ref.questionId] || ref.questionId;
                const question = set?.questions?.find(candidate => candidate.id === ref.questionId)
                    || set?.questions?.find(candidate => candidate.id === aliasId);
                if (!question) continue;
                resolved.push({
                    questionSetId: set.id,
                    questionSetName: set.name,
                    questionId: question.id,
                    questionName: question.name,
                    prompt: question.prompt
                });
            }
            return resolved;
        },
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractData);
}
