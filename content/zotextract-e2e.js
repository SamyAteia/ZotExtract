var ZotExtractE2E = {
    async run() {
        const mode = Zotero.Prefs.get('extensions.zotextract.e2e.mode', true) || 'deterministic';
        if (mode === 'gui-lifecycle') {
            return this.runGuiLifecycle();
        }
        return this.runDeterministic();
    },

    async runGuiLifecycle() {
        const artifactDir = Zotero.Prefs.get('extensions.zotextract.e2e.artifactDir', true);
        if (!artifactDir) return;

        const resultPath = PathUtils.join(artifactDir, 'runtime-e2e-result.json');
        const fixturePath = PathUtils.join(artifactDir, 'fixture.pdf');
        const result = {
            ok: false,
            mode: 'gui-lifecycle',
            steps: [],
            errors: []
        };

        try {
            this.lastUiDiagnostics = null;
            const startDelay = Zotero.Prefs.get('extensions.zotextract.e2e.startDelayMs', true) || 1000;
            await this.delay(startDelay);

            const win = await this.waitForMainWindow();
            await this.waitForMenuItem(win);
            result.steps.push('plugin-loaded');
            await this.writeStage(artifactDir, 'plugin-loaded');

            const installTip = await this.waitForInstallTip(win);
            result.installTipText = installTip.textContent || '';
            result.steps.push('provider-setup-tip-visible');
            await this.writeStage(artifactDir, 'provider-tip-visible', {
                text: result.installTipText
            });

            await this.waitForArtifactFile(artifactDir, 'ui-shell-settings-complete.json', 300);
            result.steps.push('settings-completed-through-ui');
            this.applyProviderE2EOverrides();
            result.provider = ZotExtract.getProviderSettings();
            result.questionSets = (await ZotExtract.loadQuestionSets()).map(set => ({ name: set.name, questions: (set.questions || []).length }));
            this.assertGuiSettings(result);

            const items = await this.createFixtureItems(fixturePath);
            result.itemIDs = items.map(item => item.id);
            result.fixturePapers = items.map(item => ({
                itemId: item.id,
                title: item.getField('title'),
                abstract: item.getField('abstractNote')
            }));
            result.steps.push('fixture-items-created');

            const pane = Zotero.getActiveZoteroPane();
            await pane.selectItems([items[0].id]);
            const draftSession = await ZotExtract.createSessionFromItems([items[0]]);
            if (!draftSession) throw new Error('Could not create draft ZotExtract session for screen coverage.');
            result.draftSessionId = draftSession.id;
            await ZotExtract.openSessionsTab(win);
            this.assertSessionsListVisible(win, draftSession.id);
            this.assertSessionsSourceFloatsUnderLibrary(win);
            await this.writeStage(artifactDir, 'sessions-list-visible', { sessionId: draftSession.id });
            await this.waitForArtifactFile(artifactDir, 'ui-shell-sessions-list-captured.json', 120);
            await this.assertSessionsTabToggleCloses(win, artifactDir);
            result.steps.push('sessions-toggle-close-covered');
            await ZotExtract.openSessionsTab(win);
            this.assertSessionsListVisible(win, draftSession.id);

            await ZotExtract.openSessionsTab(win, draftSession.id);
            await this.writeStage(artifactDir, 'empty-session-visible', { sessionId: draftSession.id });
            await this.waitForArtifactFile(artifactDir, 'ui-shell-empty-session-captured.json', 120);
            this.assertEmptySessionVisible(win);
            await this.assertLibraryClickReturnsToZotero(win, artifactDir);
            await this.waitForArtifactFile(artifactDir, 'ui-shell-library-return-captured.json', 120);
            await ZotExtract.openSessionsTab(win, draftSession.id);
            this.assertEmptySessionVisible(win);
            await this.assertCollectionClickReturnsToZotero(win, artifactDir, /(^|\s)papers($|\s)/i);
            await this.waitForArtifactFile(artifactDir, 'ui-shell-papers-return-captured.json', 120);
            result.collectionActions = await this.assertCollectionSessionActions(win, items);
            result.steps.push('collection-session-actions-covered');
            await this.writeStage(artifactDir, 'collection-session-actions-covered', result.collectionActions);
            await this.waitForArtifactFile(artifactDir, 'ui-shell-collection-session-captured.json', 120);
            await pane.collectionsView.selectLibrary(Zotero.Libraries.userLibraryID);
            await ZotExtract.openSessionsTab(win, draftSession.id);
            this.assertEmptySessionVisible(win);

            await this.ensureQuestionPickerOpen(win, draftSession.id);
            await this.writeStage(artifactDir, 'question-picker-visible', { sessionId: draftSession.id });
            await this.waitForArtifactFile(artifactDir, 'ui-shell-question-picker-captured.json', 120);
            this.assertQuestionPickerVisible(win);
            await this.returnFromSubview(win);

            const addPaperCandidate = items[1] || items[0];
            await pane.selectItems([addPaperCandidate.id]);
            await ZotExtract.openSessionsTab(win, draftSession.id);
            await this.ensureAddPapersOpen(win, draftSession.id);
            await this.writeStage(artifactDir, 'add-papers-visible', { sessionId: draftSession.id });
            await this.waitForArtifactFile(artifactDir, 'ui-shell-paper-picker-captured.json', 120);
            this.assertAddPapersVisible(win, draftSession.id);
            ZotExtract.closeSessionsTab(win);
            await this.delay(500);
            result.steps.push('new-session-screens-covered');

            const beforeSingleSessions = (await ZotExtract.loadSessions()).map(session => session.id);
            await pane.selectItems([items[0].id]);
            await this.writeStage(artifactDir, 'single-ready', { itemID: items[0].id });
            const singleSession = this.directSessionStart()
                ? await ZotExtract.createSessionFromItems([items[0]])
                : await this.waitForSessionForItems([items[0].id], beforeSingleSessions);
            result.singleSessionId = singleSession.id;
            await this.addDefaultQuestion(singleSession.id);
            await ZotExtract.openSessionsTab(win, singleSession.id);
            this.assertSessionWorkspaceVisible(win, singleSession.id, { papers: 1, questions: 1 });
            await this.writeStage(artifactDir, 'single-session-opened', { itemID: items[0].id, sessionId: singleSession.id });
            await this.waitForArtifactFile(artifactDir, 'ui-shell-single-session-ready-captured.json', 120);
            await this.runSessionWithoutConfirm(singleSession.id);
            const singleCells = await this.waitForResultCells(singleSession.id, 1);
            result.singleCells = singleCells.map(cell => this.summarizeResultCell(cell));
            result.singleLineSourceDiagnostics = ZotExtract.lastLineSourceMapDiagnostics || null;
            this.assertSessionWorkspaceVisible(win, singleSession.id, { papers: 1, questions: 1, completed: true });
            await this.writeStage(artifactDir, 'single-session-completed', { itemID: items[0].id, sessionId: singleSession.id, cells: singleCells.length });
            result.steps.push('single-session-completed');
            await this.waitForArtifactFile(artifactDir, 'ui-shell-single-session-completed-captured.json', 120);
            await ZotExtract.openEvidenceForSessionCell(singleSession.id, items[0].id, singleCells[0].questionId, null, win);
            await this.delay(350);
            this.assertEvidencePdfOpen(singleCells[0]);
            await this.writeStage(artifactDir, 'evidence-pdf-opened', { sessionId: singleSession.id, itemID: items[0].id, questionId: singleCells[0].questionId });
            await this.waitForArtifactFile(artifactDir, 'ui-shell-evidence-pdf-captured.json', 120);
            result.steps.push('evidence-pdf-covered');
            await this.delay(500);

            const beforeMultiSessions = (await ZotExtract.loadSessions()).map(session => session.id);
            await pane.selectItems(items.map(item => item.id));
            await this.writeStage(artifactDir, 'multi-ready', { itemIDs: items.map(item => item.id) });

            const multiSession = this.directSessionStart()
                ? await ZotExtract.createSessionFromItems(items)
                : await this.waitForSessionForItems(items.map(item => item.id), beforeMultiSessions);
            result.multiSessionId = multiSession.id;
            const overflowQuestionCount = this.e2eMultiQuestionCount();
            await this.addDefaultQuestions(multiSession.id, overflowQuestionCount);
            await ZotExtract.openSessionsTab(win, multiSession.id);
            this.assertSessionWorkspaceVisible(win, multiSession.id, { papers: items.length, questions: overflowQuestionCount, overflow: overflowQuestionCount > 1, scrollToEnd: overflowQuestionCount > 1 });
            await this.writeStage(artifactDir, 'multi-session-opened', { itemIDs: items.map(item => item.id), sessionId: multiSession.id });
            await this.waitForArtifactFile(artifactDir, 'ui-shell-multi-session-ready-captured.json', 120);
            await this.runSessionWithoutConfirm(multiSession.id);
            const multiCells = await this.waitForResultCells(multiSession.id, items.length * overflowQuestionCount);
            result.multiCells = multiCells.map(cell => this.summarizeResultCell(cell));
            result.multiLineSourceDiagnostics = ZotExtract.lastLineSourceMapDiagnostics || null;
            this.assertSessionWorkspaceVisible(win, multiSession.id, { papers: items.length, questions: overflowQuestionCount, completed: true, overflow: overflowQuestionCount > 1, scrollToEnd: overflowQuestionCount > 1 });
            await this.writeStage(artifactDir, 'multi-session-completed', { sessionId: multiSession.id, cells: multiCells.length });
            result.steps.push('multi-session-completed');
            await this.waitForArtifactFile(artifactDir, 'ui-shell-multi-session-completed-captured.json', 120);
            result.provider = ZotExtract.getProviderSettings();

            const exportBundle = await ZotExtract.buildSessionExportBundle(multiSession.id);
            const exportPaths = await ZotExtract.writeExportBundle(exportBundle);
            result.exportPaths = exportPaths;
            result.exportRecordCount = exportBundle.records.length;
            const exportJson = await IOUtils.readUTF8(exportPaths.json);
            const exportCsv = await IOUtils.readUTF8(exportPaths.csv);
            const exportMarkdown = await IOUtils.readUTF8(exportPaths.markdown);
            if (!/"includesRawFullText": false/.test(exportJson) || !/This export omits raw full text/.test(exportMarkdown)) {
                result.errors.push('Export files did not preserve the no-raw-full-text contract.');
            }
            if (!/exportedAt,sessionId,sessionName,zoteroItemId,title,doi,questionId,question,model,status,parsed,answer,reasoning,evidence,warnings,extraFields/.test(exportCsv)) {
                result.errors.push('CSV export did not include the expected session-analysis columns.');
            }
            if (exportBundle.records.length < items.length) {
                result.errors.push(`Expected at least ${items.length} export records, got ${exportBundle.records.length}.`);
            }
            await this.writeStage(artifactDir, 'export-created', exportPaths);
            result.steps.push('export-completed');

            const allAnswers = [...result.singleCells, ...result.multiCells].map(cell => cell.answer || '').join('\n');
            const realProvider = this.realProviderE2E();
            const terminalAnswers = [...result.singleCells, ...result.multiCells]
                .filter(cell => ['completed', 'needs-review'].includes(cell.status) && String(cell.answer || '').trim().length > 0);
            const providerOutputOk = realProvider
                ? terminalAnswers.length >= 3
                : /Fake Method|Fake summary from local test server|Zotero workflow integration|deterministic fake LLM response/.test(allAnswers);
            if (realProvider && !(Number(result.provider?.contextWindowTokens || 0) > 0)) {
                result.errors.push('Real-provider run did not detect or persist a usable context window.');
            }
            const itemContextExportAbsent = !win.document.getElementById('zotero-itemmenu-zotextract-export');
            if (!providerOutputOk || !itemContextExportAbsent) {
                result.errors.push(realProvider
                    ? 'Expected non-empty completed or reviewable real-provider session result cells and no item-context export command.'
                    : 'Expected session result cells with deterministic fake provider output and no item-context export command.');
            }
            result.ok = providerOutputOk
                && itemContextExportAbsent
                && result.errors.length === 0;
        } catch (e) {
            if (this.lastUiDiagnostics) {
                result.lastUiDiagnostics = this.lastUiDiagnostics;
                try {
                    await this.writeStage(artifactDir, 'failure-diagnostics', this.lastUiDiagnostics);
                } catch (_) {}
            }
            const message = e && e.message ? e.message : String(e);
            const stack = e && e.stack ? e.stack : '';
            result.errors.push(stack && !stack.includes(message) ? `${message}\n${stack}` : (stack || message));
        }

        await IOUtils.writeUTF8(resultPath, JSON.stringify(result, null, 2));
    },

    async runDeterministic() {
        const artifactDir = Zotero.Prefs.get('extensions.zotextract.e2e.artifactDir', true);
        if (!artifactDir) return;

        const resultPath = PathUtils.join(artifactDir, 'runtime-e2e-result.json');
        const fixturePath = PathUtils.join(artifactDir, 'fixture.pdf');
        const result = {
            ok: false,
            mode: 'deterministic',
            steps: [],
            errors: []
        };

        try {
            const startDelay = Zotero.Prefs.get('extensions.zotextract.e2e.startDelayMs', true) || 3000;
            await this.delay(startDelay);
            result.steps.push('startup');

            const win = await this.waitForMainWindow();
            await this.waitForMenuItem(win);
            result.steps.push('zotextract-menu-registered');

            const item = await this.createFixtureItem(fixturePath, 'Docker Fixture Paper');
            result.itemID = item.id;
            result.steps.push('fixture-item-created');

            await Zotero.getActiveZoteroPane().selectItem(item.id);
            result.steps.push('fixture-item-selected');
            await this.writeStage(artifactDir, 'main-ready', { itemID: item.id });
            await this.delay(8000);

            await this.openPreferencesPane();
            result.steps.push('preferences-opened');
            await this.writeStage(artifactDir, 'preferences-opened', { pane: 'zotextract-prefpane' });
            await this.delay(8000);
            await this.closePreferencesPane();
            await this.focusMainWindow();
            await Zotero.getActiveZoteroPane().selectItem(item.id);
            await this.writeStage(artifactDir, 'runtime-ready', { itemID: item.id });
            await this.delay(3000);

            const originalConfirm = ZotExtract.confirmSessionEstimate;
            ZotExtract.confirmSessionEstimate = () => true;
            let runResult;
            try {
                const session = await ZotExtract.startSessionFromItems([item]);
                await this.addDefaultQuestion(session.id);
                runResult = await ZotExtract.runSession(session.id);
            } finally {
                ZotExtract.confirmSessionEstimate = originalConfirm;
            }
            result.steps.push('zotextract-action-completed');

            const sessionId = runResult?.session?.id || ZotExtract.currentSessionId;
            const cells = await this.waitForResultCells(sessionId, 1);
            const bundle = await ZotExtract.buildSessionExportBundle(sessionId);
            result.sessionId = sessionId;
            result.cells = cells.map(cell => this.summarizeResultCell(cell));
            result.exportRecordCount = bundle.records.length;
            result.ok = cells.some(cell => /Fake Method|Fake summary from local test server/.test(cell.answer || ''));
            await this.writeStage(artifactDir, 'session-completed', { itemID: item.id, sessionId, cells: cells.length });
            if (!result.ok) {
                result.errors.push('Session result cell did not contain the deterministic fake provider response.');
            }
        } catch (e) {
            result.errors.push(e && e.stack ? e.stack : String(e));
        }

        await IOUtils.writeUTF8(resultPath, JSON.stringify(result, null, 2));
    },

    summarizeResultCell(cell) {
        const sourceMap = cell.lineSourceMap || {};
        return {
            itemId: cell.itemId,
            questionId: cell.questionId,
            status: cell.status,
            answer: cell.answer,
            lineSourceMap: {
                source: sourceMap.source || null,
                hasCoordinates: !!sourceMap.hasCoordinates,
                records: sourceMap.records?.length || 0,
                firstLine: sourceMap.records?.[0]
                    ? {
                        id: sourceMap.records[0].id,
                        page: sourceMap.records[0].page || null,
                        rects: sourceMap.records[0].rects?.length || 0,
                        text: sourceMap.records[0].text || ''
                    }
                    : null
            }
        };
    },

    expectedE2EPref(name, fallback) {
        const value = Zotero.Prefs.get(`extensions.zotextract.e2e.${name}`, true);
        return value === undefined || value === null || value === '' ? fallback : value;
    },

    realProviderE2E() {
        return Zotero.Prefs.get('extensions.zotextract.e2e.realProvider', true) === true;
    },

    directSessionStart() {
        return Zotero.Prefs.get('extensions.zotextract.e2e.directSessionStart', true) === true;
    },

    e2eMultiQuestionCount() {
        const value = Number(Zotero.Prefs.get('extensions.zotextract.e2e.multiQuestionCount', true) || 12);
        if (!Number.isFinite(value) || value < 1) return 12;
        return Math.max(1, Math.floor(value));
    },

    applyProviderE2EOverrides() {
        const provider = ZotExtract.getProviderSettings();
        provider.name = this.expectedE2EPref('expectedProviderName', provider.name || 'Docker GUI Provider');
        provider.baseUrl = this.expectedE2EPref('expectedProviderBaseUrl', provider.baseUrl || 'http://127.0.0.1:8789/v1');
        provider.model = this.expectedE2EPref('expectedProviderModel', provider.model || 'fake-model');
        provider.apiKey = this.expectedE2EPref('expectedProviderApiKey', provider.apiKey || 'test-docker-key');
        provider.systemPrompt = this.expectedE2EPref('expectedProviderSystemPrompt', provider.systemPrompt || 'Docker GUI system prompt');
        provider.timeoutSeconds = Number(this.expectedE2EPref('expectedProviderTimeoutSeconds', provider.timeoutSeconds || 120));
        provider.contextWindowTokens = Number(provider.contextWindowTokens || 8000);
        provider.maxContextWindowTokens = Number(provider.maxContextWindowTokens || provider.contextWindowTokens || 8000);
        provider.contextWindowSource = provider.contextWindowSource || 'Docker GUI E2E provider override';
        const reasoningEffort = this.expectedE2EPref('providerReasoningEffort', '');
        if (reasoningEffort) provider.reasoningEffort = reasoningEffort;
        ZotExtract.saveProviderSettings(provider);
        try {
            Zotero.Prefs.set('extensions.zotextract.providerSetupTipShown', true, true);
            ZotExtract.mainWindow?.()?.document?.getElementById('zotextract-install-tip')?.remove();
        } catch (_) {}
    },

    assertGuiSettings(result) {
        const provider = result.provider || {};
        const expectedName = this.expectedE2EPref('expectedProviderName', 'Docker GUI Provider');
        const expectedBaseUrl = this.expectedE2EPref('expectedProviderBaseUrl', 'http://127.0.0.1:8789/v1');
        const expectedReasoningEffort = this.expectedE2EPref('providerReasoningEffort', '');
        if (provider.name !== expectedName) {
            throw new Error(`Provider name was not configured through the UI. Got: ${provider.name}`);
        }
        if (provider.baseUrl !== expectedBaseUrl) {
            throw new Error(`Provider base URL mismatch. Got: ${provider.baseUrl}`);
        }
        if (expectedReasoningEffort && provider.reasoningEffort !== expectedReasoningEffort) {
            throw new Error(`Reasoning effort mismatch. Got: ${provider.reasoningEffort}`);
        }
        if (provider.maxTextCharacters !== 400000) {
            throw new Error(`Full-text character cap mismatch. Expected 400000, got: ${provider.maxTextCharacters}`);
        }
        if (!Array.isArray(result.questionSets) || !result.questionSets.some(set => set.questions > 0)) {
            throw new Error('No ZotExtract question sets were available after migration/default load.');
        }
    },

    assertSessionsListVisible(win, sessionId) {
        const panel = win.document.getElementById('zotextract-sessions-panel');
        const nav = win.document.getElementById('zotextract-library-section');
        const text = panel?.textContent || '';
        this.assertText(text, [
            /ZotExtract Sessions/i,
            /Session list/i,
            /Session Details/i
        ], 'ZotExtract Sessions list');
        this.assertText(nav?.textContent || '', [
            /My ZotExtract Sessions/i,
            /All sessions/i,
            /Drafts/i,
            /Completed/i
        ], 'ZotExtract left library sessions entry');
        if (!panel.querySelector(`[data-ze-session-row="${sessionId}"]`)) {
            throw new Error(`ZotExtract Sessions list did not include draft session ${sessionId}.`);
        }
        const row = panel.querySelector(`[data-ze-session-row="${sessionId}"]`);
        row.click();
        const selectedRow = panel.querySelector(`[data-ze-session-row="${sessionId}"]`);
        if (!selectedRow?.classList?.contains('selected')) {
            throw new Error('Clicking a ZotExtract session row did not visibly select it.');
        }
    },

    assertSessionsSourceFloatsUnderLibrary(win) {
        const nav = win.document.getElementById('zotextract-library-section');
        const anchorRect = ZotExtract.librarySessionsAnchorRect?.(win);
        const navRect = nav?.getBoundingClientRect?.();
        if (!nav || !anchorRect || !navRect) {
            throw new Error('Could not inspect ZotExtract left-library placement.');
        }
        const distance = Math.abs(navRect.top - anchorRect.bottom);
        if (distance > 16) {
            throw new Error(`ZotExtract sessions source is not floating under My Library rows. Distance: ${distance}px.`);
        }
    },

    async assertLibraryClickReturnsToZotero(win, artifactDir) {
        return this.assertTreeRowClickReturnsToZotero(
            win,
            artifactDir,
            /(^|\s)My Library($|\s)/i,
            'library-click-return-covered',
            'Zotero My Library'
        );
    },

    async assertCollectionClickReturnsToZotero(win, artifactDir, pattern) {
        return this.assertTreeRowClickReturnsToZotero(
            win,
            artifactDir,
            pattern,
            'papers-click-return-covered',
            'Zotero papers collection'
        );
    },

    async assertTreeRowClickReturnsToZotero(win, artifactDir, pattern, stageName, label) {
        const panel = win.document.getElementById('zotextract-sessions-panel');
        const nav = win.document.getElementById('zotextract-library-section');
        const row = this.findCollectionTreeRow(win, pattern);
        if (!panel || !nav || !row) {
            throw new Error(`Could not find the ${label} row for return-navigation coverage.`);
        }
        if (panel.style.display === 'none' || panel.getAttribute('data-ze-open') !== 'true') {
            throw new Error(`ZotExtract Sessions panel was not open before ${label} return assertion.`);
        }
        row.click();
        await this.delay(350);
        if (panel.style.display !== 'none' || panel.getAttribute('data-ze-open') === 'true') {
            this.lastUiDiagnostics = this.describePanel(panel, `${stageName}-did-not-close-sessions`);
            throw new Error(`Clicking ${label} did not return from ZotExtract Sessions to the normal library view.`);
        }
        if (nav.getAttribute('data-ze-collapsed') !== 'true') {
            throw new Error('ZotExtract Sessions source did not collapse after returning to Zotero library view.');
        }
        await this.writeStage(artifactDir, stageName);
    },

    findMyLibraryRow(win) {
        return this.findCollectionTreeRow(win, /(^|\s)My Library($|\s)/i);
    },

    findCollectionTreeRow(win, pattern) {
        const tree = ZotExtract.collectionTreeElement?.(win) || win.document.querySelector('#zotero-collections-tree, #collections-tree, [id*="collections-tree"]');
        if (!tree) return null;
        const rows = Array.from(tree.querySelectorAll?.('.row, [role="row"]') || []);
        const normalize = row => String(row.textContent || '').replace(/\s+/g, ' ').trim();
        return rows.find(row => pattern.test(normalize(row))) || null;
    },

    async assertSessionsTabToggleCloses(win, artifactDir) {
        const tabbar = win.document.getElementById('zotextract-main-tabbar');
        if (tabbar) {
            throw new Error('Obsolete ZotExtract top tabbar is still installed.');
        }
        const panel = win.document.getElementById('zotextract-sessions-panel');
        const nav = win.document.getElementById('zotextract-library-section');
        const sessionsRoot = nav?.querySelector('[data-ze-sessions-root]');
        if (!sessionsRoot || !panel) {
            throw new Error('ZotExtract left library sessions entry was not installed.');
        }
        if (!/My ZotExtract Sessions/i.test(nav.textContent || '') || !/Drafts/i.test(nav.textContent || '')) {
            throw new Error('ZotExtract left library sessions entry did not render the collapsible session filters.');
        }
        if (panel.style.display === 'none' || panel.getAttribute('data-ze-open') !== 'true') {
            throw new Error('ZotExtract Sessions panel was not open before left-entry close assertion.');
        }
        sessionsRoot.click();
        await this.delay(250);
        if (panel.style.display !== 'none' || panel.getAttribute('data-ze-open') === 'true') {
            this.lastUiDiagnostics = this.describePanel(panel, 'sessions-left-entry-did-not-close');
            throw new Error('Clicking the My ZotExtract Sessions entry did not close the Sessions view.');
        }
        await this.writeStage(artifactDir, 'sessions-toggle-close-covered');
    },

    assertEmptySessionVisible(win) {
        const panel = win.document.getElementById('zotextract-sessions-panel');
        const text = panel?.textContent || '';
        this.assertText(text, [
            /ZotExtract Session/i,
            /Extraction grid/i,
            /Rows are questions/i,
            /Columns are papers/i,
            /Title/i,
            /Context size/i,
            /Add extractions/i
        ], 'empty ZotExtract session workspace');
        if (/Full text:|Context:\s*[\d.]+\s*tokens|Request in:|Max out:|Usable:|Budget:|Text cap:|Lines:/i.test(text)) {
            throw new Error('Empty ZotExtract session rendered verbose context diagnostics.');
        }
        const buttons = Array.from(panel.querySelectorAll?.('button') || []);
        const hasPickerControl = panel.querySelector('[data-ze-inline-pick]')
            || panel.querySelector('[data-ze-pick-questions]')
            || buttons.some(button => /Add extractions/i.test(button.textContent || ''));
        if (!hasPickerControl) {
            this.lastUiDiagnostics = this.describePanel(panel, 'empty-session-missing-picker-control');
            throw new Error(`Empty ZotExtract session did not render an Add extractions control. Buttons: ${buttons.map(button => (button.textContent || '').trim()).join(' | ')}`);
        }
    },

    assertSessionWorkspaceVisible(win, sessionId, expected = {}) {
        const panel = win.document.getElementById('zotextract-sessions-panel');
        if (!panel || panel.style.display === 'none' || panel.getAttribute('data-ze-open') !== 'true') {
            throw new Error(`ZotExtract session workspace ${sessionId} is not visibly open.`);
        }
        const selectedTab = win.Zotero_Tabs?.selectedID;
        if (selectedTab && selectedTab !== 'zotero-pane') {
            throw new Error(`ZotExtract session workspace opened while Zotero tab ${selectedTab} was active instead of the library tab.`);
        }
        const panelRect = panel.getBoundingClientRect?.();
        const contentRect = ZotExtract.zoteroContentPaneRect?.(win);
        if (panelRect && contentRect && Math.abs(panelRect.top - contentRect.top) > 3) {
            throw new Error(`ZotExtract session panel top is not aligned with Zotero content pane. Panel top ${panelRect.top}, content top ${contentRect.top}.`);
        }
        const text = panel.textContent || '';
        this.assertText(text, [
            /ZotExtract Session/i,
            /Extraction grid/i,
            /Rows are questions/i,
            /Columns are papers/i,
            /Title/i,
            /Context size/i
        ], 'ZotExtract session workspace');
        if (/Full text:|Context:\s*[\d.]+\s*tokens|Request in:|Max out:|Usable:|Budget:|Text cap:|Lines:/i.test(text)) {
            throw new Error('ZotExtract session workspace rendered verbose context diagnostics.');
        }
        if (expected.papers && !new RegExp(`${expected.papers}\\s+paper`, 'i').test(text)) {
            throw new Error(`ZotExtract session workspace did not show ${expected.papers} paper count.`);
        }
        if (expected.questions && !new RegExp(`${expected.questions}\\s+question`, 'i').test(text)) {
            throw new Error(`ZotExtract session workspace did not show ${expected.questions} question count.`);
        }
        if (expected.overflow) {
            const wrap = panel.querySelector('.ze-matrix-wrap');
            if (!wrap) throw new Error('ZotExtract session workspace did not render a matrix scroll viewport.');
            const styles = win.getComputedStyle ? win.getComputedStyle(wrap) : null;
            if (styles && !/(auto|scroll)/i.test(styles.overflowX || '')) {
                throw new Error(`ZotExtract matrix did not enable horizontal scrolling. overflow-x=${styles.overflowX}.`);
            }
            if (wrap.scrollHeight <= wrap.clientHeight + 4) {
                throw new Error(`ZotExtract matrix did not vertically overflow. scrollHeight=${wrap.scrollHeight}, clientHeight=${wrap.clientHeight}.`);
            }
            if (!panel.querySelector('.ze-cell [data-ze-col]') || !panel.querySelector('.ze-cell [data-ze-row]')) {
                throw new Error('ZotExtract matrix resize handles were not available inside body cells.');
            }
            if (expected.scrollToEnd) {
                wrap.scrollLeft = wrap.scrollWidth;
                wrap.scrollTop = Math.min(wrap.scrollHeight, Math.max(0, wrap.scrollTop + 180));
            }
        }
        if (expected.completed) {
            const previewText = Array.from(panel.querySelectorAll('.ze-result-preview'))
                .map(node => node.textContent || '')
                .join('\n');
            if (/"reasoning"\s*:|\breasoning\s*:|"relevant_context"\s*:|\brelevant_context\s*:|\bevidence:\s|\bquote:\s/i.test(previewText)) {
                throw new Error('Completed ZotExtract matrix leaked reasoning/evidence fields into the final-answer preview.');
            }
            if (!panel.querySelector('.ze-result-evidence')) {
                throw new Error('Completed ZotExtract matrix did not expose a collapsed evidence/reasoning disclosure.');
            }
            const evidenceButtons = Array.from(panel.querySelectorAll('[data-ze-open-evidence]'));
            if (!evidenceButtons.length) {
                throw new Error('Completed ZotExtract matrix did not expose a PDF evidence action.');
            }
            const visibleEvidenceButton = evidenceButtons.find(button => this.elementVisibleInPanel(button, panel));
            if (!visibleEvidenceButton) {
                this.lastUiDiagnostics = this.describePanel(panel, 'completed-matrix-evidence-action-not-visible');
                throw new Error('Completed ZotExtract matrix did not expose a visible PDF evidence action in the current scroll viewport.');
            }
        }
    },

    assertQuestionPickerVisible(win) {
        let modal = this.activeSubview(win);
        const text = modal?.textContent || '';
        this.assertText(text, [
            /Add extractions/i
        ], 'Add extractions view');
        if (!modal.querySelector('[data-ze-set], [data-ze-new-set-row]')) {
            if (modal.querySelector('[data-ze-inline-pick], [data-ze-pick-questions]')) {
                return;
            }
            throw new Error('Add extractions view did not render a clickable question-set row.');
        }
        if (!modal.querySelector('[data-ze-question-name]') || !modal.querySelector('[data-ze-question-prompt]')) {
            this.lastUiDiagnostics = this.describePanel(modal, 'question-picker-missing-edit-fields');
            throw new Error('Add extractions view did not render the simplified question edit form.');
        }
        this.assertElementVisibleInPanel(modal.querySelector('[data-ze-add]'), modal, 'Add extractions add CTA');
        const questionRow = modal.querySelector('[data-ze-question]');
        const questionId = questionRow?.getAttribute('data-ze-question');
        if (!questionRow || !questionId) {
            throw new Error('Add extractions view did not render a clickable question row.');
        }
        questionRow.click();
        modal = this.activeSubview(win);
        const selectedQuestionRow = modal?.querySelector(`[data-ze-question="${questionId}"]`);
        if (!selectedQuestionRow?.querySelector('.ze-check.checked')) {
            this.lastUiDiagnostics = this.describePanel(modal, 'question-row-click-did-not-check-question');
            throw new Error('Clicking a question row did not check/select that question.');
        }
    },

    async ensureQuestionPickerOpen(win, sessionId) {
        const hasQuestionPicker = () => !!this.activeSubview(win)?.querySelector?.('[data-ze-question-name], [data-ze-new-set-row]');
        if (hasQuestionPicker()) return;
        await ZotExtract.openQuestionPicker(sessionId, win);
        for (let i = 0; i < 30; i++) {
            if (hasQuestionPicker()) return;
            await this.delay(100);
        }
        const panel = this.activeSubview(win);
        panel?.querySelector('[data-ze-inline-pick], [data-ze-pick-questions]')?.click();
        for (let i = 0; i < 30; i++) {
            if (hasQuestionPicker()) return;
            await this.delay(100);
        }
    },

    assertAddPapersVisible(win, sessionId) {
        const panel = win.document.getElementById('zotextract-sessions-panel');
        if (panel?.getAttribute?.('data-ze-open') === 'true' && panel.style.display !== 'none') {
            throw new Error('Add papers did not return from the ZotExtract session workspace to the Zotero library.');
        }
        if (sessionId && ZotExtract.currentSessionId !== sessionId) {
            throw new Error('Add papers did not keep the draft ZotExtract session active for library selection.');
        }
        const tip = win.document.getElementById('zotextract-shortcut-tip');
        const text = tip?.textContent || '';
        this.assertText(text, [
            /Add papers to this session/i,
            /ZotExtract add-to-session action/i
        ], 'Add papers library hint');
    },

    async ensureAddPapersOpen(win, sessionId) {
        const hasAddPapers = () => {
            const panel = win.document.getElementById('zotextract-sessions-panel');
            const tip = win.document.getElementById('zotextract-shortcut-tip');
            return (!panel || panel.getAttribute('data-ze-open') !== 'true' || panel.style.display === 'none')
                && (!sessionId || ZotExtract.currentSessionId === sessionId)
                && /Add papers to this session/i.test(tip?.textContent || '');
        };
        if (hasAddPapers()) return;
        const panel = this.activeSubview(win);
        panel?.querySelector('[data-ze-add-papers], [data-ze-inline-papers]')?.click();
        for (let i = 0; i < 30; i++) {
            if (hasAddPapers()) return;
            await this.delay(100);
        }
        if (sessionId) {
            await ZotExtract.returnToLibraryForPaperSelection(sessionId, win);
            for (let i = 0; i < 30; i++) {
                if (hasAddPapers()) return;
                await this.delay(100);
            }
        }
    },

    assertEvidencePdfOpen(cell) {
        const attachmentId = Number(cell?.source?.attachmentId || 0);
        const readers = Zotero.Reader?._readers || [];
        if (!attachmentId || !readers.some(reader => Number(reader.itemID) === attachmentId)) {
            throw new Error(`Evidence action did not open the Zotero PDF reader for attachment ${attachmentId || 'unknown'}.`);
        }
        const evidence = cell?.structured?.evidence || ZotExtract.extractRelevantContextEntries(cell?.structured?.extraction || {});
        if (!evidence.some(entry => /L\d{6}/.test(entry?.lines || ''))) {
            throw new Error('Evidence action opened the PDF reader, but the cell did not retain cited line evidence.');
        }
        if (!cell?.lineSourceMap?.hasCoordinates) return;
        const location = ZotExtract.buildEvidencePdfLocation(cell);
        if (!location?.position?.rects?.length) {
            throw new Error('Evidence action did not build a PDF rectangle location from cited line ranges.');
        }
    },

    activeSubview(win) {
        return win.document.querySelector('#zotextract-sessions-panel');
    },

    assertElementVisibleInPanel(element, panel, label) {
        if (!element || !panel?.getBoundingClientRect || !element.getBoundingClientRect) {
            throw new Error(`${label} was not rendered.`);
        }
        if (!this.elementVisibleInPanel(element, panel)) {
            this.lastUiDiagnostics = this.describePanel(panel, `${label}-not-visible`);
            throw new Error(`${label} was rendered outside the visible ZotExtract panel.`);
        }
    },

    elementVisibleInPanel(element, panel) {
        if (!element || !panel?.getBoundingClientRect || !element.getBoundingClientRect) {
            return false;
        }
        const rect = element.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        return rect.width > 0
            && rect.height > 0
            && rect.bottom <= panelRect.bottom
            && rect.right <= panelRect.right
            && rect.top >= panelRect.top
            && rect.left >= panelRect.left;
    },

    async returnFromSubview(win) {
        const panel = this.activeSubview(win);
        panel?.querySelector('[data-ze-back-to-session]')?.click();
        await this.delay(200);
    },

    assertText(text, patterns, label) {
        for (const pattern of patterns) {
            if (!pattern.test(text || '')) {
                throw new Error(`${label} was missing expected text: ${pattern}`);
            }
        }
    },

    describePanel(panel, label) {
        const elements = Array.from(panel.querySelectorAll?.('*') || []).slice(0, 80).map(element => ({
            localName: element.localName || '',
            tagName: element.tagName || '',
            text: (element.textContent || '').trim().slice(0, 80),
            attributes: Array.from(element.attributes || []).map(attribute => `${attribute.name}=${attribute.value}`).slice(0, 12)
        }));
        return {
            label,
            text: (panel.textContent || '').slice(0, 2000),
            html: (panel.innerHTML || '').slice(0, 5000),
            elements
        };
    },

    async createFixtureItems(fixturePath) {
        const manifestPath = Zotero.Prefs.get('extensions.zotextract.e2e.fixtureManifest', true);
        if (manifestPath) {
            const items = await this.createFixtureItemsFromManifest(manifestPath);
            await this.ensurePapersCollection(items);
            return items;
        }
        const items = [];
        for (let index = 1; index <= 8; index++) {
            items.push(await this.createFixtureItem(fixturePath, `GUI Fixture Paper ${index}`));
        }
        await this.ensurePapersCollection(items);
        return items;
    },

    async assertCollectionSessionActions(win, items) {
        const pane = Zotero.getActiveZoteroPane();
        const firstItems = items.slice(0, 2);
        const secondItems = items.slice(1, 3);
        const expectedIDs = [...new Set([...firstItems, ...secondItems].map(item => item.id))];
        const first = await this.ensurePapersCollection(firstItems, 'Collection action A');
        const second = await this.ensurePapersCollection(secondItems, 'Collection action B');
        const startMenu = win.document.getElementById('zotero-collectionmenu-zotextract-start');
        const addMenu = win.document.getElementById('zotero-collectionmenu-zotextract-add');
        if (!startMenu || !addMenu) throw new Error('ZotExtract collection menu actions are missing.');

        const checkPapers = (session, expected) => {
            const ids = session.paperItemIds || [];
            if (ids.length !== expected.length || expected.some(id => !ids.includes(id))) {
                throw new Error(`Collection action returned papers ${ids}, expected ${expected}.`);
            }
        };
        ZotExtract.closeSessionsTab(win);
        await pane.collectionsView.selectCollection(first.id);
        const beforeSingle = (await ZotExtract.loadSessions()).map(session => session.id);
        startMenu.doCommand();
        const single = await this.waitForSessionForItems(firstItems.map(item => item.id), beforeSingle);
        checkPapers(single, firstItems.map(item => item.id));
        const checks = { singleCollection: true, addCollection: false, multipleCollections: null };

        ZotExtract.closeSessionsTab(win);
        await pane.collectionsView.selectCollection(second.id);
        addMenu.doCommand();
        let added;
        for (let i = 0; i < 60; i++) {
            added = await ZotExtract.getSession(single.id);
            if (expectedIDs.every(id => added.paperItemIds.includes(id))) break;
            await this.delay(250);
        }
        checkPapers(added, expectedIDs);
        checks.addCollection = true;

        if (typeof pane.getSelectedCollections === 'function') {
            ZotExtract.closeSessionsTab(win);
            await pane.collectionsView.selectCollection(first.id);
            const secondIndex = pane.collectionsView.getRowIndexByID(`C${second.id}`);
            if (secondIndex === false) throw new Error('Second collection is missing from the collection tree.');
            pane.collectionsView.selection.toggleSelect(secondIndex);
            await this.delay(500);
            if (pane.getSelectedCollections().length !== 2) throw new Error('Could not select two collections in Zotero.');
            const beforeMulti = (await ZotExtract.loadSessions()).map(session => session.id);
            startMenu.doCommand();
            const multi = await this.waitForSessionForItems(expectedIDs, beforeMulti);
            checkPapers(multi, expectedIDs);
            checks.multipleCollections = true;
            checks.multiSessionId = multi.id;
        }
        checks.paperItemIDs = expectedIDs;
        return checks;
    },

    async ensurePapersCollection(items, name = 'papers') {
        try {
            if (!Zotero.Collection || !items?.length) return null;
            const collection = new Zotero.Collection();
            collection.libraryID = Zotero.Libraries.userLibraryID;
            collection.name = name;
            await collection.saveTx();
            const itemIDs = items.map(item => item.id).filter(Boolean);
            if (Zotero.DB?.executeTransaction && typeof collection.addItems === 'function') {
                await Zotero.DB.executeTransaction(async () => {
                    await collection.addItems(itemIDs);
                });
            } else if (typeof collection.addItem === 'function') {
                for (const itemID of itemIDs) {
                    await collection.addItem(itemID);
                }
            }
            return collection;
        } catch (e) {
            Zotero.logError(e);
            throw new Error(`Could not create Zotero papers collection fixture: ${e.message || e}`);
        }
    },

    async createFixtureItemsFromManifest(manifestPath) {
        const raw = await IOUtils.readUTF8(manifestPath);
        const manifest = JSON.parse(raw);
        const fixtures = Array.isArray(manifest) ? manifest : manifest.papers;
        if (!Array.isArray(fixtures) || !fixtures.length) {
            throw new Error(`Fixture manifest did not contain papers: ${manifestPath}`);
        }
        const items = [];
        for (const fixture of fixtures) {
            items.push(await this.createManifestFixtureItem(fixture));
        }
        return items;
    },

    async createManifestFixtureItem(fixture) {
        if (!fixture.pdfPath) throw new Error(`Fixture is missing pdfPath: ${JSON.stringify(fixture)}`);
        const item = new Zotero.Item('journalArticle');
        item.libraryID = Zotero.Libraries.userLibraryID;
        this.safeSetField(item, 'title', fixture.title || fixture.shortTitle || fixture.arxivId || 'arXiv fixture paper');
        this.safeSetField(item, 'abstractNote', fixture.abstract || '');
        this.safeSetField(item, 'url', fixture.url || (fixture.arxivId ? `https://arxiv.org/abs/${fixture.arxivId}` : ''));
        this.safeSetField(item, 'date', fixture.year || '');
        if (fixture.arxivId) {
            this.safeSetField(item, 'extra', `arXiv: ${fixture.arxivId}`);
        }
        await item.saveTx();

        const attachment = await Zotero.Attachments.importFromFile({
            file: fixture.pdfPath,
            parentItemID: item.id,
            title: fixture.pdfTitle || `${this.safeFilename(fixture.title || fixture.arxivId || 'arxiv-paper')}.pdf`,
            contentType: 'application/pdf'
        });

        if (fixture.textPath) {
            const storageDir = Zotero.Attachments.getStorageDirectory(attachment);
            const text = await IOUtils.readUTF8(fixture.textPath);
            await IOUtils.writeUTF8(PathUtils.join(storageDir.path, '.zotero-ft-cache'), text);
        }
        return item;
    },

    safeSetField(item, field, value) {
        if (!value) return;
        try {
            item.setField(field, value);
        } catch (e) {
            Zotero.debug(`[ZotExtract E2E] Could not set field ${field}: ${e.message}`);
        }
    },

    safeFilename(value) {
        return String(value || 'paper').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'paper';
    },

    async createFixtureItem(fixturePath, titleSuffix) {
        const item = new Zotero.Item('journalArticle');
        item.libraryID = Zotero.Libraries.userLibraryID;
        item.setField('title', `ZotExtract ${titleSuffix}`);
        await item.saveTx();

        const attachment = await Zotero.Attachments.importFromFile({
            file: fixturePath,
            parentItemID: item.id,
            title: `zotextract-${titleSuffix.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
            contentType: 'application/pdf'
        });

        const storageDir = Zotero.Attachments.getStorageDirectory(attachment);
        await IOUtils.writeUTF8(
            PathUtils.join(storageDir.path, '.zotero-ft-cache'),
            `ZotExtract ${titleSuffix} full text. This cache lets the plugin exercise full-text mode deterministically.`
        );
        return item;
    },

    async openPreferencesPane() {
        if (!Zotero.Utilities || !Zotero.Utilities.Internal || !Zotero.Utilities.Internal.openPreferences) return;
        Zotero.Utilities.Internal.openPreferences('zotextract-prefpane');
    },

    async closePreferencesPane() {
        try {
            const wm = Components.classes['@mozilla.org/appshell/window-mediator;1']
                .getService(Components.interfaces.nsIWindowMediator);
            const enumerator = wm.getEnumerator('zotero:pref');
            while (enumerator.hasMoreElements()) {
                const win = enumerator.getNext();
                win.close();
            }
        } catch (e) {
            Zotero.logError(e);
        }
    },

    async focusMainWindow() {
        const win = await this.waitForMainWindow();
        if (win.focus) win.focus();
    },

    async waitForMainWindow() {
        for (let i = 0; i < 60; i++) {
            const win = Zotero.getMainWindow && Zotero.getMainWindow();
            if (win && win.document && Zotero.getActiveZoteroPane()) return win;
            await this.delay(500);
        }
        throw new Error('Timed out waiting for Zotero main window.');
    },

    async waitForMenuItem(win) {
        for (let i = 0; i < 60; i++) {
            const menuitem = win.document.getElementById('zotero-itemmenu-zotextract-start');
            if (menuitem) return menuitem;
            await this.delay(500);
        }
        throw new Error('Timed out waiting for ZotExtract context-menu item.');
    },

    async waitForInstallTip(win) {
        for (let i = 0; i < 60; i++) {
            const tip = win.document.getElementById('zotextract-install-tip');
            if (tip && /Configure provider/i.test(tip.textContent || '')) return tip;
            await this.delay(500);
        }
        await this.writeProviderTipDiagnostics(win);
        throw new Error('Timed out waiting for ZotExtract provider setup tip.');
    },

    async writeProviderTipDiagnostics(win) {
        try {
            const artifactDir = Zotero.Prefs.get('extensions.zotextract.e2e.artifactDir', true);
            if (!artifactDir) return;
            const prefValue = Zotero.Prefs.get('extensions.zotextract.providerSetupTipShown', true);
            await this.writeStage(artifactDir, 'provider-tip-diagnostics', {
                prefValue,
                prefType: typeof prefValue,
                promptScheduled: !!ZotExtract.providerSetupPromptScheduled,
                isMainLibraryWindow: ZotExtract.isMainLibraryWindow ? ZotExtract.isMainLibraryWindow(win) : null,
                hasMenuItem: !!win.document.getElementById('zotero-itemmenu-zotextract-start'),
                hasObsoleteTabbar: !!win.document.getElementById('zotextract-main-tabbar'),
                hasLibrarySessionsEntry: !!win.document.getElementById('zotextract-library-section'),
                hasPanel: !!win.document.getElementById('zotextract-sessions-panel'),
                hasTip: !!win.document.getElementById('zotextract-install-tip'),
                documentReadyState: win.document.readyState || null,
                windowTitle: win.document.title || null
            });
        } catch (e) {
            Zotero.logError(e);
        }
    },

    async waitForSessionForItems(itemIDs, previousSessionIDs) {
        const previous = new Set(previousSessionIDs || []);
        const expected = itemIDs.map(id => Number(id));
        for (let i = 0; i < 180; i++) {
            const sessions = await ZotExtract.loadSessions();
            const session = sessions.find(candidate => {
                if (previous.has(candidate.id)) return false;
                const ids = (candidate.paperItemIds || []).map(id => Number(id));
                return expected.every(id => ids.includes(id));
            });
            if (session) return session;
            await this.delay(500);
        }
        throw new Error(`Timed out waiting for ZotExtract session with items ${expected.join(', ')}.`);
    },

    async waitForResultCells(sessionId, expectedCount) {
        const attempts = this.realProviderE2E() ? 1200 : 240;
        for (let i = 0; i < attempts; i++) {
            const cells = await ZotExtract.readResultCells(sessionId);
            const completed = cells.filter(cell => ['completed', 'needs-review', 'failed', 'skipped'].includes(cell.status));
            if (completed.length >= expectedCount) return cells;
            await this.delay(500);
        }
        throw new Error(`Timed out waiting for ZotExtract session result cells for ${sessionId}.`);
    },

    async addDefaultQuestion(sessionId) {
        const override = await this.ensureSimpleQuestionOverride();
        if (override) {
            await ZotExtract.addQuestionsToSession(sessionId, [override]);
            return;
        }
        const questionSets = await ZotExtract.loadQuestionSets();
        const set = questionSets.find(candidate => (candidate.questions || []).length);
        const question = set?.questions?.[0];
        if (!set || !question) throw new Error('No default ZotExtract question is available.');
        await ZotExtract.addQuestionsToSession(sessionId, [{ questionSetId: set.id, questionId: question.id }]);
    },

    async addDefaultQuestions(sessionId, count) {
        const override = await this.ensureSimpleQuestionOverride();
        if (override && count === 1) {
            await ZotExtract.addQuestionsToSession(sessionId, [override]);
            return;
        }
        const questionSets = await ZotExtract.loadQuestionSets();
        const refs = [];
        if (override) refs.push(override);
        for (const set of questionSets) {
            for (const question of set.questions || []) {
                if (override && set.id === override.questionSetId && question.id === override.questionId) continue;
                refs.push({ questionSetId: set.id, questionId: question.id });
                if (refs.length >= count) break;
            }
            if (refs.length >= count) break;
        }
        if (refs.length < count) {
            throw new Error(`Expected at least ${count} default ZotExtract questions, got ${refs.length}.`);
        }
        await ZotExtract.addQuestionsToSession(sessionId, refs);
    },

    async ensureSimpleQuestionOverride() {
        const prompt = Zotero.Prefs.get('extensions.zotextract.e2e.simpleQuestionPrompt', true);
        if (!prompt) return null;
        const name = Zotero.Prefs.get('extensions.zotextract.e2e.simpleQuestionName', true) || 'Simple summary';
        const setName = Zotero.Prefs.get('extensions.zotextract.e2e.simpleQuestionSetName', true) || 'E2E summary questions';
        let questionSets = await ZotExtract.loadQuestionSets();
        const setId = 'e2e-simple-summary-set';
        const questionId = 'e2e-simple-summary-question';
        let set = questionSets.find(candidate => candidate.id === setId);
        const now = ZotExtract.nowIso();
        if (!set) {
            set = { id: setId, name: setName, description: 'E2E question set.', questions: [], createdAt: now, updatedAt: now };
            questionSets.push(set);
        }
        set.name = setName;
        set.updatedAt = now;
        let question = (set.questions || []).find(candidate => candidate.id === questionId);
        if (!question) {
            question = { id: questionId, name, prompt, createdAt: now, updatedAt: now };
            set.questions = [...(set.questions || []), question];
        } else {
            question.name = name;
            question.prompt = prompt;
            question.updatedAt = now;
        }
        await ZotExtract.saveQuestionSets(questionSets);
        return { questionSetId: setId, questionId };
    },

    async runSessionWithoutConfirm(sessionId) {
        const originalConfirm = ZotExtract.confirmSessionEstimate;
        ZotExtract.confirmSessionEstimate = () => true;
        try {
            return await ZotExtract.runSession(sessionId);
        } finally {
            ZotExtract.confirmSessionEstimate = originalConfirm;
        }
    },

    async waitForArtifactFile(artifactDir, name, seconds) {
        const path = PathUtils.join(artifactDir, name);
        for (let i = 0; i < seconds * 2; i++) {
            if (await IOUtils.exists(path)) return path;
            await this.delay(500);
        }
        throw new Error(`Timed out waiting for artifact marker ${name}.`);
    },

    async writeStage(artifactDir, stage, details) {
        await IOUtils.writeUTF8(
            PathUtils.join(artifactDir, `ui-stage-${stage}.json`),
            JSON.stringify({
                stage,
                details: details || {},
                time: new Date().toISOString()
            }, null, 2)
        );
    },

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};
