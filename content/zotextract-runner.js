var ZotExtractRunner = {
        buildSessionSourceMetadata(item, attachment, provider, questionSnapshot, warnings) {
            return {
                zoteroItemId: item.id,
                title: this.itemTitle(item),
                doi: this.itemDoi(item),
                attachmentId: attachment ? attachment.id : null,
                attachmentFilename: attachment ? (attachment.attachmentFilename || (attachment.getField ? attachment.getField('title') : '') || 'document.pdf') : '',
                promptId: questionSnapshot.questionId || questionSnapshot.id,
                promptName: questionSnapshot.questionName || questionSnapshot.name,
                questionSetId: questionSnapshot.questionSetId || '',
                questionSetName: questionSnapshot.questionSetName || '',
                model: provider.model || '',
                providerName: provider.name || '',
                contextMode: 'two-pass-evidence',
                extractedAt: new Date().toISOString(),
                schemaId: this.schemaId,
                schemaVersion: this.schemaVersion,
                warnings: warnings || []
            };
        },

        questionExpectsJson(questionSnapshot, promptText) {
            const explicit = String(questionSnapshot?.output || questionSnapshot?.responseFormat || '').trim().toLowerCase();
            if (explicit === 'json') return true;
            if (explicit === 'text') return false;
            return true;
        },

        slimLineSourceMap(sourceMap) {
            if (!sourceMap?.records?.length) return sourceMap || null;
            return {
                version: sourceMap.version || 1,
                source: sourceMap.source || '',
                hasCoordinates: !!sourceMap.hasCoordinates,
                records: sourceMap.records.map(record => ({
                    id: record.id,
                    lineNumber: record.lineNumber,
                    page: record.page || null,
                    rects: record.rects || []
                }))
            };
        },

        async processSessionCell(session, item, questionSnapshot, provider, runState) {
            const startedAt = this.nowIso();
            const { attachment, context } = await this.cachedMaximumContextForItem(item, provider, runState?.contextCache);
            const promptText = questionSnapshot.prompt || '';
            let preparedContext = await this.prepareContextForQuestion(provider, context, promptText, runState);
            const source = this.buildSessionSourceMetadata(item, attachment, provider, questionSnapshot, preparedContext.warnings);
            let answer = '';
            try {
                answer = await this.callWithProgress(provider, preparedContext.text, promptText, runState);
            } catch (e) {
                if (!this.isContextSizeError(e)) throw e;
                const retryProvider = this.conservativeRetryProvider(provider);
                const retryMode = preparedContext.evidenceCollectionMode || (preparedContext.usedSlidingWindow ? 'sliding-window' : 'evidence-context');
                preparedContext = await this.prepareContextForQuestion(retryProvider, {
                    ...context,
                    warnings: [
                        ...(preparedContext.warnings || []),
                        `Provider rejected the ${retryMode} request as too large (${e.message || String(e)}). ZotExtract retried with smaller line-numbered evidence windows.`
                    ]
                }, promptText, runState, { forceSliding: true });
                source.warnings = preparedContext.warnings || [];
                try {
                    answer = await this.callWithProgress(provider, preparedContext.text, promptText, runState);
                } catch (retryError) {
                    if (!this.isContextSizeError(retryError)) throw retryError;
                    preparedContext = this.metadataOnlyFallbackContext({
                        ...context,
                        warnings: preparedContext.warnings || []
                    }, `Provider rejected the smaller evidence-context request as too large (${retryError.message || String(retryError)}). ZotExtract used metadata only.`);
                    source.warnings = preparedContext.warnings || [];
                    answer = await this.callWithProgress(provider, preparedContext.text, promptText, runState);
                }
            }
            const expectsJson = this.questionExpectsJson(questionSnapshot, promptText);
            const selection = {
                label: questionSnapshot.questionName || questionSnapshot.name,
                promptId: questionSnapshot.questionId || questionSnapshot.id,
                promptText,
                context: 'maximum-available-context',
                output: expectsJson ? 'json' : 'text'
            };
            const structured = this.buildStructuredResult(answer, source, selection, preparedContext.chunks, preparedContext);
            const needsReview = structured.validation?.requestedJson && !structured.validation?.parsed;
            const warnings = needsReview
                ? [
                    ...(preparedContext.warnings || []),
                    `Structured JSON did not parse: ${structured.validation.error || 'unknown parse error'}`
                ]
                : (preparedContext.warnings || []);
            source.warnings = warnings;
            structured.source = source;
            return {
                sessionId: session.id,
                itemId: item.id,
                questionId: questionSnapshot.questionId || questionSnapshot.id,
                questionSnapshot,
                paperSnapshot: {
                    zoteroItemId: item.id,
                    title: this.itemTitle(item),
                    abstract: this.itemAbstract(item),
                    doi: this.itemDoi(item)
                },
                answer,
                structured,
                lineSourceMap: this.slimLineSourceMap(preparedContext.lineSourceMap),
                warnings,
                source,
                startedAt,
                completedAt: this.nowIso(),
                status: needsReview ? 'needs-review' : 'completed'
            };
        },

        confirmSessionEstimate(session, provider, questions, jobs = null) {
            const itemCount = (session.paperItemIds || []).length;
            const questionCount = questions.length;
            const total = Array.isArray(jobs) ? jobs.length : itemCount * questionCount;
            const timeoutSeconds = Math.round(this.requestTimeoutMs(provider) / 1000);
            const maxTextCharacters = this.maxTextCharactersForProvider(provider);
            const lines = [
                `Run ${total} pending extraction cell(s)?`,
                `Session scope: ${questionCount} question(s) on ${itemCount} paper(s). Existing completed, review, and failed cells are kept unless removed.`,
                `Context: Zotero metadata plus indexed PDF full text when available.`,
                `Full-text cap: ${maxTextCharacters.toLocaleString()} characters per paper.`,
                `Timeout: ${timeoutSeconds}s per extraction.`
            ];
            const totalInputTokens = Math.ceil(maxTextCharacters / 4) * total;
            const cost = this.estimateUsdCost(provider.model, totalInputTokens);
            if (cost) lines.push(`Rough worst-case input cost estimate: ${cost}. Output tokens may add cost.`);
            lines.push('Continue?');
            if (Services.prompt && typeof Services.prompt.confirm === 'function') {
                return Services.prompt.confirm(null, 'ZotExtract session estimate', lines.join('\n'));
            }
            return true;
        },

        resultCellNeedsRun(cell) {
            if (!cell) return true;
            return !['completed', 'needs-review', 'failed'].includes(String(cell.status || '').toLowerCase());
        },

        sessionRunJobs(session, questions, cells) {
            const cellKey = cell => `${cell.itemId}:${cell.questionId}`;
            const byKey = new Map((cells || []).map(cell => [cellKey(cell), cell]));
            const jobs = [];
            for (const itemId of session.paperItemIds || []) {
                for (const question of questions || []) {
                    const key = `${itemId}:${question.questionId}`;
                    if (this.resultCellNeedsRun(byKey.get(key))) jobs.push({ itemId, question });
                }
            }
            return jobs;
        },

        localConcurrencyStrategy(provider) {
            if (!this.isLocalProvider(provider)) return 'configured';
            const id = this.inferProviderId(provider);
            if (id === 'ollama') return 'server-managed';
            return 'context-aware';
        },

        contextAwareConcurrentRequests(provider, configured, requestInfo) {
            const rawConfigured = Number(configured);
            const configuredLimit = Number.isFinite(rawConfigured) && rawConfigured > 0
                ? Math.max(1, Math.min(16, Math.round(rawConfigured)))
                : this.concurrentRequests(provider);
            const totalTokens = Number(requestInfo?.totalTokens ?? requestInfo?.tokens ?? requestInfo);
            if (!Number.isFinite(totalTokens) || totalTokens <= 0) return 1;
            const contextWindow = this.effectiveContextWindowTokens(provider);
            if (!Number.isFinite(contextWindow) || contextWindow <= 0) return 1;
            const aggregateWindow = Math.floor(contextWindow * (requestInfo?.exact ? 0.9 : 0.8));
            return Math.max(1, Math.min(configuredLimit, Math.floor(aggregateWindow / totalTokens)));
        },

        async planRunConcurrency(provider, jobs) {
            const configured = Math.min(this.concurrentRequests(provider), Math.max(1, jobs.length));
            const contextCache = new Map();
            const progressPlan = await this.estimateRunPromptPlan(provider, jobs, contextCache);
            if (configured <= 1 || !this.isLocalProvider(provider)) {
                return { concurrency: configured, contextCache, strategy: 'configured', progressPlan };
            }

            const strategy = this.localConcurrencyStrategy(provider);
            if (strategy === 'server-managed') {
                return { concurrency: configured, contextCache, strategy, progressPlan };
            }

            const estimate = progressPlan.maxRequestInfo || { tokens: 0, totalTokens: 0, exact: false, method: 'none' };
            const concurrency = this.contextAwareConcurrentRequests(provider, configured, estimate);
            Zotero.debug(`[ZotExtract] Planned ${concurrency}/${configured} concurrent request(s) for ${this.inferProviderId(provider) || 'local provider'} using ${estimate?.totalTokens || 0} estimated tokens/request.`);
            return { concurrency, contextCache, strategy, estimate, progressPlan };
        },

        async cachedMaximumContextForItem(item, provider, contextCache = null) {
            const key = String(item?.id || '');
            if (contextCache && key && contextCache.has(key)) return contextCache.get(key);
            const attachment = await this.bestPdfAttachment(item);
            const context = await this.buildMaximumContext(item, attachment, provider);
            const entry = { attachment, context };
            if (contextCache && key) contextCache.set(key, entry);
            return entry;
        },

        async estimateMaxRunRequestTokens(provider, jobs, contextCache = new Map()) {
            return (await this.estimateRunPromptPlan(provider, jobs, contextCache)).maxRequestInfo;
        },

        async estimateRunPromptPlan(provider, jobs, contextCache = new Map()) {
            let maxInfo = null;
            let totalPrompts = 0;
            const paperIds = new Set();
            for (const job of jobs || []) {
                paperIds.add(String(job.itemId));
                const item = await this.getItemById(job.itemId);
                if (!item) continue;
                const { context } = await this.cachedMaximumContextForItem(item, provider, contextCache);
                const info = await this.estimateCellRequestTokens(provider, context, job.question?.prompt || '');
                totalPrompts += Math.max(1, Number(info.plannedPrompts || 1));
                if (!maxInfo || Number(info.totalTokens || 0) > Number(maxInfo.totalTokens || 0)) {
                    maxInfo = info;
                }
            }
            return {
                maxRequestInfo: maxInfo || { tokens: 0, totalTokens: 0, exact: false, method: 'none' },
                totalPrompts: Math.max(jobs?.length || 0, totalPrompts),
                totalPapers: paperIds.size
            };
        },

        async estimateCellRequestTokens(provider, context, promptText) {
            const directInfo = await this.requestInputTokenInfo(provider, context?.text || '', promptText);
            const directTotal = directInfo.tokens + this.maxCompletionTokens(provider);
            if (!context?.fullText) return { ...directInfo, totalTokens: directTotal, mode: 'metadata-only', plannedPrompts: 1 };
            const budgetTokens = this.contextBudgetTokens(provider, promptText);
            const lines = context.lineSourceMap?.records?.length ? context.lineSourceMap.records : this.lineNumberText(context.fullText);
            const scanInfo = await this.estimateSlidingScanRequestTokens(provider, lines, promptText, budgetTokens);
            return scanInfo.totalTokens ? scanInfo : { ...directInfo, totalTokens: directTotal, mode: 'metadata-only', plannedPrompts: 1 };
        },

        async estimateSlidingScanRequestTokens(provider, numberedLines, promptText, budgetTokens) {
            const plan = await this.evidenceCollectionWindowPlan(provider, numberedLines || [], promptText, budgetTokens);
            const windows = plan.windows || [];
            if (!windows.length) return { tokens: 0, totalTokens: 0, exact: false, method: 'none', mode: 'metadata-only', plannedPrompts: 1 };

            const scanProvider = {
                ...provider,
                maxCompletionTokens: Math.min(this.maxCompletionTokens(provider), 500)
            };
            const candidates = windows
                .slice()
                .sort((a, b) => String(b.text || '').length - String(a.text || '').length)
                .slice(0, Math.min(3, windows.length));
            let maxInfo = null;
            for (const window of candidates) {
                const prompt = this.renderPromptTemplate(this.chunkPromptTemplate(provider), {
                    question: promptText || '',
                    context: window.text,
                    windowIndex: window.index,
                    windowCount: windows.length,
                    windowRange: window.range
                });
                const info = await this.requestInputTokenInfo(scanProvider, window.text, prompt, { rawUserPrompt: true });
                const totalTokens = info.tokens + this.maxCompletionTokens(scanProvider);
                const candidate = {
                    ...info,
                    totalTokens,
                    mode: plan.mode || (windows.length > 1 ? 'sliding-window' : 'single-window'),
                    windowCount: windows.length,
                    plannedPrompts: windows.length + 1
                };
                if (!maxInfo || totalTokens > maxInfo.totalTokens) maxInfo = candidate;
            }
            return maxInfo || { tokens: 0, totalTokens: 0, exact: false, method: 'none', mode: plan.mode || 'single-window', windowCount: windows.length, plannedPrompts: windows.length + 1 };
        },

        createSessionProgressState(progressPlan, jobs) {
            const remainingJobsByPaper = new Map();
            for (const job of jobs || []) {
                const key = String(job.itemId);
                remainingJobsByPaper.set(key, (remainingJobsByPaper.get(key) || 0) + 1);
            }
            return {
                paperDone: 0,
                paperTotal: Math.max(1, Number(progressPlan?.totalPapers || remainingJobsByPaper.size || 1)),
                promptDone: 0,
                promptTotal: Math.max(1, Number(progressPlan?.totalPrompts || (jobs || []).length || 1)),
                remainingJobsByPaper,
                currentLabel: ''
            };
        },

        progressUpdateOptions(runState) {
            const progress = runState?.progress || {};
            return {
                barDone: progress.promptDone || 0,
                barTotal: progress.promptTotal || 1,
                unit: Number(progress.paperTotal) === 1 ? 'paper' : 'papers'
            };
        },

        advanceSessionPromptProgress(runState, steps = 1, label = '') {
            const progress = runState?.progress;
            if (!progress) return;
            progress.promptDone = Math.min(progress.promptTotal, (progress.promptDone || 0) + Math.max(1, Number(steps) || 1));
            if (label) progress.currentLabel = label;
            this.updateSessionProgress(progress.paperDone || 0, progress.paperTotal || 1, progress.currentLabel || '', this.progressUpdateOptions(runState));
        },

        markSessionJobComplete(runState, itemId, label = '') {
            const progress = runState?.progress;
            if (!progress) return;
            const key = String(itemId);
            const remaining = Math.max(0, (progress.remainingJobsByPaper?.get(key) || 1) - 1);
            if (progress.remainingJobsByPaper) progress.remainingJobsByPaper.set(key, remaining);
            if (remaining === 0) progress.paperDone = Math.min(progress.paperTotal, (progress.paperDone || 0) + 1);
            if (label) progress.currentLabel = label;
            this.updateSessionProgress(progress.paperDone || 0, progress.paperTotal || 1, progress.currentLabel || '', this.progressUpdateOptions(runState));
        },

        async callWithProgress(provider, text, promptText, runState, options = {}) {
            try {
                return await this.callWithText(provider, text, promptText, runState, options);
            } finally {
                this.advanceSessionPromptProgress(runState, 1, runState?.progress?.currentLabel || '');
            }
        },

        async runSession(sessionId) {
            let session = await this.getSession(sessionId);
            if (!session) {
                Services.prompt.alert(null, 'ZotExtract', 'Could not find the ZotExtract session.');
                return null;
            }
            let provider = this.getProviderSettings();
            provider = await this.resolveProviderContext(provider, { refresh: true });
            const questions = await this.resolveQuestionRefs(session.questionRefs);
            if (!questions.length) {
                Services.prompt.alert(null, 'ZotExtract', 'Add at least one question to this session first.');
                return null;
            }
            if (!(session.paperItemIds || []).length) {
                Services.prompt.alert(null, 'ZotExtract', 'Add at least one paper to this session first.');
                return null;
            }
            const validation = this.validateProviderSettings(provider);
            if (!validation.valid) {
                Services.prompt.alert(null, 'ZotExtract configuration', validation.errors.join('\n'));
                return null;
            }

            const previousCells = await this.readResultCells(session.id);
            const cellKey = cell => `${cell.itemId}:${cell.questionId}`;
            const byKey = new Map(previousCells.map(cell => [cellKey(cell), cell]));
            const jobs = this.sessionRunJobs(session, questions, previousCells);
            if (!jobs.length) {
                Services.prompt.alert(null, 'ZotExtract', 'No pending extraction cells to run. Existing results are kept; remove a question, paper, or result cell to run it again.');
                return { session, cells: previousCells };
            }
            if (!this.confirmSessionEstimate(session, provider, questions, jobs)) return null;

            this.activeSessionRuns.add(session.id);
            session.status = 'running';
            this.markSessionExportStale(session);
            session.questionSnapshots = questions.map(question => ({ ...question, snapshottedAt: this.nowIso() }));
            session = await this.saveSession(session);
            await this.refreshSessionWorkspace(session.id);

            const concurrencyPlan = await this.planRunConcurrency(provider, jobs);
            const concurrency = Math.min(concurrencyPlan.concurrency, Math.max(1, jobs.length));
            const runState = {
                cancelled: false,
                controller: null,
                controllers: new Set(),
                cancelWaiters: new Set(),
                contextCache: concurrencyPlan.contextCache || new Map(),
                progress: this.createSessionProgressState(concurrencyPlan.progressPlan, jobs)
            };
            const runProvider = {
                ...provider,
                activeConcurrentRequests: concurrency
            };
            let nextJob = 0;
            let completed = 0;
            let failed = 0;
            let review = 0;
            let writeQueue = Promise.resolve();
            const queuePersistCells = () => {
                const snapshot = Array.from(byKey.values());
                writeQueue = writeQueue.then(() => this.writeResultCells(session.id, snapshot));
                return writeQueue;
            };

            this.showSessionProgress(runState.progress.paperTotal, runState);
            const worker = async () => {
                while (!runState.cancelled) {
                    const job = jobs[nextJob++];
                    if (!job) break;
                    const { itemId, question } = job;
                    let item = null;
                    let paperLabel = String(itemId);
                    try {
                        item = await this.getItemById(itemId);
                        this.throwIfRunCancelled(runState);
                        if (!item) throw new Error(`Could not find Zotero item ${itemId}.`);
                        paperLabel = this.itemTitle(item);
                        runState.progress.currentLabel = paperLabel;
                        this.updateSessionProgress(runState.progress.paperDone, runState.progress.paperTotal, paperLabel, this.progressUpdateOptions(runState));
                        const runningCell = {
                            sessionId: session.id,
                            itemId,
                            questionId: question.questionId,
                            questionSnapshot: question,
                            answer: '',
                            structured: null,
                            warnings: [],
                            source: null,
                            startedAt: this.nowIso(),
                            status: 'running'
                        };
                        byKey.set(cellKey(runningCell), runningCell);
                        this.updateOpenResultCell(session.id, runningCell);
                        await queuePersistCells();
                        const cell = await this.processSessionCell(session, item, question, runProvider, runState);
                        if (cell.status === 'needs-review') review++;
                        byKey.set(cellKey(cell), cell);
                        this.updateOpenResultCell(session.id, cell);
                        await queuePersistCells();
                    } catch (e) {
                        failed++;
                        const failedCell = {
                            sessionId: session.id,
                            itemId,
                            questionId: question.questionId,
                            questionSnapshot: question,
                            answer: '',
                            structured: null,
                            warnings: [],
                            source: null,
                            startedAt: this.nowIso(),
                            completedAt: this.nowIso(),
                            status: runState.cancelled ? 'cancelled' : 'failed',
                            error: e.message || String(e)
                        };
                        byKey.set(`${itemId}:${question.questionId}`, failedCell);
                        this.updateOpenResultCell(session.id, failedCell);
                        await queuePersistCells();
                        if (!runState.cancelled) Zotero.logError(e);
                    } finally {
                        completed++;
                        this.markSessionJobComplete(runState, itemId, paperLabel);
                    }
                }
            };
            await Promise.all(Array.from({ length: concurrency }, () => worker()));
            await writeQueue;

            const cells = Array.from(byKey.values());
            await this.writeResultCells(session.id, cells);
            session.status = runState.cancelled ? 'draft' : 'completed';
            session.completedAt = this.nowIso();
            session = await this.saveSession(session);
            this.activeSessionRuns.delete(session.id);
            this.finishSessionProgress(runState.cancelled, runState.progress.paperDone, failed, review, runState.progress.paperTotal);
            await this.refreshSessionWorkspace(session.id);
            return { session, cells };
        },

        async rerunSessionCell(sessionId, itemId, questionId) {
            let session = await this.getSession(sessionId);
            if (!session) {
                Services.prompt.alert(null, 'ZotExtract', 'Could not find the ZotExtract session.');
                return null;
            }
            if (String(session.status || '').toLowerCase() === 'running') {
                Services.prompt.alert(null, 'ZotExtract', 'Wait for the current session run to finish before rerunning a cell.');
                return null;
            }

            const normalizedItemId = Number.isFinite(Number(itemId)) ? Number(itemId) : itemId;
            const item = await this.getItemById(normalizedItemId);
            if (!item) {
                Services.prompt.alert(null, 'ZotExtract', `Could not find Zotero item ${itemId}.`);
                return null;
            }

            let provider = this.getProviderSettings();
            provider = await this.resolveProviderContext(provider, { refresh: true });
            const validation = this.validateProviderSettings(provider);
            if (!validation.valid) {
                Services.prompt.alert(null, 'ZotExtract configuration', validation.errors.join('\n'));
                return null;
            }

            const questions = await this.resolveQuestionRefs(session.questionRefs);
            const question = questions.find(candidate => String(candidate.questionId) === String(questionId));
            if (!question) {
                Services.prompt.alert(null, 'ZotExtract', 'Could not find that extraction question in this session.');
                return null;
            }

            const cellKey = cell => `${cell.itemId}:${cell.questionId}`;
            const targetKey = `${normalizedItemId}:${question.questionId}`;
            const byKey = new Map((await this.readResultCells(session.id)).map(cell => [cellKey(cell), cell]));
            const contextCache = new Map();
            const progressPlan = await this.estimateRunPromptPlan(provider, [{ itemId: normalizedItemId, question }], contextCache);
            const runState = {
                cancelled: false,
                controller: null,
                controllers: new Set(),
                cancelWaiters: new Set(),
                contextCache,
                progress: this.createSessionProgressState(progressPlan, [{ itemId: normalizedItemId, question }])
            };
            const runProvider = {
                ...provider,
                activeConcurrentRequests: 1
            };
            const paperLabel = this.itemTitle(item);

            this.activeSessionRuns.add(session.id);
            session.status = 'running';
            this.markSessionExportStale(session);
            session.questionSnapshots = questions.map(candidate => ({ ...candidate, snapshottedAt: this.nowIso() }));
            session = await this.saveSession(session);

            const persistCells = async () => {
                const cells = Array.from(byKey.values());
                await this.writeResultCells(session.id, cells);
                return cells;
            };
            const runningCell = {
                sessionId: session.id,
                itemId: normalizedItemId,
                questionId: question.questionId,
                questionSnapshot: question,
                answer: '',
                structured: null,
                warnings: [],
                source: null,
                startedAt: this.nowIso(),
                status: 'running'
            };
            byKey.set(targetKey, runningCell);
            this.updateOpenResultCell(session.id, runningCell);
            await persistCells();

            let failed = 0;
            let review = 0;
            let completedCell = null;
            this.showSessionProgress(runState.progress.paperTotal, runState);
            this.updateSessionProgress(0, runState.progress.paperTotal, paperLabel, this.progressUpdateOptions(runState));
            try {
                completedCell = await this.processSessionCell(session, item, question, runProvider, runState);
                if (completedCell.status === 'needs-review') review++;
                byKey.set(cellKey(completedCell), completedCell);
                this.updateOpenResultCell(session.id, completedCell);
                await persistCells();
            } catch (e) {
                failed++;
                completedCell = {
                    sessionId: session.id,
                    itemId: normalizedItemId,
                    questionId: question.questionId,
                    questionSnapshot: question,
                    answer: '',
                    structured: null,
                    warnings: [],
                    source: null,
                    startedAt: runningCell.startedAt,
                    completedAt: this.nowIso(),
                    status: runState.cancelled ? 'cancelled' : 'failed',
                    error: e.message || String(e)
                };
                byKey.set(targetKey, completedCell);
                this.updateOpenResultCell(session.id, completedCell);
                await persistCells();
                if (!runState.cancelled) Zotero.logError(e);
            } finally {
                this.markSessionJobComplete(runState, normalizedItemId, paperLabel);
            }

            const cells = await persistCells();
            session.status = runState.cancelled ? 'draft' : 'completed';
            session.completedAt = this.nowIso();
            session = await this.saveSession(session);
            this.activeSessionRuns.delete(session.id);
            this.finishSessionProgress(runState.cancelled, runState.progress.paperDone, failed, review, runState.progress.paperTotal);
            await this.refreshSessionWorkspace(session.id);
            return { session, cells, cell: completedCell };
        },

        cancelledRequestError() {
            return new Error('Request cancelled by user.');
        },

        throwIfRunCancelled(runState) {
            if (runState?.cancelled) throw this.cancelledRequestError();
        },

        runCancellationWaiter(runState) {
            if (!runState) return null;
            this.throwIfRunCancelled(runState);
            if (!runState.cancelWaiters) runState.cancelWaiters = new Set();
            let rejectWaiter = null;
            const promise = new Promise((resolve, reject) => {
                rejectWaiter = reject;
            });
            const waiter = error => rejectWaiter(error || this.cancelledRequestError());
            runState.cancelWaiters.add(waiter);
            return { promise, waiter };
        },

        releaseRunCancellationWaiter(runState, waiter) {
            if (runState?.cancelWaiters && waiter) runState.cancelWaiters.delete(waiter);
        },

        cancelRunState(runState) {
            if (!runState) return;
            runState.cancelled = true;
            const error = this.cancelledRequestError();
            for (const waiter of Array.from(runState.cancelWaiters || [])) {
                try {
                    waiter(error);
                } catch (e) {
                    Zotero.logError(e);
                }
            }
            runState.cancelWaiters?.clear?.();
            if (runState.controllers) {
                for (const controller of Array.from(runState.controllers)) {
                    try {
                        controller.abort();
                    } catch (_) {}
                }
            } else if (runState.controller) {
                try {
                    runState.controller.abort();
                } catch (_) {}
            }
        },

        configuredConcurrentRequests(provider) {
            const raw = Number(provider?.concurrentRequests);
            if (!Number.isFinite(raw) || raw <= 0) return 4;
            return Math.max(1, Math.min(16, Math.round(raw)));
        },

        concurrentRequests(provider) {
            return this.configuredConcurrentRequests(provider);
        },

        maxTextCharactersForProvider(provider) {
            if (typeof ZotExtractProviderSettings !== 'undefined' && ZotExtractProviderSettings.normalizeMaxTextCharacters) {
                return ZotExtractProviderSettings.normalizeMaxTextCharacters(provider?.maxTextCharacters);
            }
            const raw = Number(provider?.maxTextCharacters);
            if (!Number.isFinite(raw) || raw <= 0) return this.defaultMaxTextCharacters || this.maxTextCharacters || 400000;
            return Math.max(10000, Math.min(2000000, Math.round(raw)));
        },
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractRunner);
}
