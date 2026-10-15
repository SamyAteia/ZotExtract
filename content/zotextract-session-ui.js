var ZotExtractSessionUI = {
        async renderSessionsList(window) {
            const win = this.mainWindow(window);
            this.selectLibraryTab(win);
            const panel = win?.document?.getElementById('zotextract-sessions-panel');
            if (!panel) return;
            panel.removeAttribute?.('data-ze-workspace-session');
            delete panel._zotextractScroll;
            panel.setAttribute('data-ze-open', 'true');
            this.syncLibrarySessionsVisibility(win);
            this.positionSessionsPanel(win);
            this.renderLibrarySessionsNav(win);
            const allSessions = await this.loadSessions();
            const filter = this.sessionFilter || 'all';
            const matchesFilter = session => {
                if (filter === 'all') return true;
                if (filter === 'exported') return this.sessionExportCurrent(session);
                return session.status === filter;
            };
            const query = String(this.sessionSearchQuery || '').trim().toLowerCase();
            const matchesQuery = session => {
                if (!query) return true;
                return [
                    session.name,
                    session.status,
                    this.sessionStatusLabel(session),
                    (session.paperItemIds || []).length,
                    (session.questionRefs || []).length
                ].some(value => String(value || '').toLowerCase().includes(query));
            };
            const sessions = allSessions.filter(session => matchesFilter(session) && matchesQuery(session));
            const selected = this.currentSessionId ? (sessions.find(session => session.id === this.currentSessionId) || sessions[0]) : sessions[0];
            this.setInnerHTML(panel, `
                <div class="ze-windowbar"><span>ZotExtract Sessions</span><span class="ze-muted">Session records</span></div>
                <div class="ze-toolbar">
                    <span data-ze-session-search-host></span>
                    ${this.actionHtml('New session', 'data-ze-new-session', 'ze-btn primary')}
                    <span class="ze-spacer"></span>
                </div>
                <div class="ze-layout ze-sessions-list-layout">
                    <section class="ze-pane"><div class="ze-head">Session list <span class="ze-muted">${sessions.length} of ${allSessions.length} session${allSessions.length === 1 ? '' : 's'}</span></div><div class="ze-scroll" style="padding:0">
                        <table class="ze-table"><thead><tr><th>Name</th><th>Papers</th><th>Questions</th><th>Status</th><th>Updated</th></tr></thead><tbody>
                        ${sessions.map(session => `<tr data-ze-session-row="${this.htmlEscape(session.id)}" class="${selected && selected.id === session.id ? 'selected' : ''}"><td><div class="ze-name-cell" data-ze-session-name-host data-ze-session-id="${this.htmlEscape(session.id)}"><span class="ze-session-name" data-ze-session-name>${this.htmlEscape(session.name)}</span>${this.actionHtml('✎', `data-ze-rename-row="${this.htmlEscape(session.id)}" title="Rename session"`, 'ze-icon-btn ze-rename-icon')}</div></td><td>${(session.paperItemIds || []).length}</td><td>${(session.questionRefs || []).length}</td><td>${this.htmlEscape(this.sessionStatusLabel(session))}</td><td>${this.htmlEscape(this.relativeDate(session.updatedAt))}</td></tr>`).join('')}
                        </tbody></table>
                    </div></section>
                    <aside class="ze-pane"><div class="ze-head">Session Details</div><div class="ze-scroll">${selected ? this.renderSessionDetailHtml(selected) : '<p class="ze-muted">No sessions yet.</p>'}</div></aside>
                </div>`);
            if (!panel.querySelector) return;
            const searchHost = panel.querySelector('[data-ze-session-search-host]');
            if (searchHost?.ownerDocument?.createElement) {
                const input = searchHost.ownerDocument.createElement('input');
                input.setAttribute('class', 'ze-search-input');
                input.setAttribute('type', 'search');
                input.setAttribute('placeholder', 'Search sessions');
                input.value = this.sessionSearchQuery || '';
                input.addEventListener('input', () => {
                    this.sessionSearchQuery = input.value || '';
                    this.renderSessionsList(win);
                });
                searchHost.replaceChildren(input);
                input.focus?.();
                const end = input.value.length;
                input.setSelectionRange?.(end, end);
            }
            panel.querySelector('[data-ze-new-session]')?.addEventListener('click', event => !this.actionDisabled(event.currentTarget) && this.startEmptySession());
            panel.querySelector('[data-ze-open-detail]')?.addEventListener('click', () => selected && this.openSessionsTab(win, selected.id));
            panel.querySelector('[data-ze-rename-detail]')?.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                selected && this.beginInlineSessionRename(selected.id, win, event.currentTarget, { surface: 'list' });
            });
            panel.querySelector('[data-ze-delete-detail]')?.addEventListener('click', event => !this.actionDisabled(event.currentTarget) && selected && this.deleteSession(selected.id, win));
            panel.querySelectorAll('[data-ze-rename-row]').forEach(button => {
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.beginInlineSessionRename(button.getAttribute('data-ze-rename-row'), win, button, { surface: 'list' });
                });
            });
            panel.querySelectorAll('[data-ze-session-row]').forEach(row => {
                row.addEventListener('click', () => {
                    this.currentSessionId = row.getAttribute('data-ze-session-row');
                    this.renderSessionsList(win);
                });
                row.addEventListener('dblclick', () => this.openSessionsTab(win, row.getAttribute('data-ze-session-row')));
            });
        },

        renderSessionDetailHtml(session) {
            return `
                <h2 class="ze-session-heading" data-ze-session-name-host data-ze-session-id="${this.htmlEscape(session.id)}"><span data-ze-session-name>${this.htmlEscape(session.name)}</span>${this.actionHtml('✎', 'data-ze-rename-detail title="Rename session"', 'ze-icon-btn ze-rename-icon')}</h2>
                <table class="ze-table"><tbody>
                    <tr><th>Status</th><td>${this.htmlEscape(this.sessionStatusLabel(session))}</td></tr>
                    <tr><th>Papers</th><td>${(session.paperItemIds || []).length}</td></tr>
                    <tr><th>Questions</th><td>${(session.questionRefs || []).length}</td></tr>
                    <tr><th>Last edit</th><td>${this.htmlEscape(this.relativeDate(session.updatedAt))}</td></tr>
                </tbody></table>
                <p class="ze-muted">Open this session to add questions, adjust papers, run extraction, and export results after the run completes.</p>
                ${this.actionHtml('Open session', 'data-ze-open-detail', 'ze-btn primary')}
                ${this.actionHtml('Delete session', 'data-ze-delete-detail', 'ze-btn danger')}`;
        },

        statusLabel(status) {
            const labels = {
                draft: 'Draft',
                running: 'Running',
                'needs-review': 'Reviewable',
                completed: 'Completed',
                exported: 'Exported'
            };
            return labels[status] || 'Draft';
        },

        sessionExportCurrent(session) {
            return !!(session?.exportedAt && !session.exportStale);
        },

        sessionStatusLabel(session) {
            const base = this.statusLabel(session?.status);
            return this.sessionExportCurrent(session) ? `${base} · Exported` : base;
        },

        relativeDate(iso) {
            if (!iso) return '';
            const date = new Date(iso);
            if (Number.isNaN(date.getTime())) return iso;
            return date.toLocaleDateString ? date.toLocaleDateString() : iso.slice(0, 10);
        },

        canExportSession(session) {
            return ['completed', 'exported'].includes(session?.status);
        },

        async buildContextDiagnosticsForItem(item, provider, questions = []) {
            const contextWindowTokens = this.effectiveContextWindowTokens(provider);
            const capCharacters = this.maxTextCharactersForProvider(provider);
            const budgets = (questions.length ? questions : [{ prompt: '' }])
                .map(question => this.contextBudgetTokens(provider, question.prompt || ''))
                .filter(value => Number.isFinite(value) && value > 0);
            const budgetTokens = budgets.length ? Math.min(...budgets) : 0;
            const attachment = await this.bestPdfAttachment(item);
            const metadata = [
                `Title: ${this.itemTitle(item)}`,
                this.itemAbstract(item) ? `Abstract: ${this.itemAbstract(item)}` : '',
                this.itemDoi(item) ? `DOI: ${this.itemDoi(item)}` : ''
            ].filter(Boolean).join('\n');
            const warnings = [];
            let fullText = '';
            if (attachment) {
                try {
                    const textInfo = await this.getFullText(attachment.id, { info: true, provider });
                    fullText = textInfo.text || '';
                    warnings.push(...(textInfo.warnings || []));
                } catch (e) {
                    warnings.push(`No indexed full text: ${e.message || String(e)}`);
                }
            } else {
                warnings.push('No PDF attachment available.');
            }
            const lines = this.lineNumberText(fullText);
            const fullTextTokens = this.estimateTokens(fullText, provider);
            const totalContext = [
                metadata,
                lines.length ? `Full text with line numbers:\n${this.formatNumberedLines(lines)}` : ''
            ].filter(Boolean).join('\n\n');
            const totalContextTokens = this.estimateTokens(totalContext, provider);
            const requestInfos = await Promise.all((questions.length ? questions : [{ prompt: '' }])
                .map(question => this.requestInputTokenInfo(provider, totalContext, question.prompt || '')));
            const requestInfo = requestInfos.reduce((maxInfo, info) => !maxInfo || info.tokens > maxInfo.tokens ? info : maxInfo, null);
            const requestInputTokens = requestInfo?.tokens || 0;
            const tokenCountMethod = requestInfo?.method || this.tokenEstimatorProfile(provider).method;
            const maxCompletionTokens = this.maxCompletionTokens(provider);
            const usableWindowTokens = this.usableContextWindowTokens(provider, requestInfo);
            const questionList = questions.length ? questions : [{ prompt: '' }];
            const evidencePlans = lines.length
                ? await Promise.all(questionList.map(question => this.evidenceCollectionWindowPlan(provider, lines, question.prompt || '', budgetTokens)))
                : [];
            const evidenceCollectionMode = !lines.length
                ? 'metadata-only'
                : evidencePlans.some(plan => plan.mode === 'sliding-window')
                    ? 'sliding-window'
                    : 'single-window';
            const windowCount = evidencePlans.length
                ? Math.max(...evidencePlans.map(plan => (plan.windows || []).length))
                : 0;
            const sliding = evidenceCollectionMode === 'sliding-window';
            return {
                contextWindowTokens,
                usableWindowTokens,
                capCharacters,
                budgetTokens,
                fullTextTokens,
                totalContextTokens,
                requestInputTokens,
                maxCompletionTokens,
                tokenCountMethod,
                lineCount: lines.length,
                sliding,
                windowCount,
                evidenceCollectionMode,
                warnings
            };
        },

        renderContextDiagnosticsHtml(info, extractionStats = null) {
            if (!info) {
                return `
                    <div class="ze-context-diagnostics">
                        <span class="ze-pill loading"><span class="ze-spinner"></span>Extracting full text</span>
                        <div>Reading indexed PDF text.</div>
                    </div>`;
            }
            const mode = info.evidenceCollectionMode === 'metadata-only'
                ? 'Metadata only'
                : info.sliding
                    ? 'Sliding evidence'
                    : 'Two-pass evidence';
            const modeClass = info.evidenceCollectionMode === 'metadata-only' ? 'unknown' : (info.sliding ? 'sliding' : 'direct');
            const requestTotal = Number(info?.requestInputTokens || 0) + Number(info?.maxCompletionTokens || 0);
            const limit = info?.usableWindowTokens ? `${this.formatTokenCount(info.usableWindowTokens)} tokens` : 'unknown limit';
            const evidenceWindows = Number(info.windowCount || 0);
            const summary = info.evidenceCollectionMode === 'metadata-only'
                ? `${this.formatTokenCount(requestTotal)} / ${limit}`
                : `${this.formatTokenCount(evidenceWindows)} evidence window${evidenceWindows === 1 ? '' : 's'} | ${limit} per request`;
            const tokenTitle = info?.tokenCountMethod ? ` title="Token count: ${this.htmlEscape(info.tokenCountMethod)}"` : '';
            const timingLine = extractionStats?.count
                ? `<div>Avg extraction: ${this.htmlEscape(this.formatDuration(extractionStats.averageMs))}</div>`
                : '';
            return `
                <div class="ze-context-diagnostics"${tokenTitle}>
                    <span class="ze-pill ${modeClass}">${this.htmlEscape(mode)}</span>
                    <div>${this.htmlEscape(summary)}</div>
                    ${timingLine}
                </div>`;
        },

        averageExtractionTimesByItem(cells = []) {
            const stats = new Map();
            for (const cell of cells || []) {
                const itemId = String(cell?.itemId || '');
                const started = Date.parse(cell?.startedAt || '');
                const completed = Date.parse(cell?.completedAt || '');
                if (!itemId || !Number.isFinite(started) || !Number.isFinite(completed) || completed < started) continue;
                const entry = stats.get(itemId) || { count: 0, totalMs: 0, averageMs: 0 };
                entry.count += 1;
                entry.totalMs += completed - started;
                entry.averageMs = Math.round(entry.totalMs / entry.count);
                stats.set(itemId, entry);
            }
            return stats;
        },

        formatDuration(milliseconds) {
            const raw = Number(milliseconds || 0);
            if (!Number.isFinite(raw) || raw <= 0) return '0s';
            if (raw < 1000) return '<1s';
            const seconds = Math.round(raw / 1000);
            if (seconds < 60) return `${seconds}s`;
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
        },

        formatTokenCount(value) {
            const number = Number(value || 0);
            return Number.isFinite(number) ? number.toLocaleString() : '0';
        },

        async refreshSessionWorkspace(sessionId) {
            for (const win of this.mainLibraryWindows()) {
                const panel = this.sessionWorkspacePanel(win, sessionId);
                if (panel?.getAttribute?.('data-ze-open') !== 'true' || panel.getAttribute?.('data-ze-workspace-session') !== sessionId) continue;
                await this.renderSessionWorkspace(sessionId, win);
            }
        },

        async renderSessionWorkspace(sessionId, window, contextDiagnostics = null) {
            const win = this.mainWindow(window);
            const panel = this.sessionWorkspacePanel(win, sessionId);
            if (!panel) return;
            const renderVersion = (panel._zotextractRenderVersion || 0) + 1;
            panel._zotextractRenderVersion = renderVersion;
            const session = await this.getSession(sessionId);
            if (!session) return;
            const questions = await this.resolveQuestionRefs(session.questionRefs);
            const cells = await this.readResultCells(session.id);
            const papers = [];
            for (const itemId of session.paperItemIds || []) {
                const item = await this.getItemById(itemId);
                if (item) papers.push(item);
            }
            if (this.sessionWorkspacePanel(win, sessionId) !== panel || panel._zotextractRenderVersion !== renderVersion) return;
            const provider = this.getProviderSettings();
            const diagnosticsReady = contextDiagnostics instanceof Map;
            const diagnostics = diagnosticsReady ? contextDiagnostics : new Map();
            const oldWrap = panel.querySelector?.('.ze-matrix-wrap');
            const sameSession = panel.getAttribute?.('data-ze-workspace-session') === sessionId;
            const scroll = sameSession && oldWrap
                ? (this.sessionPanelIsSelected(win, panel) ? { left: oldWrap.scrollLeft, top: oldWrap.scrollTop } : panel._zotextractScroll) : null;
            panel._zotextractScroll = scroll;
            panel.setAttribute?.('data-ze-workspace-session', sessionId);
            this.updateSessionTabTitle(win, session);
            this.setInnerHTML(panel, `
                <div class="ze-windowbar"><span class="ze-window-title" data-ze-session-name-host data-ze-session-id="${this.htmlEscape(session.id)}"><span>ZotExtract Session - </span><span data-ze-session-name>${this.htmlEscape(session.name)}</span>${this.actionHtml('✎', 'data-ze-rename-session title="Rename session"', 'ze-icon-btn ze-rename-icon')}</span><span>${questions.length} question${questions.length === 1 ? '' : 's'} x ${papers.length} paper${papers.length === 1 ? '' : 's'}</span></div>
                <div class="ze-toolbar">
                    ${this.actionHtml('Back to sessions', 'data-ze-back')}
                    <span class="ze-pill">${papers.length} papers</span>
                    <span class="ze-pill">${questions.length} questions</span>
                        <span class="ze-pill">${this.htmlEscape(this.sessionStatusLabel(session))}</span>
                        <span class="ze-spacer"></span>
                        ${this.actionHtml('Add papers', 'data-ze-add-papers title="Return to Zotero library to select papers or a collection"', 'ze-btn primary')}
                </div>
                <div class="ze-session-body">
                    ${papers.length ? this.renderSessionMatrixHtml(session, papers, questions, cells, diagnostics) : this.renderEmptySessionHtml(session)}
                    <div class="ze-footer">
                        <span class="ze-pill">${cells.filter(cell => cell.status === 'completed').length} extraction${cells.filter(cell => cell.status === 'completed').length === 1 ? '' : 's'} ready</span>
                        <span class="ze-muted">Export is available after a session run.</span>
                        <span class="ze-spacer"></span>
                        ${this.actionHtml('Delete session', 'data-ze-delete-session', 'ze-btn danger')}
                        ${this.actionHtml('Export results', 'data-ze-export', 'ze-btn', !this.canExportSession(session))}
                        ${this.actionHtml('Run session', 'data-ze-run-footer', 'ze-btn primary', !(questions.length && papers.length))}
                    </div>
                </div>`);
            if (!panel.querySelector) return;
            panel.querySelector('[data-ze-back]')?.addEventListener('click', () => this.openSessionsTab(win));
            panel.querySelector('[data-ze-rename-session]')?.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                this.beginInlineSessionRename(session.id, win, event.currentTarget, { surface: 'workspace' });
            });
            panel.querySelector('[data-ze-add-papers]')?.addEventListener('click', () => this.returnToLibraryForPaperSelection(session.id, win));
            panel.querySelector('[data-ze-delete-session]')?.addEventListener('click', event => !this.actionDisabled(event.currentTarget) && this.deleteSession(session.id, win));
            panel.querySelector('[data-ze-run-footer]')?.addEventListener('click', event => !this.actionDisabled(event.currentTarget) && this.runSession(session.id));
            panel.querySelector('[data-ze-export]')?.addEventListener('click', event => !this.actionDisabled(event.currentTarget) && this.exportSession(session.id, win));
            this.attachMatrixResizers(panel, session);
            if (scroll) {
                if (this.sessionPanelIsSelected(win, panel)) this.restoreSessionView(panel);
            } else if (cells.some(cell => cell.status === 'completed' || cell.status === 'needs-review')) {
                this.scrollFirstResultIntoView(panel);
            }
            const wrap = panel.querySelector('.ze-matrix-wrap');
            wrap?.addEventListener('scroll', () => {
                if (this.sessionPanelIsSelected(win, panel)) panel._zotextractScroll = { left: wrap.scrollLeft, top: wrap.scrollTop };
            });
            if (!diagnosticsReady) {
                this.refreshContextDiagnostics(session.id, win, papers, provider, questions, renderVersion);
            }
        },

        renderEmptySessionHtml(session) {
            return `
                <div class="ze-empty-session">
                    <div class="ze-empty-panel">
                        <h2>Add papers to start</h2>
                        <p>This session does not have papers yet. Go back to your Zotero library, select papers or a collection, then right-click and add them to this ZotExtract session.</p>
                        <div class="ze-empty-actions">
                            ${this.actionHtml('Add papers', 'data-ze-inline-papers', 'ze-btn primary')}
                            ${this.actionHtml('Add extractions', 'data-ze-inline-pick', 'ze-btn')}
                        </div>
                        <div class="ze-inline-hint">
                            Tip: right-click selected papers or a collection in Zotero and choose the ZotExtract add-to-session action. ZotExtract keeps this session active while you select papers.
                        </div>
                    </div>
                </div>`;
        },

        async refreshContextDiagnostics(sessionId, win, papers, provider, questions, renderVersion) {
            const diagnostics = new Map();
            await Promise.all((papers || []).map(async item => {
                try {
                    diagnostics.set(item.id, await this.buildContextDiagnosticsForItem(item, provider, questions));
                } catch (e) {
                    diagnostics.set(item.id, {
                        warnings: [`Context diagnostics failed: ${e?.message || String(e)}`]
                    });
                }
            }));
            const panel = this.sessionWorkspacePanel(win, sessionId);
            if (panel?._zotextractRenderVersion !== renderVersion || panel?.getAttribute('data-ze-workspace-session') !== sessionId) return;
            await this.renderSessionWorkspace(sessionId, win, diagnostics);
        },

        renderSessionMatrixHtml(session, papers, questions, cells, contextDiagnostics = new Map()) {
            const safeCells = Array.isArray(cells) ? cells : [];
            const cellMap = new Map(safeCells.map(cell => [`${cell.itemId}:${cell.questionId}`, cell]));
            const extractionStats = this.averageExtractionTimesByItem(safeCells);
            const rowWidth = this.matrixLabelColumnWidth(session);
            const colParts = [`${rowWidth}px`].concat(papers.map(item => `${session.columnWidths?.[item.id] || 300}px`));
            const style = `--ze-grid-cols:${colParts.join(' ')};`;
            const paperHeaders = papers.map(item => `
                <div class="ze-header">
                    <div class="ze-header-actions">${this.actionHtml('x', `data-ze-remove-paper="${this.htmlEscape(String(item.id))}" title="Remove paper from session"`, 'ze-icon-btn')}</div>
                    <div class="ze-title">${this.htmlEscape(this.shortPaperName(item))}</div>
                    <div class="ze-muted">${this.htmlEscape(this.itemTitle(item))}</div>
                    <span class="ze-pill">Paper</span>
                    ${this.matrixColumnHandle(item.id)}
                </div>`).join('');
            const columnIds = papers.map(item => item.id);
            const metadataRows = [
                this.renderMatrixRow(session, 'title', 'Title', papers.map(item => this.itemTitle(item)), '', false, { columnIds }),
                this.renderMatrixRow(
                    session,
                    'context-diagnostics',
                    'Context size',
                    papers.map(item => this.renderContextDiagnosticsHtml(contextDiagnostics.get(item.id), extractionStats.get(String(item.id)))),
                    '',
                    false,
                    { html: true, noRemove: true, columnIds }
                )
            ].join('');
            const questionRows = questions.map(question => {
                const values = papers.map(item => {
                    const cell = cellMap.get(`${item.id}:${question.questionId}`);
                    return this.renderSessionCellContent(cell);
                });
                const cellKeys = papers.map(item => `${item.id}:${question.questionId}`);
                return this.renderMatrixRow(session, question.questionId, question.questionName, values, 'Add question', true, { columnIds, cellKeys });
            }).join('');
            const questionPickerRow = `
                <div class="ze-label">${this.actionHtml('Add extractions', 'data-ze-inline-pick type="button"', 'ze-btn primary')}${this.matrixColumnHandle('__labels')}</div>
                <div class="ze-cell" style="grid-column:span ${Math.max(1, papers.length)}"><strong>Add extractions</strong><br><span class="ze-muted">Add a question or a whole question set. Selected questions become new rows under the paper metadata.</span></div>`;
            return `
                <div class="ze-matrix-wrap">
                    <div style="position:sticky;left:calc(100% - 42px);top:4px;width:36px;height:26px;border:1px solid var(--ze-border);border-radius:999px;background:var(--ze-toolbar);display:grid;place-items:center;z-index:8">↔</div>
                    <div class="ze-matrix" style="${style}">
                        <div class="ze-corner"><strong>Extraction grid</strong><br><span class="ze-muted">Rows are questions. Columns are papers.</span>${this.matrixColumnHandle('__labels')}</div>
                        ${paperHeaders}
                        ${metadataRows}
                        ${questionRows}
                        ${questionPickerRow}
                    </div>
                </div>`;
        },

        matrixLabelColumnWidth(session) {
            const width = Number(session?.columnWidths?.__labels || 174);
            return Number.isFinite(width) ? Math.max(140, Math.min(380, width)) : 174;
        },

        matrixColumnHandle(columnId) {
            return `<span class="ze-resize-col" data-ze-col="${this.htmlEscape(String(columnId))}" title="Resize column"></span>`;
        },

        matrixRowHandle(rowId) {
            return `<span class="ze-resize-row" data-ze-row="${this.htmlEscape(String(rowId))}" title="Resize row"></span>`;
        },

        renderSessionCellContent(cell) {
            if (!cell) return '<div class="ze-result">Ready</div>';
            if (cell.status === 'failed') return this.renderStatusResultCellHtml(cell, `Failed: ${cell.error || ''}`);
            if (cell.status === 'running') return '<div class="ze-result">Running...</div>';
            if (cell.status === 'cancelled') return this.renderStatusResultCellHtml(cell, 'Cancelled');
            return this.renderResultCellHtml(cell);
        },

        updateOpenResultCell(sessionId, cell) {
            if (!cell) return;
            for (const win of this.mainLibraryWindows()) {
                const panel = this.sessionWorkspacePanel(win, sessionId);
                if (!panel || panel.getAttribute?.('data-ze-open') !== 'true') continue;
                if (!this.nativeSessionTab(win, sessionId) && this.currentSessionId !== sessionId) continue;
                const key = `${cell.itemId}:${cell.questionId}`;
                const target = panel.querySelector?.(`[data-ze-result-cell-key="${this.cssEscape(key)}"] .ze-cell-content`);
                if (!target) continue;
                this.setInnerHTML(target, this.renderSessionCellContent(cell));
                this.attachResultCellActions(panel, sessionId);
            }
        },

        cssEscape(value) {
            const source = String(value || '');
            if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(source);
            return source.replace(/["\\]/g, '\\$&');
        },

        renderResultCellHtml(cell) {
            let parsed = cell.structured?.extraction || null;
            if (typeof parsed === 'string') {
                parsed = this.parseJsonAnswer(parsed).value || null;
            }
            if (!parsed) {
                parsed = this.parseJsonAnswer(cell.answer || '').value || null;
            }
            const parseFailedStructuredJson = !parsed && cell.structured?.validation?.requestedJson;
            const answer = parsed && Object.prototype.hasOwnProperty.call(parsed, 'answer')
                ? parsed.answer
                : (parsed || (parseFailedStructuredJson ? this.extractMalformedAnswerPreview(cell.answer || '') : (cell.answer || '')));
            const evidence = cell.structured?.evidence?.length
                ? cell.structured.evidence
                : this.extractRelevantContextEntries(parsed || {});
            const preview = this.finalAnswerPreview(answer)
                || this.previewValue(answer)
                || this.previewValue(parsed)
                || (parseFailedStructuredJson ? 'Reviewable: model returned incomplete structured output.' : this.previewValue(cell.answer || ''));
            const status = this.statusLabel(cell.status || 'completed');
            const actions = [
                this.cellRerunActionHtml(cell),
                evidence.length && this.hasEvidencePdfLocation(cell) ? this.evidenceOpenActionHtml(cell) : ''
            ].filter(Boolean).join('');
            const evidenceDisclosure = this.renderResultEvidenceDisclosureHtml(cell, parsed, evidence);
            return `
                <div class="ze-result-cell">
                    <div class="ze-result-preview">${this.htmlEscape(preview || status)}</div>
                    ${evidenceDisclosure}
                    ${actions ? `<div class="ze-result-actions">${actions}</div>` : ''}
                </div>`;
        },

        evidenceOpenActionHtml(cell, range = null, label = 'PDF') {
            const rangeAttr = range ? ` data-ze-open-evidence-range="${this.htmlEscape(String(range))}"` : '';
            return `<a class="ze-result-action ze-evidence-open" role="button" title="Open cited evidence in Zotero PDF" data-ze-open-evidence="${this.htmlEscape(String(cell.itemId))}:${this.htmlEscape(String(cell.questionId))}"${rangeAttr} tabindex="0">${this.htmlEscape(label)}</a>`;
        },

        renderResultEvidenceDisclosureHtml(cell, parsed, evidence = []) {
            const reasoning = this.resultReasoningText(parsed);
            const warnings = (cell.warnings || cell.source?.warnings || []).filter(Boolean);
            const provenance = cell.structured?.provenance || {};
            const provenanceLines = [
                provenance.evidenceCollectionMode ? `Evidence pass: ${provenance.evidenceCollectionMode}` : '',
                Number.isFinite(Number(provenance.evidenceWindowCount)) ? `Evidence windows: ${Number(provenance.evidenceWindowCount)}` : '',
                provenance.finalContextMode ? `Final context: ${provenance.finalContextMode}` : ''
            ].filter(Boolean);
            const evidenceHtml = evidence.length
                ? `<ul>${evidence.map(entry => {
                    const lines = entry?.lines || '';
                    const note = entry?.note || '';
                    const pdfAction = lines && this.hasEvidencePdfLocation(cell, lines) ? ` ${this.evidenceOpenActionHtml(cell, lines)}` : '';
                    return `<li><span class="ze-evidence-lines">${this.htmlEscape(lines || 'Evidence')}</span>${note ? ` - ${this.htmlEscape(note)}` : ''}${pdfAction}</li>`;
                }).join('')}</ul>`
                : '<div>No cited line evidence returned.</div>';
            const warningHtml = warnings.length
                ? `<div class="ze-result-evidence-section"><strong>Warnings</strong><ul>${warnings.map(warning => `<li>${this.htmlEscape(warning)}</li>`).join('')}</ul></div>`
                : '';
            const provenanceHtml = provenanceLines.length
                ? `<div class="ze-result-evidence-section"><strong>Source details</strong><ul>${provenanceLines.map(line => `<li>${this.htmlEscape(line)}</li>`).join('')}</ul></div>`
                : '';
            return `
                <details class="ze-result-evidence">
                    <summary>Evidence / reasoning</summary>
                    <div class="ze-result-evidence-body">
                        <div class="ze-result-evidence-section"><strong>Reasoning</strong><div>${this.htmlEscape(reasoning || 'No visible reasoning returned.')}</div></div>
                        <div class="ze-result-evidence-section"><strong>Evidence</strong>${evidenceHtml}</div>
                        ${warningHtml}
                        ${provenanceHtml}
                    </div>
                </details>`;
        },

        resultReasoningText(parsed) {
            if (!parsed || typeof parsed !== 'object') return '';
            const reasoning = parsed.reasoning;
            if (reasoning == null) return '';
            if (typeof reasoning === 'string') return reasoning.trim();
            return this.previewValue(reasoning);
        },

        renderStatusResultCellHtml(cell, label) {
            const action = this.cellRerunActionHtml(cell);
            return `<div class="ze-result">${this.htmlEscape(label || this.statusLabel(cell?.status || ''))}${action ? `<div class="ze-result-actions">${action}</div>` : ''}</div>`;
        },

        cellRerunActionHtml(cell) {
            if (!cell || String(cell.status || '').toLowerCase() === 'running') return '';
            return `<a class="ze-result-action ze-cell-rerun" role="button" title="Rerun this extraction" data-ze-rerun-cell data-ze-rerun-item-id="${this.htmlEscape(String(cell.itemId))}" data-ze-rerun-question-id="${this.htmlEscape(String(cell.questionId))}" tabindex="0">↻</a>`;
        },

        finalAnswerPreview(answer) {
            if (answer == null) return '';
            if (typeof answer === 'string') return answer.trim();
            if (Array.isArray(answer)) {
                return answer.map(value => this.finalAnswerPreview(value)).filter(Boolean).join('\n');
            }
            if (typeof answer === 'object') {
                const preferredKeys = ['summary', 'answer', 'result', 'conclusion', 'mainFinding', 'main_findings', 'items'];
                for (const key of preferredKeys) {
                    if (Object.prototype.hasOwnProperty.call(answer, key)) {
                        const preview = this.finalAnswerPreview(answer[key]);
                        if (preview) return preview;
                    }
                }
                return Object.entries(answer)
                    .filter(([key, value]) => value != null && value !== '' && !this.isSupportMetadataKey(key))
                    .slice(0, 6)
                    .map(([key, value]) => `${key}: ${this.finalAnswerPreview(value) || this.previewValue(value)}`)
                    .join('\n');
            }
            return String(answer);
        },

        extractMalformedAnswerPreview(rawAnswer) {
            const raw = String(rawAnswer || '');
            const answerMatch = /"answer"\s*:\s*/i.exec(raw);
            if (!answerMatch) return '';
            return raw
                .slice(answerMatch.index + answerMatch[0].length)
                .replace(/^[\s:{\[]+/, '')
                .split(/\n/)
                .map(line => line
                    .replace(/^\s*["{},\]]+/, '')
                    .replace(/[",{}\]]+\s*$/, '')
                    .trim())
                .filter(line => line && !/^(reasoning|relevant_context|evidence|quote|quotes)\b/i.test(line))
                .slice(0, 10)
                .join('\n')
                .trim();
        },

        isSupportMetadataKey(key) {
            return [
                'evidence',
                'evidences',
                'quote',
                'quotes',
                'line',
                'lines',
                'lineId',
                'lineIds',
                'lineRange',
                'lineRanges',
                'citation',
                'citations',
                'source',
                'sources',
                'relevant_context',
                'relevantContext',
                'reasoning'
            ].includes(String(key || ''));
        },

        renderMatrixRow(session, rowId, label, values, addText, questionRow, options = {}) {
            const defaultHeight = rowId === 'context-diagnostics' ? 56 : 64;
            const height = session.rowHeights?.[rowId] || defaultHeight;
            const columnIds = options.columnIds || [];
            const cells = values.map((value, index) => {
                const content = (questionRow || options.html) ? value : this.htmlEscape(value);
                const columnHandle = columnIds[index] !== undefined ? this.matrixColumnHandle(columnIds[index]) : '';
                const cellKey = options.cellKeys?.[index]
                    ? ` data-ze-result-cell-key="${this.htmlEscape(String(options.cellKeys[index]))}"`
                    : '';
                return `<div class="ze-cell"${cellKey} style="min-height:${height}px"><div class="ze-cell-content">${content}</div>${columnHandle}${this.matrixRowHandle(rowId)}</div>`;
            }).join('');
            const remove = questionRow && !options.noRemove
                ? this.actionHtml('x', `data-ze-remove-question="${this.htmlEscape(rowId)}" title="Remove question from session"`, 'ze-icon-btn')
                : '';
            return `<div class="ze-label" style="min-height:${height}px"><div class="ze-row-label"><span>${this.htmlEscape(label)}</span>${remove}</div>${this.matrixColumnHandle('__labels')}${this.matrixRowHandle(rowId)}</div>${cells}`;
        },

        shortPaperName(item) {
            const title = this.itemTitle(item);
            const words = title.split(/\s+/).filter(Boolean);
            return words.length ? `${words[0].replace(/[^A-Za-z0-9]/g, '') || 'Paper'} ${String(item.id).slice(-2)}` : `Paper ${item.id}`;
        },
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractSessionUI);
}
