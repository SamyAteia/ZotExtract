var ZotExtractEvidenceUI = {
        attachMatrixResizers(panel, session) {
            this.attachResultCellActions(panel, session.id);
            panel.querySelectorAll('[data-ze-inline-pick]').forEach(button => button.addEventListener('click', () => this.openQuestionPicker(session.id)));
            panel.querySelectorAll('[data-ze-inline-papers]').forEach(button => button.addEventListener('click', () => this.returnToLibraryForPaperSelection(session.id, panel.ownerGlobal || this.mainWindow())));
            panel.querySelectorAll('[data-ze-remove-paper]').forEach(button => {
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.removePaperFromSession(session.id, button.getAttribute('data-ze-remove-paper'));
                });
            });
            panel.querySelectorAll('[data-ze-remove-question]').forEach(button => {
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const questionId = button.getAttribute('data-ze-remove-question');
                    const ref = (session.questionRefs || []).find(candidate => candidate.questionId === questionId) || {};
                    this.removeQuestionFromSession(session.id, ref.questionSetId || '', questionId);
                });
            });
            panel.querySelectorAll('[data-ze-col]').forEach(handle => {
                handle.addEventListener('mousedown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const colId = handle.getAttribute('data-ze-col');
                    const startX = event.clientX;
                    const start = colId === '__labels' ? this.matrixLabelColumnWidth(session) : Number(session.columnWidths?.[colId] || 300);
                    const doc = panel.ownerDocument;
                    const onMove = moveEvent => {
                        const min = colId === '__labels' ? 140 : 180;
                        const max = colId === '__labels' ? 380 : 680;
                        const width = Math.max(min, Math.min(max, start + moveEvent.clientX - startX));
                        session.columnWidths = { ...(session.columnWidths || {}), [colId]: width };
                        this.applyMatrixColumnWidths(panel, session);
                    };
                    const onUp = async () => {
                        doc.removeEventListener('mousemove', onMove);
                        doc.removeEventListener('mouseup', onUp);
                        await this.saveSession(session);
                    };
                    doc.addEventListener('mousemove', onMove);
                    doc.addEventListener('mouseup', onUp);
                });
            });
            panel.querySelectorAll('[data-ze-row]').forEach(handle => {
                handle.addEventListener('mousedown', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const rowId = handle.getAttribute('data-ze-row');
                    const startY = event.clientY;
                    const start = Number(session.rowHeights?.[rowId] || handle.closest('.ze-label')?.style?.minHeight?.replace('px', '') || handle.closest('.ze-cell')?.style?.minHeight?.replace('px', '') || 76);
                    const doc = panel.ownerDocument;
                    const onMove = moveEvent => {
                        const height = Math.max(52, Math.min(260, start + moveEvent.clientY - startY));
                        session.rowHeights = { ...(session.rowHeights || {}), [rowId]: height };
                        this.applyMatrixRowHeights(panel, rowId, height);
                    };
                    const onUp = async () => {
                        doc.removeEventListener('mousemove', onMove);
                        doc.removeEventListener('mouseup', onUp);
                        await this.saveSession(session);
                    };
                    doc.addEventListener('mousemove', onMove);
                    doc.addEventListener('mouseup', onUp);
                });
            });
        },

        attachResultCellActions(panel, sessionId) {
            if (!panel?.querySelectorAll) return;
            panel.querySelectorAll('[data-ze-open-evidence]').forEach(button => {
                if (button.getAttribute('data-ze-action-bound') === 'true') return;
                button.setAttribute('data-ze-action-bound', 'true');
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const [itemId, questionId] = String(button.getAttribute('data-ze-open-evidence') || '').split(':');
                    const range = button.getAttribute('data-ze-open-evidence-range') || null;
                    this.openEvidenceForSessionCell(sessionId, itemId, questionId, range, panel.ownerGlobal || this.mainWindow());
                });
            });
            panel.querySelectorAll('[data-ze-rerun-cell]').forEach(button => {
                if (button.getAttribute('data-ze-action-bound') === 'true') return;
                button.setAttribute('data-ze-action-bound', 'true');
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (this.actionDisabled(button)) return;
                    this.rerunSessionCell(
                        sessionId,
                        button.getAttribute('data-ze-rerun-item-id'),
                        button.getAttribute('data-ze-rerun-question-id')
                    );
                });
            });
        },

        scrollFirstResultIntoView(panel) {
            const wrap = panel?.querySelector?.('.ze-matrix-wrap');
            const target = panel?.querySelector?.('[data-ze-open-evidence]')?.closest?.('.ze-cell')
                || panel?.querySelector?.('.ze-result-cell')?.closest?.('.ze-cell');
            if (!wrap || !target || !wrap.getBoundingClientRect || !target.getBoundingClientRect) return;
            const wrapRect = wrap.getBoundingClientRect();
            const targetRect = target.getBoundingClientRect();
            if (targetRect.top < wrapRect.top + 12 || targetRect.bottom > wrapRect.bottom - 12) {
                wrap.scrollTop += targetRect.top - wrapRect.top - 18;
            }
        },

        async openEvidenceForSessionCell(sessionId, itemId, questionId, selectedRange = null, window = null) {
            const cells = await this.readResultCells(sessionId);
            const cell = cells.find(candidate => String(candidate.itemId) === String(itemId) && String(candidate.questionId) === String(questionId));
            if (!cell) return;
            await this.openEvidenceInPdf(cell, selectedRange, window);
        },

        async openEvidenceViewer(sessionId, itemId, questionId, selectedRange = null, window = null) {
            return this.openEvidenceForSessionCell(sessionId, itemId, questionId, selectedRange, window);
        },

        firstEvidencePage(cell, range = null) {
            const records = cell?.lineSourceMap?.records || [];
            const evidence = cell?.structured?.evidence || this.extractRelevantContextEntries(cell?.structured?.extraction || {});
            const ranges = range ? [range] : evidence.map(entry => entry.lines);
            for (const candidateRange of ranges) {
                const record = records.find(line => this.lineRecordInRange(line, candidateRange) && line.page);
                if (record?.page) return record.page;
            }
            return null;
        },

        hasEvidencePdfLocation(cell, range = null) {
            return !!this.buildEvidencePdfLocation(cell, range);
        },

        buildEvidencePdfLocation(cell, range = null) {
            const sourceMap = cell?.lineSourceMap || {};
            const records = sourceMap.records || [];
            const evidence = cell?.structured?.evidence || this.extractRelevantContextEntries(cell?.structured?.extraction || {});
            const ranges = range ? [range] : evidence.map(entry => entry.lines).filter(Boolean);
            const selectedRecords = [];
            for (const candidateRange of ranges.length ? ranges : ['']) {
                const matches = candidateRange
                    ? records.filter(record => this.lineRecordInRange(record, candidateRange))
                    : records.slice(0, 1);
                if (!matches.length) continue;
                selectedRecords.push(...matches);
                const hasLocation = matches.some(record => record.page || (record.rects || []).length);
                if (range || hasLocation) break;
            }
            const pageGroups = new Map();
            for (const record of selectedRecords) {
                for (const rect of record.rects || []) {
                    const page = Number(rect.page || record.page || 0);
                    const pdfRect = this.sourceRectToPdfRect(rect);
                    if (!page || !pdfRect) continue;
                    if (!pageGroups.has(page)) pageGroups.set(page, []);
                    pageGroups.get(page).push(pdfRect);
                }
            }
            const firstPage = pageGroups.size
                ? Math.min(...Array.from(pageGroups.keys()))
                : this.firstEvidencePage(cell, ranges[0]);
            if (!firstPage) return null;
            const rects = pageGroups.get(firstPage) || [];
            if (!rects.length) return { pageIndex: Math.max(0, firstPage - 1) };
            return {
                position: {
                    pageIndex: Math.max(0, firstPage - 1),
                    rects
                }
            };
        },

        sourceRectToPdfRect(rect) {
            if (!rect) return null;
            if (Array.isArray(rect) && rect.length >= 4) {
                return rect.slice(0, 4).map(value => this.roundRectNumber(value));
            }
            const x = Number(rect.x);
            const y = Number(rect.y);
            const width = Number(rect.width);
            const height = Number(rect.height);
            if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
            const pageHeight = Number(rect.pageHeight || 0);
            if (Number.isFinite(pageHeight) && pageHeight > 0) {
                return [
                    this.roundRectNumber(x),
                    this.roundRectNumber(pageHeight - y - height),
                    this.roundRectNumber(x + width),
                    this.roundRectNumber(pageHeight - y)
                ];
            }
            return [
                this.roundRectNumber(x),
                this.roundRectNumber(y),
                this.roundRectNumber(x + width),
                this.roundRectNumber(y + height)
            ];
        },

        readerForAttachment(attachmentId) {
            const id = Number(attachmentId);
            return (Zotero.Reader?._readers || []).find(reader => Number(reader.itemID) === id) || null;
        },

        cloneIntoReader(value, reader) {
            try {
                if (typeof Components !== 'undefined' && Components.utils?.cloneInto && reader?._iframeWindow) {
                    return Components.utils.cloneInto(value, reader._iframeWindow);
                }
            } catch (_) {}
            return value;
        },

        extendEvidencePdfSpotlight(reader, location, timeout = 8000) {
            if (!reader || !location?.position) return false;
            const target = reader._internalReader?._lastView || reader._internalReader?._view || reader._internalReader;
            if (!target || typeof target.setSpotlight !== 'function') return false;
            try {
                target.setSpotlight('Navigation', this.cloneIntoReader(location.position, reader), timeout);
                return true;
            } catch (e) {
                Zotero.logError(e);
                return false;
            }
        },

        async focusEvidencePdfLocation(attachmentId, location) {
            if (!location) return;
            let reader = this.readerForAttachment(attachmentId);
            if (!reader && Zotero.Promise?.delay) {
                await Zotero.Promise.delay(250);
                reader = this.readerForAttachment(attachmentId);
            }
            if (!reader) return;
            try {
                await reader._initPromise;
                const view = reader._internalReader?._lastView || reader._internalReader?._primaryView;
                await view?.initializedPromise;
                const pdfViewer = view?._iframeWindow?.PDFViewerApplication?.pdfViewer;
                const pageIndex = location.position?.pageIndex ?? location.pageIndex;
                // Zotero 7 resolves the reader promise before PDF.js creates its pages.
                if (pdfViewer?.getPageView && Number.isInteger(pageIndex)) {
                    for (let attempt = 0; attempt < 100 && !pdfViewer.getPageView(pageIndex); attempt++) {
                        await Zotero.Promise.delay(50);
                    }
                    if (!pdfViewer.getPageView(pageIndex)) return;
                }
                if (typeof reader.navigate === 'function') {
                    await reader.navigate(location);
                }
                this.extendEvidencePdfSpotlight(reader, location);
            } catch (e) {
                Zotero.logError(e);
            }
        },

        async openAttachmentAtLocation(attachmentId, location, window = null) {
            try {
                if (typeof Zotero.Reader?.open === 'function') {
                    const win = this.mainWindow(window);
                    if (!this.nativeSessionTab(win)) this.closeSessionsTab(win);
                    const reader = await Zotero.Reader.open(Number(attachmentId), location || null, {});
                    if (location) {
                        if (reader) this.extendEvidencePdfSpotlight(reader, location);
                        await this.focusEvidencePdfLocation(attachmentId, location);
                    }
                    return;
                }
                const pane = Zotero.getActiveZoteroPane?.();
                if (pane?.selectItem) await pane.selectItem(Number(attachmentId));
            } catch (e) {
                Zotero.logError(e);
            }
        },

        async openEvidenceInPdf(cell, range = null, window = null) {
            const attachmentId = cell?.source?.attachmentId;
            if (!attachmentId) return;
            const location = this.buildEvidencePdfLocation(cell, range);
            const page = this.firstEvidencePage(cell, range);
            await this.openAttachmentAtLocation(attachmentId, location || (page ? { pageIndex: Math.max(0, page - 1) } : null), window);
        },

        applyMatrixColumnWidths(panel, session) {
            const papers = session.paperItemIds || [];
            const cols = [`${this.matrixLabelColumnWidth(session)}px`].concat(papers.map(id => `${session.columnWidths?.[id] || 300}px`));
            const matrix = panel.querySelector('.ze-matrix');
            if (matrix) matrix.style.setProperty('--ze-grid-cols', cols.join(' '));
        },

        applyMatrixRowHeights(panel, rowId, height) {
            const handle = panel.querySelector(`.ze-matrix [data-ze-row="${rowId}"]`);
            const label = handle?.closest('.ze-label');
            if (!label) return;
            const value = `${height}px`;
            label.style.minHeight = value;
            let sibling = label.nextElementSibling;
            while (sibling && !sibling.classList?.contains('ze-label') && !sibling.classList?.contains('ze-corner') && !sibling.classList?.contains('ze-header')) {
                if (sibling.classList?.contains('ze-cell')) sibling.style.minHeight = value;
                sibling = sibling.nextElementSibling;
            }
        },

        async openQuestionPicker(sessionId, window) {
            const win = this.mainWindow(window);
            const panel = this.sessionWorkspacePanel(win, sessionId);
            if (!panel) return;
            panel._zotextractRenderVersion = (panel._zotextractRenderVersion || 0) + 1;
            panel.removeAttribute?.('data-ze-workspace-session');
            const session = await this.getSession(sessionId);
            if (!session) return;
            let questionSets = await this.loadQuestionSets();
            let activeSetId = questionSets[0]?.id || '';
            let activeQuestionId = questionSets[0]?.questions?.[0]?.id || '';
            const selectedRefs = new Set((session.questionRefs || []).map(ref => `${ref.questionSetId}:${ref.questionId}`));
            const modal = panel;
            const backToSession = async () => this.renderSessionWorkspace(session.id, win);
            let questionAutosaveTimer = null;
            let questionEditorDirty = false;
            let setEditorDirty = false;

            const activeQuestionSelectionKey = () => activeSetId && activeQuestionId ? `${activeSetId}:${activeQuestionId}` : '';

            const updateQuestionPickerSelectionUi = () => {
                const countNode = modal.querySelector?.('[data-ze-selected-question-count]');
                if (countNode) countNode.textContent = `${selectedRefs.size} selected questions`;
                modal.querySelectorAll?.('[data-ze-question-check]').forEach(toggle => {
                    const key = toggle.getAttribute('data-ze-question-check');
                    const checked = selectedRefs.has(key);
                    toggle.classList?.toggle('checked', checked);
                    toggle.textContent = checked ? '✓' : '';
                });
                modal.querySelectorAll?.('[data-ze-set-check]').forEach(toggle => {
                    const set = questionSets.find(candidate => candidate.id === toggle.getAttribute('data-ze-set-check'));
                    const questions = set?.questions || [];
                    const checked = !!questions.length && questions.every(question => selectedRefs.has(`${set.id}:${question.id}`));
                    toggle.classList?.toggle('checked', checked);
                    toggle.textContent = checked ? '✓' : '';
                });
            };

            const selectActiveQuestion = () => {
                const key = activeQuestionSelectionKey();
                if (!key || selectedRefs.has(key)) return;
                selectedRefs.add(key);
                updateQuestionPickerSelectionUi();
            };

            const updateActiveQuestionListRow = () => {
                if (!activeQuestionId) return;
                const activeSet = questionSets.find(set => String(set.id) === String(activeSetId));
                const activeQuestion = activeSet?.questions?.find(question => String(question.id) === String(activeQuestionId));
                if (!activeQuestion) return;
                const rows = Array.from(modal.querySelectorAll?.('[data-ze-question]') || []);
                const row = rows.find(candidate => candidate.getAttribute('data-ze-question') === activeQuestionId);
                if (!row) return;
                const nameNode = row.querySelector?.('[data-ze-question-row-name]');
                const promptNode = row.querySelector?.('[data-ze-question-row-prompt]');
                if (nameNode) nameNode.textContent = activeQuestion.name || 'Untitled question';
                if (promptNode) promptNode.textContent = String(activeQuestion.prompt || '').slice(0, 120);
            };

            const updateActiveSetListRow = () => {
                if (!activeSetId) return;
                const activeSet = questionSets.find(set => String(set.id) === String(activeSetId));
                if (!activeSet) return;
                const rows = Array.from(modal.querySelectorAll?.('[data-ze-set]') || []);
                const row = rows.find(candidate => candidate.getAttribute('data-ze-set') === activeSetId);
                if (!row) return;
                const nameNode = row.querySelector?.('[data-ze-set-row-name]');
                const detailNode = row.querySelector?.('[data-ze-set-row-detail]');
                if (nameNode) nameNode.textContent = activeSet.name || 'Untitled extraction set';
                if (detailNode) {
                    const count = (activeSet.questions || []).length;
                    detailNode.textContent = `${count} question${count === 1 ? '' : 's'}${activeSet.description ? ` - ${activeSet.description}` : ''}`;
                }
            };

            const applyActiveSetEditorValues = () => {
                const nameField = modal.querySelector?.('[data-ze-set-name]');
                const descriptionField = modal.querySelector?.('[data-ze-set-description]');
                if (!nameField && !descriptionField) return false;
                const changed = this.applyQuestionSetEditorValues(questionSets, activeSetId, {
                    name: nameField?.value,
                    description: descriptionField?.value
                });
                if (changed) {
                    setEditorDirty = true;
                    updateActiveSetListRow();
                }
                return changed;
            };

            const applyActiveQuestionEditorValues = () => {
                const nameField = modal.querySelector?.('[data-ze-question-name]');
                const promptField = modal.querySelector?.('[data-ze-question-prompt]');
                if (!nameField && !promptField) return false;
                const changed = this.applyQuestionEditorValues(questionSets, activeSetId, activeQuestionId, {
                    name: nameField?.value,
                    prompt: promptField?.value
                });
                if (changed) {
                    selectActiveQuestion();
                    questionEditorDirty = true;
                    updateActiveQuestionListRow();
                }
                return changed;
            };

            const flushQuestionAutosave = async (options = {}) => {
                if (questionAutosaveTimer) {
                    clearTimeout(questionAutosaveTimer);
                    questionAutosaveTimer = null;
                }
                applyActiveSetEditorValues();
                applyActiveQuestionEditorValues();
                if (!questionEditorDirty && !setEditorDirty) return false;
                questionEditorDirty = false;
                setEditorDirty = false;
                questionSets = await this.saveQuestionSets(questionSets);
                if (options.renderAfter) render();
                return true;
            };

            const scheduleQuestionAutosave = () => {
                applyActiveSetEditorValues();
                applyActiveQuestionEditorValues();
                if (!questionEditorDirty && !setEditorDirty) return;
                if (questionAutosaveTimer) clearTimeout(questionAutosaveTimer);
                questionAutosaveTimer = setTimeout(() => {
                    questionAutosaveTimer = null;
                    flushQuestionAutosave().catch(e => Zotero.logError(e));
                }, 500);
            };

            const render = () => {
                const activeSet = questionSets.find(set => set.id === activeSetId) || questionSets[0];
                activeSetId = activeSet?.id || '';
                const activeQuestion = activeSet?.questions?.find(question => question.id === activeQuestionId) || activeSet?.questions?.[0];
                activeQuestionId = activeQuestion?.id || '';
                this.setInnerHTML(modal, `
                    <div class="ze-windowbar"><span>Add extractions</span><span class="ze-muted">${(session.paperItemIds || []).length} papers in current session</span></div>
                    <div class="ze-toolbar">
                        ${this.actionHtml('Back to session', 'data-ze-back-to-session')}
                        <span class="ze-spacer"></span>
                    </div>
                    <div class="ze-picker">
                        <section class="ze-pane"><div class="ze-head"><span>Question sets</span></div><div class="ze-scroll">
                            ${questionSets.map(set => {
                                const setQuestions = set.questions || [];
                                const setChecked = setQuestions.length && setQuestions.every(question => selectedRefs.has(`${set.id}:${question.id}`));
                                return `
                                <div class="ze-list-row ${set.id === activeSetId ? 'selected' : ''}" data-ze-set="${this.htmlEscape(set.id)}">
                                    <span class="ze-check ${setChecked ? 'checked' : ''}" data-ze-set-check="${this.htmlEscape(set.id)}">${setChecked ? '✓' : ''}</span>
                                    <div class="ze-list-row-main"><strong data-ze-set-row-name>${this.htmlEscape(set.name)}</strong>
                                        <div class="ze-muted" data-ze-set-row-detail>${(set.questions || []).length} questions${set.description ? ` - ${this.htmlEscape(set.description)}` : ''}</div>
                                    </div>
                                    ${this.actionHtml('x', `data-ze-delete-set-row="${this.htmlEscape(set.id)}" title="Delete question set"`, 'ze-icon-btn ze-list-delete')}
                                </div>`;
                            }).join('')}
                            <div class="ze-list-row ze-list-add-row" data-ze-new-set-row>
                                <span class="ze-add-glyph">+</span>
                                <div class="ze-list-row-main"><strong>New question set</strong><div class="ze-muted">Create a set for related extraction questions.</div></div>
                            </div>
                        </div></section>
                        <section class="ze-pane"><div class="ze-head"><span>Questions</span></div><div class="ze-scroll">
                            ${(activeSet?.questions || []).map(question => {
                                const key = `${activeSet.id}:${question.id}`;
                                const checked = selectedRefs.has(key);
                                return `<div class="ze-list-row ${question.id === activeQuestionId ? 'selected' : ''}" data-ze-question="${this.htmlEscape(question.id)}">
                                    <span class="ze-check ${checked ? 'checked' : ''}" data-ze-question-check="${this.htmlEscape(key)}">${checked ? '✓' : ''}</span>
                                    <div class="ze-list-row-main"><strong data-ze-question-row-name>${this.htmlEscape(question.name)}</strong>
                                        <div class="ze-muted" data-ze-question-row-prompt>${this.htmlEscape(question.prompt || '').slice(0, 120)}</div>
                                    </div>
                                    ${this.actionHtml('x', `data-ze-delete-question-row="${this.htmlEscape(question.id)}" title="Delete question"`, 'ze-icon-btn ze-list-delete')}
                                </div>`;
                            }).join('')}
                            <div class="ze-list-row ze-list-add-row" data-ze-new-question-row>
                                <span class="ze-add-glyph">+</span>
                                <div class="ze-list-row-main"><strong>New question</strong><div class="ze-muted">Create the next extraction row in this set.</div></div>
                            </div>
                        </div></section>
                        <section class="ze-pane"><div class="ze-head">Extraction details <span class="ze-pill">Autosaved</span></div><div class="ze-scroll">
                            ${activeSet ? `
                                <div class="ze-form">
                                    <label for="ze-set-name">Extraction set</label>
                                    <textarea class="ze-textarea compact" id="ze-set-name" data-ze-set-name>${this.htmlEscape(activeSet.name || '')}</textarea>
                                    <label for="ze-set-description">Set description</label>
                                    <textarea class="ze-textarea compact" id="ze-set-description" data-ze-set-description placeholder="Optional note for this group of extraction questions.">${this.htmlEscape(activeSet.description || '')}</textarea>
                                    ${activeQuestion ? `
                                        <label for="ze-question-name">Question</label>
                                        <textarea class="ze-textarea compact" id="ze-question-name" data-ze-question-name>${this.htmlEscape(activeQuestion.name)}</textarea>
                                        <label for="ze-question-prompt">Prompt</label>
                                        <div>
                                            <textarea class="ze-textarea" id="ze-question-prompt" data-ze-question-prompt placeholder="Ask the domain-specific extraction question. ZotExtract will add Zotero metadata, title, abstract, indexed full text, and line-number context around it.">${this.htmlEscape(activeQuestion.prompt || '')}</textarea>
                                            <div class="ze-muted" style="margin-top:6px">Focus on what should be extracted. The settings templates add the evidence context and line-number citation instructions.</div>
                                        </div>
                                    ` : '<p class="ze-muted">Create a question in this set to edit its prompt.</p>'}
                                </div>
                            ` : '<p class="ze-muted">Create an extraction set to start adding questions.</p>'}
                        </div></section>
                    </div>
                    <div class="ze-footer">
                        <span class="ze-pill" data-ze-selected-question-count>${selectedRefs.size} selected questions</span>
                        <span class="ze-pill">${(session.paperItemIds || []).length} target papers</span>
                        <span class="ze-muted">Sets and individual questions can both be checked.</span>
                        <span class="ze-spacer"></span>
                        ${this.actionHtml('Cancel', 'data-ze-cancel')}
                        ${this.actionHtml('Add to my ZotExtract session', 'data-ze-add', 'ze-btn primary')}
                    </div>`);

                modal.querySelectorAll('[data-ze-set]').forEach(row => row.addEventListener('click', async event => {
                    if (event.target?.closest?.('[data-ze-set-check], [data-ze-delete-set-row]')) return;
                    await flushQuestionAutosave();
                    activeSetId = row.getAttribute('data-ze-set');
                    const set = questionSets.find(candidate => candidate.id === activeSetId);
                    activeQuestionId = set?.questions?.[0]?.id || '';
                    render();
                }));
                modal.querySelectorAll('[data-ze-question]').forEach(row => row.addEventListener('click', async event => {
                    if (event.target?.closest?.('[data-ze-question-check], [data-ze-delete-question-row]')) return;
                    await flushQuestionAutosave();
                    const questionId = row.getAttribute('data-ze-question');
                    activeQuestionId = questionId;
                    if (activeSetId && questionId) selectedRefs.add(`${activeSetId}:${questionId}`);
                    render();
                }));
                modal.querySelectorAll('[data-ze-question-check]').forEach(toggle => toggle.addEventListener('click', async event => {
                    event.stopPropagation();
                    await flushQuestionAutosave();
                    const key = toggle.getAttribute('data-ze-question-check');
                    if (selectedRefs.has(key)) selectedRefs.delete(key);
                    else selectedRefs.add(key);
                    render();
                }));
                modal.querySelectorAll('[data-ze-set-check]').forEach(toggle => toggle.addEventListener('click', async event => {
                    event.stopPropagation();
                    await flushQuestionAutosave();
                    const set = questionSets.find(candidate => candidate.id === toggle.getAttribute('data-ze-set-check'));
                    const allSelected = (set?.questions || []).length && (set.questions || []).every(question => selectedRefs.has(`${set.id}:${question.id}`));
                    for (const question of set?.questions || []) {
                        const key = `${set.id}:${question.id}`;
                        if (!allSelected) selectedRefs.add(key);
                        else selectedRefs.delete(key);
                    }
                    render();
                }));
                modal.querySelector('[data-ze-new-set-row]')?.addEventListener('click', async () => {
                    await flushQuestionAutosave();
                    await addSet();
                });
                modal.querySelector('[data-ze-new-question-row]')?.addEventListener('click', async () => {
                    await flushQuestionAutosave();
                    await addQuestion();
                });
                modal.querySelectorAll('[data-ze-delete-set-row]').forEach(button => button.addEventListener('click', async event => {
                    event.preventDefault();
                    event.stopPropagation();
                    await flushQuestionAutosave();
                    activeSetId = button.getAttribute('data-ze-delete-set-row');
                    await deleteSet();
                }));
                modal.querySelectorAll('[data-ze-delete-question-row]').forEach(button => button.addEventListener('click', async event => {
                    event.preventDefault();
                    event.stopPropagation();
                    await flushQuestionAutosave();
                    activeQuestionId = button.getAttribute('data-ze-delete-question-row');
                    await deleteQuestion();
                }));
                modal.querySelector('[data-ze-back-to-session]')?.addEventListener('click', async () => {
                    await flushQuestionAutosave();
                    await backToSession();
                });
                modal.querySelector('[data-ze-cancel]')?.addEventListener('click', async () => {
                    await flushQuestionAutosave();
                    await backToSession();
                });
                modal.querySelector('[data-ze-add]')?.addEventListener('click', async () => {
                    await flushQuestionAutosave();
                    const refs = Array.from(selectedRefs).map(key => {
                        const [questionSetId, questionId] = key.split(':');
                        return { questionSetId, questionId };
                    });
                    await this.addQuestionsToSession(session.id, refs);
                    await this.renderSessionWorkspace(session.id, win);
                });
                modal.querySelectorAll('[data-ze-set-name], [data-ze-set-description], [data-ze-question-name], [data-ze-question-prompt]').forEach(field => {
                    field.addEventListener('input', scheduleQuestionAutosave);
                    field.addEventListener('change', () => flushQuestionAutosave().catch(e => Zotero.logError(e)));
                    field.addEventListener('blur', () => flushQuestionAutosave().catch(e => Zotero.logError(e)));
                });
            };

            const addSet = async () => {
                const now = this.nowIso();
                const set = {
                    id: this.makeId('question-set'),
                    name: 'New extraction set',
                    description: '',
                    questions: [],
                    createdAt: now,
                    updatedAt: now
                };
                questionSets.push(set);
                questionSets = await this.saveQuestionSets(questionSets);
                activeSetId = set.id;
                activeQuestionId = '';
                render();
                const setName = modal.querySelector?.('[data-ze-set-name]');
                setName?.focus?.();
                setName?.select?.();
            };

            const addQuestion = async () => {
                let set = questionSets.find(candidate => candidate.id === activeSetId);
                if (!set) {
                    await addSet();
                    set = questionSets.find(candidate => candidate.id === activeSetId);
                }
                const now = this.nowIso();
                const question = {
                    id: this.makeId('question'),
                    name: 'New question',
                    prompt: '',
                    createdAt: now,
                    updatedAt: now
                };
                set.questions.push(question);
                set.updatedAt = now;
                questionSets = await this.saveQuestionSets(questionSets);
                activeQuestionId = question.id;
                render();
                const questionName = modal.querySelector?.('[data-ze-question-name]');
                questionName?.focus?.();
                questionName?.select?.();
            };

            const forgetDeletedSelections = deletedQuestions => {
                for (const entry of deletedQuestions || []) {
                    selectedRefs.delete(`${entry.questionSetId}:${entry.questionId}`);
                }
            };

            const deleteSet = async () => {
                if (!activeSetId) return;
                const result = await this.deleteQuestionSetFromLibrary(activeSetId);
                if (!result) return;
                questionSets = result.questionSets || [];
                forgetDeletedSelections(result.deletedQuestions);
                activeSetId = questionSets[0]?.id || '';
                activeQuestionId = questionSets[0]?.questions?.[0]?.id || '';
                render();
            };

            const deleteQuestion = async () => {
                if (!activeSetId || !activeQuestionId) return;
                const result = await this.deleteQuestionFromLibrary(activeSetId, activeQuestionId);
                if (!result) return;
                questionSets = result.questionSets || [];
                forgetDeletedSelections(result.deletedQuestions);
                const activeSet = questionSets.find(set => String(set.id) === String(activeSetId)) || questionSets[0];
                activeSetId = activeSet?.id || '';
                activeQuestionId = activeSet?.questions?.[0]?.id || '';
                render();
            };

            render();
        },
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractEvidenceUI);
}
