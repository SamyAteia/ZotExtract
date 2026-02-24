if (!ZotExtract) {
    var ZotExtract = {
        id: null,
        version: null,
        rootURI: null,
        initialized: false,
        addedElementIDs: [],
        PREFS: {
            provider: 'extensions.zotextract.provider',
            prompts: 'extensions.zotextract.prompts',
            apiKey: 'extensions.zotextract.apiKey',
            model: 'extensions.zotextract.model'
        },
        defaultSystemPrompt: 'You are a helpful research assistant. Answer the user question based on the provided context. Format in HTML suitable for a Zotero note.',

        init({ id, version, rootURI }) {
            if (this.initialized) return;
            this.id = id;
            this.version = version;
            this.rootURI = rootURI;
            this.initialized = true;
        },

        async addToAllWindows() {
            var windows = Zotero.getMainWindows();
            for (let win of windows) {
                if (!win.ZotExtract) {
                    this.addToWindow(win);
                }
            }
        },

        addToWindow(window) {
            let doc = window.document;
            let popup = doc.getElementById('zotero-itemmenu');
            if (popup) {
                let menuitem = doc.createXULElement('menuitem');
                menuitem.setAttribute('id', 'zotero-itemmenu-llm');
                menuitem.setAttribute('label', 'ZotExtract');
                menuitem.setAttribute('class', 'menuitem-iconic');
                menuitem.addEventListener('command', () => {
                    this.askLLM(Zotero.getActiveZoteroPane().getSelectedItems());
                });
                popup.appendChild(menuitem);
                this.addedElementIDs.push('zotero-itemmenu-llm');
            }
        },

        removeFromAllWindows() {
            var windows = Zotero.getMainWindows();
            for (let win of windows) {
                this.removeFromWindow(win);
            }
        },

        removeFromWindow(window) {
            let doc = window.document;
            for (let id of this.addedElementIDs) {
                let elem = doc.getElementById(id);
                if (elem) elem.remove();
            }
        },

        /**
         * Process selected items with LLM (works for single or multiple items)
         */
        async askLLM(items) {
            if (!items || items.length === 0) {
                Services.prompt.alert(null, 'ZotExtract', 'No items selected.');
                return;
            }

            // Filter to only regular items (not notes, attachments, etc.)
            const regularItems = items.filter(item => item.isRegularItem());
            if (regularItems.length === 0) {
                Services.prompt.alert(null, 'ZotExtract', 'No regular items selected. Please select items with PDF attachments.');
                return;
            }

            const provider = this.getProviderSettings();
            const selection = this.pickPrompt();
            if (!selection) return;

            // Track results
            const results = { success: 0, failed: 0, skipped: 0, errors: [] };
            const total = regularItems.length;

            // Create progress indicator as a floating bar at bottom of window
            const win = Zotero.getMainWindow();
            const doc = win.document;
            
            // Remove any existing progress bar
            const existing = doc.getElementById('zotextract-progress');
            if (existing) existing.remove();
            
            // Create progress container
            const progressDiv = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
            progressDiv.id = 'zotextract-progress';
            progressDiv.style.cssText = `
                position: fixed;
                bottom: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: #333;
                color: #fff;
                padding: 10px 20px;
                border-radius: 8px;
                font-size: 13px;
                z-index: 99999;
                display: flex;
                align-items: center;
                gap: 12px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            `;
            
            const labelSpan = doc.createElementNS('http://www.w3.org/1999/xhtml', 'span');
            labelSpan.textContent = `LLM: 0/${total}`;
            
            const barContainer = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
            barContainer.style.cssText = 'width: 200px; height: 8px; background: #555; border-radius: 4px; overflow: hidden;';
            
            const barFill = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
            barFill.style.cssText = 'width: 0%; height: 100%; background: #4CAF50; transition: width 0.3s;';
            
            barContainer.appendChild(barFill);
            progressDiv.appendChild(labelSpan);
            progressDiv.appendChild(barContainer);
            doc.documentElement.appendChild(progressDiv);

            // Process items sequentially
            for (let i = 0; i < total; i++) {
                const item = regularItems[i];
                const itemTitle = item.getField('title') || `Item ${item.id}`;
                const shortTitle = itemTitle.length > 30 ? itemTitle.substring(0, 27) + '...' : itemTitle;

                // Update progress indicator
                const percent = Math.round(((i + 1) / total) * 100);
                labelSpan.textContent = `LLM: ${i + 1}/${total} - ${shortTitle}`;
                barFill.style.width = `${percent}%`;

                try {
                    const result = await this.processItem(item, provider, selection);
                    if (result.skipped) {
                        results.skipped++;
                    } else {
                        results.success++;
                    }
                } catch (e) {
                    results.failed++;
                    results.errors.push({ title: itemTitle, error: e.message });
                    Zotero.logError(`ZotExtract error for "${itemTitle}": ${e.message}`);
                }

                // Small delay between API calls to avoid rate limiting
                if (i < total - 1) {
                    await Zotero.Promise.delay(500);
                }
            }

            // Show completion state briefly, then remove
            labelSpan.textContent = `✓ Complete: ${results.success} done, ${results.failed} failed, ${results.skipped} skipped`;
            barFill.style.width = '100%';
            barFill.style.background = '#4CAF50';
            
            // Remove progress bar after 3 seconds
            setTimeout(() => {
                if (progressDiv.parentNode) progressDiv.remove();
            }, 3000);
        },

        /**
         * Process a single item with LLM
         * Returns { skipped: boolean, reason?: string } or throws on error
         */
        async processItem(item, provider, selection) {
            // Get best attachment
            const attachment = await item.getBestAttachment();
            if (!attachment) {
                return { skipped: true, reason: 'No attachment' };
            }

            // Check if it's a PDF
            const contentType = attachment.attachmentContentType || attachment.contentType;
            if (contentType !== 'application/pdf') {
                return { skipped: true, reason: 'Not a PDF' };
            }

            // Process with LLM
            let answer;
            if (selection.context === 'pdf-file') {
                answer = await this.callWithPDF(provider, attachment, selection.promptText);
            } else {
                const text = await this.getFullText(attachment.id);
                answer = await this.callWithText(provider, text, selection.promptText);
            }

            // Create note with prompt name as heading
            let note = new Zotero.Item('note');
            const escapedAnswer = this.htmlEscape(answer || '').replace(/\n/g, '<br>');
            note.setNote(
                `<h1>${this.htmlEscape(selection.label)}</h1>` +
                `<p>${escapedAnswer}</p>`
            );
            note.parentID = item.id;
            await note.saveTx();

            return { skipped: false };
        },

        pickPrompt() {
            const prompts = this.getPrompts();
            const labels = prompts.map(p => {
                const context = p.context === 'pdf-file' ? 'PDF file' : 'Full text';
                return `${p.name} · ${context}`;
            });
            labels.push('Custom question…');

            const selectedIndex = { value: 0 };
            
            // For nsIPromptService.select, we need to pass the array properly
            const ok = Services.prompt.select(
                null,
                'ZotExtract',
                'Choose a saved prompt or pick "Custom question…" to type one.',
                labels,
                selectedIndex
            );

            if (!ok) return null;
            if (selectedIndex.value === labels.length - 1) {
                // Use Services.prompt.prompt for custom question input
                const customInput = { value: '' };
                const customOk = Services.prompt.prompt(
                    null,
                    'Custom Question',
                    'What do you want to ask?',
                    customInput,
                    null,
                    { value: false }
                );
                if (!customOk || !customInput.value.trim()) return null;
                return {
                    label: 'Custom question',
                    promptText: customInput.value.trim(),
                    context: 'fulltext'
                };
            }

            const promptChoice = prompts[selectedIndex.value];
            return {
                label: promptChoice.name,
                promptText: promptChoice.prompt,
                context: promptChoice.context || 'fulltext'
            };
        },

        getProviderSettings() {
            let provider = null;
            try {
                const stored = Zotero.Prefs.get(this.PREFS.provider);
                if (stored) provider = JSON.parse(stored);
            } catch (e) {
                Zotero.logError(e);
            }

            if (!provider) {
                provider = {
                    name: 'OpenAI',
                    baseUrl: 'https://api.openai.com/v1',
                    model: Zotero.Prefs.get(this.PREFS.model) || 'gpt-4o-mini',
                    apiKey: Zotero.Prefs.get(this.PREFS.apiKey) || '',
                    fileEndpoint: '',
                    systemPrompt: this.defaultSystemPrompt
                };
            } else {
                provider.apiKey = provider.apiKey || Zotero.Prefs.get(this.PREFS.apiKey) || '';
                provider.model = provider.model || Zotero.Prefs.get(this.PREFS.model) || 'gpt-4o-mini';
                provider.systemPrompt = provider.systemPrompt || this.defaultSystemPrompt;
            }

            return provider;
        },

        saveProviderSettings(provider) {
            Zotero.Prefs.set(this.PREFS.provider, JSON.stringify(provider));
            if (provider.apiKey) Zotero.Prefs.set(this.PREFS.apiKey, provider.apiKey);
            if (provider.model) Zotero.Prefs.set(this.PREFS.model, provider.model);
        },

        getPrompts() {
            try {
                const stored = Zotero.Prefs.get(this.PREFS.prompts);
                if (stored) return JSON.parse(stored);
            } catch (e) {
                Zotero.logError(e);
            }
            return this.defaultPrompts();
        },

        defaultPrompts() {
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

        async getFullText(attachmentID) {
            const attachment = Zotero.Items.get(attachmentID);
            if (!attachment) {
                throw new Error("Attachment not found.");
            }

            // Try to get cached full text content
            let text = null;
            
            // Method 1: Try to get from full text cache
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

            return this.truncateText(text);
        },

        truncateText(text) {
            const maxLength = 200000;
            if (text.length > maxLength) return text.substring(0, maxLength);
            return text;
        },

        async getAttachmentBlob(attachment) {
            const filePath = await attachment.getFilePathAsync();
            if (!filePath) throw new Error('Could not locate the PDF on disk.');
            let bytes;
            try {
                bytes = await IOUtils.read(filePath);
            } catch (e) {
                throw new Error(`Failed to read PDF: ${e.message}`);
            }
            const fallback = (attachment.getField && attachment.getField('title')) ? attachment.getField('title') + '.pdf' : 'document.pdf';
            const filename = attachment.attachmentFilename || fallback;
            const blob = new Blob([bytes], { type: 'application/pdf' });
            return { blob, filename };
        },

        async callWithText(provider, text, promptText) {
            const url = this.normalizeBaseUrl(provider.baseUrl || 'https://api.openai.com/v1') + '/chat/completions';
            const headers = {
                'Content-Type': 'application/json'
            };
            if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

            const body = {
                model: provider.model || 'gpt-4o-mini',
                messages: [
                    { role: "system", content: provider.systemPrompt || this.defaultSystemPrompt },
                    { role: "user", content: `${promptText}\n\nContext:\n${text}` }
                ]
            };

            Zotero.debug(`[ZotExtract] Calling ${url} with model ${body.model}`);

            let response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                });
            } catch (fetchError) {
                throw new Error('Network error: ' + fetchError.message);
            }

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API Error ${response.status}: ${errText}`);
            }

            let data;
            try {
                data = await response.json();
            } catch (parseError) {
                throw new Error('Failed to parse API response: ' + parseError.message);
            }

            return data.choices?.[0]?.message?.content || '';
        },

        async callWithPDF(provider, attachment, promptText) {
            const endpoint = provider.fileEndpoint || (this.normalizeBaseUrl(provider.baseUrl || '') + '/pdf-chat');
            if (!endpoint) {
                throw new Error("No PDF endpoint configured. Set one in the preferences.");
            }

            const { blob, filename } = await this.getAttachmentBlob(attachment);
            const formData = new FormData();
            formData.append('file', blob, filename);
            formData.append('prompt', promptText);
            if (provider.model) formData.append('model', provider.model);
            if (provider.systemPrompt) formData.append('systemPrompt', provider.systemPrompt);

            const headers = {};
            if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: formData
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`API Error ${response.status}: ${errText}`);
            }

            let data = null;
            try {
                data = await response.json();
            } catch (e) {
                data = null;
            }

            if (data) {
                return data.answer || data.result || data.output || data.message || JSON.stringify(data);
            }
            return await response.text();
        },

        normalizeBaseUrl(url) {
            return url ? url.replace(/\/$/, '') : '';
        },

        htmlEscape(str) {
            return (str || '').replace(/[&<>"']/g, c => {
                switch (c) {
                    case '&': return '&amp;';
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '"': return '&quot;';
                    case "'": return '&#39;';
                }
                return c;
            });
        }
    };
}
