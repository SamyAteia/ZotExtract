var ZotExtractSessionExport = {
        async exportSelectedItems(items, window = null) {
            if (this.currentSessionId) return this.exportSession(this.currentSessionId, window);
            Services.prompt.alert(null, 'ZotExtract export', 'Open a ZotExtract session and export from the session view.');
        },

        exportFormatOptions() {
            return [
                { id: 'xlsx', label: 'Excel workbook (.xlsx)', extension: 'xlsx', binary: true },
                { id: 'csv', label: 'CSV table (.csv)', extension: 'csv' },
                { id: 'tsv', label: 'Tab-separated table (.tsv)', extension: 'tsv' },
                { id: 'json', label: 'Structured JSON (.json)', extension: 'json' },
                { id: 'markdown', label: 'Markdown report (.md)', extension: 'md' },
                { id: 'html', label: 'HTML report (.html)', extension: 'html' }
            ];
        },

        async exportSession(sessionId, window = null) {
            const session = await this.getSession(sessionId);
            if (!session) {
                Services.prompt.alert(null, 'ZotExtract export', 'Could not find the ZotExtract session.');
                return;
            }
            try {
                const bundle = await this.buildSessionExportBundle(sessionId);
                if (!bundle.records.length) {
                    Services.prompt.alert(null, 'ZotExtract export', 'No completed or reviewable ZotExtract result cells were found in this session.');
                    return;
                }

                const destination = await this.pickExportDestination(bundle, window);
                if (!destination) return;
                const { format, path } = destination;
                await this.writeExportFile(bundle, format, path);

                session.exportedAt = this.nowIso();
                session.lastExportPaths = { [format.id]: path };
                session.lastExportFormat = format.id;
                session.exportStale = false;
                await this.saveSession(session);
                Services.prompt.alert(
                    null,
                    'ZotExtract export complete',
                    `Exported ${bundle.records.length} ZotExtract session result(s) as ${format.label}.\n${path}`
                );
                await this.renderSessionWorkspace(sessionId);
            } catch (e) {
                Zotero.logError(e);
                Services.prompt.alert(null, 'ZotExtract export failed', e.message || String(e));
            }
        },

        async pickExportDestination(bundle, window = null) {
            const formats = this.exportFormatOptions();
            const defaultFormat = formats[0];
            const suggested = this.defaultExportFilename(bundle, defaultFormat.extension);
            if (typeof Cc === 'undefined' || typeof Ci === 'undefined' || !Ci.nsIFilePicker) {
                throw new Error('Zotero file picker is not available in this runtime.');
            }
            const picker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
            this.initExportFilePicker(picker, window, 'Export ZotExtract results', Ci.nsIFilePicker.modeSave);
            picker.defaultString = suggested;
            picker.defaultExtension = defaultFormat.extension;
            for (const format of formats) picker.appendFilter(format.label, `*.${format.extension}`);
            picker.appendFilters(Ci.nsIFilePicker.filterAll);
            const result = await this.showFilePicker(picker);
            if (result === Ci.nsIFilePicker.returnCancel) return null;
            if (![Ci.nsIFilePicker.returnOK, Ci.nsIFilePicker.returnReplace].includes(result)) return null;
            const rawPath = picker.file?.path || picker.fileURL?.path || '';
            const selectedIndex = Math.max(0, Math.min(formats.length - 1, Number(picker.filterIndex) || 0));
            const selectedFormat = this.exportFormatForPath(rawPath) || formats[selectedIndex] || defaultFormat;
            return {
                format: selectedFormat,
                path: this.ensureExportExtension(rawPath, selectedFormat.extension)
            };
        },

        exportFilePickerParents(window = null) {
            const windows = [];
            const seenWindows = new Set();
            const addWindow = candidate => {
                if (!candidate || seenWindows.has(candidate)) return;
                seenWindows.add(candidate);
                windows.push(candidate);
            };
            addWindow(window);
            addWindow(window?.ownerGlobal);
            addWindow(window?.ownerDocument?.defaultView);
            try { addWindow(this.mainWindow?.(window)); } catch (_) {}
            try { addWindow(this.mainWindow?.()); } catch (_) {}
            try { addWindow(Zotero.getMainWindow?.()); } catch (_) {}
            try { addWindow(Services.wm?.getMostRecentWindow?.('navigator:browser')); } catch (_) {}

            const parents = [];
            const seenParents = new Set();
            const addParent = parent => {
                if (!parent || seenParents.has(parent)) return;
                seenParents.add(parent);
                parents.push(parent);
            };
            for (const win of windows) {
                addParent(win.browsingContext);
                addParent(win);
            }
            return parents;
        },

        initExportFilePicker(picker, window, title, mode) {
            const parents = this.exportFilePickerParents(window);
            if (!parents.length) throw new Error('Could not find a Zotero window for the export save dialog.');
            let lastError = null;
            for (const parent of parents) {
                try {
                    picker.init(parent, title, mode);
                    return parent;
                } catch (e) {
                    lastError = e;
                }
            }
            throw lastError || new Error('Could not initialize the ZotExtract export save dialog.');
        },

        showFilePicker(picker) {
            if (typeof picker.open === 'function') {
                return new Promise(resolve => picker.open(resolve));
            }
            return Promise.resolve(picker.show());
        },

        defaultExportFilename(bundle, extension) {
            const sessionName = String(bundle.session?.name || 'zotextract-session')
                .replace(/[\\/:*?"<>|]+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 80) || 'zotextract-session';
            const stamp = new Date().toISOString().slice(0, 10);
            return `${sessionName}-${stamp}.${extension}`;
        },

        ensureExportExtension(path, extension) {
            if (!path) return path;
            const suffix = `.${extension}`.toLowerCase();
            return path.toLowerCase().endsWith(suffix) ? path : `${path}.${extension}`;
        },

        exportFormatForPath(path) {
            const normalized = String(path || '').toLowerCase();
            return this.exportFormatOptions().find(format => normalized.endsWith(`.${format.extension}`)) || null;
        },

        async writeExportFile(bundle, format, path) {
            if (!path) return null;
            if (typeof IOUtils === 'undefined') throw new Error('Zotero file APIs are not available in this runtime.');
            const payload = this.renderExportPayload(bundle, format.id);
            if (format.binary) {
                if (typeof IOUtils.write !== 'function') throw new Error('Binary export is not supported by this Zotero runtime.');
                await IOUtils.write(path, payload);
            } else {
                await IOUtils.writeUTF8(path, payload);
            }
            return path;
        },

        renderExportPayload(bundle, formatId) {
            switch (formatId) {
                case 'xlsx': return this.renderExportXlsx(bundle);
                case 'csv': return this.renderExportCsv(bundle);
                case 'tsv': return this.renderExportTsv(bundle);
                case 'json': return JSON.stringify(bundle, null, 2) + '\n';
                case 'markdown': return this.renderExportMarkdown(bundle);
                case 'html': return this.renderExportHtml(bundle);
                default: throw new Error(`Unsupported export format: ${formatId}`);
            }
        },

        async buildSessionExportBundle(sessionId) {
            const session = await this.getSession(sessionId);
            const cells = await this.readResultCells(sessionId);
            const records = cells
                .filter(cell => ['completed', 'needs-review'].includes(cell.status))
                .map(cell => {
                    const structured = cell.structured || {};
                    const paper = structured.paper || cell.paperSnapshot || {};
                    return {
                        item: {
                            zoteroItemId: cell.itemId,
                            title: paper.title || cell.paperSnapshot?.title || '',
                            doi: cell.paperSnapshot?.doi || paper.doi || ''
                        },
                        noteId: '',
                        sessionId,
                        questionId: cell.questionId,
                        status: cell.status,
                        structured,
                        answer: cell.answer || '',
                        validation: {
                            parsedEmbeddedJson: !!structured.validation?.parsed,
                            error: structured.validation?.error || cell.error || null
                        }
                    };
                });
            return {
                schemaId: 'zotextract.session-export.v1',
                schemaVersion: '1.0',
                exportedAt: new Date().toISOString(),
                session: session ? {
                    id: session.id,
                    name: session.name,
                    status: session.status,
                    paperItemIds: session.paperItemIds || [],
                    questionRefs: session.questionRefs || []
                } : null,
                privacy: {
                    includesRawFullText: false,
                    note: 'Exports contain ZotExtract session records, metadata, short evidence quotes if present, and model answers. They do not include raw PDF full text.'
                },
                records
            };
        },

        async writeExportBundle(bundle) {
            if (typeof IOUtils === 'undefined' || typeof PathUtils === 'undefined') {
                throw new Error('Zotero file APIs are not available in this runtime.');
            }
            const baseDir = (Zotero.DataDirectory && Zotero.DataDirectory.dir) || (Zotero.Profile && Zotero.Profile.dir);
            const basePath = typeof baseDir === 'string' ? baseDir : baseDir?.path;
            if (!basePath) throw new Error('Could not find Zotero profile directory for export.');
            const exportDir = PathUtils.join(basePath, 'zotextract-exports');
            await IOUtils.makeDirectory(exportDir, { ignoreExisting: true });
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const paths = {};
            for (const format of this.exportFormatOptions()) {
                const outputPath = PathUtils.join(exportDir, `zotextract-export-${stamp}.${format.extension}`);
                await this.writeExportFile(bundle, format, outputPath);
                paths[format.id] = outputPath;
            }
            return paths;
        },

        exportTableRows(bundle) {
            const headers = [
                'exportedAt',
                'sessionId',
                'sessionName',
                'zoteroItemId',
                'title',
                'doi',
                'questionId',
                'question',
                'model',
                'status',
                'parsed',
                'answer',
                'reasoning',
                'evidence',
                'warnings',
                'extraFields'
            ];
            const rows = [headers];
            for (const record of bundle.records) {
                const structured = record.structured || {};
                const paper = structured.paper || record.item || {};
                const extraction = structured.extraction;
                const answer = extraction && typeof extraction === 'object' && !Array.isArray(extraction) && Object.prototype.hasOwnProperty.call(extraction, 'answer')
                    ? extraction.answer
                    : (extraction ?? record.answer ?? '');
                const evidence = this.exportEvidenceText(record);
                rows.push([
                    bundle.exportedAt || '',
                    record.sessionId || bundle.session?.id || '',
                    bundle.session?.name || '',
                    record.item?.zoteroItemId || '',
                    paper.title || record.item?.title || '',
                    record.item?.doi || paper.doi || '',
                    record.questionId || '',
                    structured.source?.promptName || structured.source?.promptId || '',
                    structured.source?.model || '',
                    record.status || '',
                    record.validation?.parsedEmbeddedJson ? 'true' : 'false',
                    this.finalAnswerPreview(answer) || this.previewValue(answer),
                    this.previewValue(extraction?.reasoning || ''),
                    evidence,
                    (record.source?.warnings || structured.source?.warnings || []).join('; '),
                    this.exportExtraFields(extraction)
                ]);
            }
            return rows;
        },

        exportEvidenceText(record) {
            const structured = record?.structured || {};
            const evidence = structured.evidence || this.extractRelevantContextEntries?.(structured.extraction || {}) || [];
            if (!Array.isArray(evidence)) return '';
            return evidence
                .map(entry => {
                    if (!entry) return '';
                    if (typeof entry === 'string') return entry;
                    return [entry.lines || entry.lineRange || '', entry.note || entry.text || entry.quote || '']
                        .filter(Boolean)
                        .join(' - ');
                })
                .filter(Boolean)
                .join('; ');
        },

        exportExtraFields(extraction) {
            if (!extraction || typeof extraction !== 'object' || Array.isArray(extraction)) return '';
            const skip = new Set(['answer', 'reasoning', 'relevant_context', 'relevantContext', 'evidence', 'source']);
            return Object.keys(extraction)
                .filter(key => !skip.has(key))
                .map(key => `${this.humanizeKey(key)}=${this.previewValue(extraction[key])}`)
                .filter(Boolean)
                .join('; ');
        },

        renderExportCsv(bundle) {
            return this.exportTableRows(bundle)
                .map(row => row.map(value => this.csvEscape(value)).join(','))
                .join('\n') + '\n';
        },

        renderExportTsv(bundle) {
            return this.exportTableRows(bundle)
                .map(row => row.map(value => this.tsvEscape(value)).join('\t'))
                .join('\n') + '\n';
        },

        csvEscape(value) {
            const text = String(value == null ? '' : value);
            const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
            return /[",\r\n]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
        },

        tsvEscape(value) {
            const text = String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ');
            return /^[=+\-@]/.test(text) ? `'${text}` : text;
        },

        renderExportXlsx(bundle) {
            return this.createXlsxWorkbook([{
                name: 'ZotExtract Results',
                rows: this.exportTableRows(bundle)
            }]);
        },

        createXlsxWorkbook(sheets) {
            const files = [
                {
                    name: '[Content_Types].xml',
                    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                        '<Default Extension="xml" ContentType="application/xml"/>' +
                        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                        sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
                        '</Types>'
                },
                {
                    name: '_rels/.rels',
                    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                        '</Relationships>'
                },
                {
                    name: 'xl/workbook.xml',
                    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                        '<sheets>' +
                        sheets.map((sheet, index) => `<sheet name="${this.xmlEscape(this.xlsxSheetName(sheet.name || `Sheet ${index + 1}`))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('') +
                        '</sheets></workbook>'
                },
                {
                    name: 'xl/_rels/workbook.xml.rels',
                    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                        sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('') +
                        '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
                        '</Relationships>'
                },
                {
                    name: 'xl/styles.xml',
                    text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
                        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
                        '<borders count="1"><border/></borders>' +
                        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
                        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
                        '</styleSheet>'
                },
                ...sheets.map((sheet, index) => ({
                    name: `xl/worksheets/sheet${index + 1}.xml`,
                    text: this.renderWorksheetXml(sheet.rows || [])
                }))
            ];
            return this.zipStore(files.map(file => ({ name: file.name, data: this.utf8Bytes(file.text) })));
        },

        renderWorksheetXml(rows) {
            const sheetRows = rows.map((row, rowIndex) => {
                const r = rowIndex + 1;
                const cells = row.map((value, columnIndex) => {
                    const ref = `${this.xlsxColumnName(columnIndex + 1)}${r}`;
                    return `<c r="${ref}" t="inlineStr"><is><t>${this.xmlEscape(String(value == null ? '' : value))}</t></is></c>`;
                }).join('');
                return `<row r="${r}">${cells}</row>`;
            }).join('');
            return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
                `<sheetData>${sheetRows}</sheetData>` +
                '</worksheet>';
        },

        xlsxSheetName(name) {
            return String(name || 'Sheet 1').replace(/[:\\/?*\[\]]/g, ' ').slice(0, 31) || 'Sheet 1';
        },

        xlsxColumnName(index) {
            let n = index;
            let name = '';
            while (n > 0) {
                const remainder = (n - 1) % 26;
                name = String.fromCharCode(65 + remainder) + name;
                n = Math.floor((n - 1) / 26);
            }
            return name || 'A';
        },

        xmlEscape(value) {
            return String(value == null ? '' : value).replace(/[&<>"']/g, c => {
                switch (c) {
                    case '&': return '&amp;';
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '"': return '&quot;';
                    case "'": return '&apos;';
                }
                return c;
            });
        },

        utf8Bytes(text) {
            if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text || ''));
            const encoded = unescape(encodeURIComponent(String(text || '')));
            const bytes = new Uint8Array(encoded.length);
            for (let i = 0; i < encoded.length; i++) bytes[i] = encoded.charCodeAt(i);
            return bytes;
        },

        zipStore(files) {
            const entries = files.map(file => ({
                nameBytes: this.utf8Bytes(file.name),
                data: file.data,
                crc: this.crc32(file.data)
            }));
            let offset = 0;
            let total = 22;
            for (const entry of entries) {
                entry.offset = offset;
                offset += 30 + entry.nameBytes.length + entry.data.length;
                total += 30 + entry.nameBytes.length + entry.data.length + 46 + entry.nameBytes.length;
            }
            const centralStart = offset;
            const output = new Uint8Array(total);
            let position = 0;
            const write16 = value => {
                output[position++] = value & 0xff;
                output[position++] = (value >>> 8) & 0xff;
            };
            const write32 = value => {
                output[position++] = value & 0xff;
                output[position++] = (value >>> 8) & 0xff;
                output[position++] = (value >>> 16) & 0xff;
                output[position++] = (value >>> 24) & 0xff;
            };
            const writeBytes = bytes => {
                output.set(bytes, position);
                position += bytes.length;
            };
            const dosTime = this.zipDosTime(new Date());
            for (const entry of entries) {
                write32(0x04034b50);
                write16(20);
                write16(0x0800);
                write16(0);
                write16(dosTime.time);
                write16(dosTime.date);
                write32(entry.crc);
                write32(entry.data.length);
                write32(entry.data.length);
                write16(entry.nameBytes.length);
                write16(0);
                writeBytes(entry.nameBytes);
                writeBytes(entry.data);
            }
            for (const entry of entries) {
                write32(0x02014b50);
                write16(20);
                write16(20);
                write16(0x0800);
                write16(0);
                write16(dosTime.time);
                write16(dosTime.date);
                write32(entry.crc);
                write32(entry.data.length);
                write32(entry.data.length);
                write16(entry.nameBytes.length);
                write16(0);
                write16(0);
                write16(0);
                write16(0);
                write32(0);
                write32(entry.offset);
                writeBytes(entry.nameBytes);
            }
            const centralSize = position - centralStart;
            write32(0x06054b50);
            write16(0);
            write16(0);
            write16(entries.length);
            write16(entries.length);
            write32(centralSize);
            write32(centralStart);
            write16(0);
            return output;
        },

        zipDosTime(date) {
            return {
                time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
                date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
            };
        },

        crc32(bytes) {
            if (!this._crc32Table) {
                this._crc32Table = Array.from({ length: 256 }, (_, index) => {
                    let value = index;
                    for (let bit = 0; bit < 8; bit++) {
                        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
                    }
                    return value >>> 0;
                });
            }
            let crc = 0xffffffff;
            for (const byte of bytes) crc = this._crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
            return (crc ^ 0xffffffff) >>> 0;
        },

        renderExportHtml(bundle) {
            const rows = this.exportTableRows(bundle);
            const htmlRows = rows.map((row, index) => {
                const tag = index === 0 ? 'th' : 'td';
                return `<tr>${row.map(value => `<${tag}>${this.htmlEscape(value)}</${tag}>`).join('')}</tr>`;
            }).join('\n');
            return [
                '<!doctype html>',
                '<meta charset="utf-8">',
                '<title>ZotExtract Export</title>',
                '<style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px;vertical-align:top}th{background:#f5f5f5;text-align:left}</style>',
                '<h1>ZotExtract Export</h1>',
                `<p>Exported: ${this.htmlEscape(bundle.exportedAt)}</p>`,
                '<p>This export omits raw full text by default.</p>',
                `<table>${htmlRows}</table>`
            ].join('\n') + '\n';
        },

        renderExportMarkdown(bundle) {
            const lines = [
                '# ZotExtract Export',
                '',
                `Exported: ${bundle.exportedAt}`,
                '',
                'This export omits raw full text by default.',
                ''
            ];
            for (const record of bundle.records) {
                const structured = record.structured || {};
                const paper = structured.paper || record.item || {};
                lines.push(`## ${paper.title || record.item.title || 'Untitled item'}`);
                if (record.item.doi) lines.push(`DOI: ${record.item.doi}`);
                if (structured.source) {
                    lines.push(`Model: ${structured.source.model || 'unspecified'}`);
                    lines.push(`Prompt: ${structured.source.promptName || structured.source.promptId || 'unknown'}`);
                }
                if (Array.isArray(structured.concepts) && structured.concepts.length) {
                    lines.push('');
                    lines.push('### Concepts');
                    for (const concept of structured.concepts) {
                        const evidence = Array.isArray(concept.evidence) ? concept.evidence.map(e => e.lineId || e.lineRange || e.chunkId || e).filter(Boolean).join(', ') : '';
                        lines.push(`- **${concept.label || 'Concept'}**: ${concept.definition || ''}${evidence ? ` (${evidence})` : ''}`);
                    }
                }
                if (Array.isArray(structured.methods) && structured.methods.length) {
                    lines.push('');
                    lines.push('### Methods');
                    for (const method of structured.methods) lines.push(`- ${method}`);
                }
                if (Array.isArray(structured.datasets) && structured.datasets.length) {
                    lines.push('');
                    lines.push('### Datasets');
                    for (const dataset of structured.datasets) lines.push(`- ${dataset}`);
                }
                if (Array.isArray(structured.limitations) && structured.limitations.length) {
                    lines.push('');
                    lines.push('### Limitations');
                    for (const limitation of structured.limitations) lines.push(`- ${limitation}`);
                }
                if (structured.extraction && typeof structured.extraction === 'object') {
                    const extraEntries = Object.keys(structured.extraction)
                        .filter(key => !['title', 'concepts', 'methods', 'datasets', 'limitations', 'source'].includes(key))
                        .filter(key => this.previewValue(structured.extraction[key]))
                        .slice(0, 20);
                    if (extraEntries.length) {
                        lines.push('');
                        lines.push('### Extracted Fields');
                        for (const key of extraEntries) {
                            lines.push(`- **${this.humanizeKey(key)}**: ${this.previewValue(structured.extraction[key])}`);
                        }
                    }
                }
                lines.push('');
            }
            return lines.join('\n');
        },
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractSessionExport);
}
