const fs = require('fs');
const path = require('path');
const assert = require('assert');

const mockItems = new Map();
const mockFiles = new Map();

// --- Mocks ---

global.alert = (msg) => console.log(`[Alert] ${msg}`);
global.prompt = (msg) => {
    console.log(`[Prompt] ${msg}`);
    return "test-api-key"; // Default mock response
};

global.Services = {
    prompt: {
        select: (parent, title, text, labels, selectedIndex) => {
            console.log(`[Select] ${title}: ${text}`);
            // Simulate selecting the first option (Summary)
            selectedIndex.value = 0;
            return true;
        },
        alert: (parent, title, text) => {
            console.log(`[Alert] ${title}: ${text}`);
        },
        confirm: (parent, title, text) => {
            console.log(`[Confirm] ${title}: ${text}`);
            return true;
        },
        prompt: (parent, title, text, input) => {
            console.log(`[PromptService] ${title}: ${text}`);
            return true;
        }
    }
};

global.ChromeUtils = {
    import: (uri) => {
        if (uri.includes("IOUtils")) {
            return {
                IOUtils: {
                    read: async (path) => {
                        return new Uint8Array([1, 2, 3]); // Mock PDF bytes
                    }
                }
            };
        }
        throw new Error(`Unknown module: ${uri}`);
    }
};

global.Zotero = {
    Prefs: {
        _store: {},
        get: (key) => global.Zotero.Prefs._store[key],
        set: (key, val) => global.Zotero.Prefs._store[key] = val,
        clear: (key) => {
            delete global.Zotero.Prefs._store[key];
        }
    },
    Items: {
        get: (id) => {
            if (mockItems.has(id)) return mockItems.get(id);
            return {
                id: id,
                isPDFAttachment: () => true,
                getFilePathAsync: async () => "/path/to/mock.pdf",
                attachmentFilename: "mock.pdf",
                getField: (field) => field === 'title' ? 'Mock Title' : ''
            };
        },
        getAsync: async (id) => global.Zotero.Items.get(id)
    },
    Fulltext: {
        getTextForItem: async (id) => "This is the full text of the paper.",
        getItemContent: async (id) => ({ text: "This is the full text of the paper." }),
        indexItems: async (ids) => { }
    },
    Attachments: {
        getStorageDirectory: (attachment) => null
    },
    DataDirectory: {
        dir: '/mock-profile'
    },
    Profile: {
        dir: '/mock-profile'
    },
    Promise: {
        delay: (ms) => new Promise(resolve => setTimeout(resolve, ms))
    },
    debug: (msg) => console.log(`[Zotero Debug] ${msg}`),
    getMainWindow: () => ({
        document: {
            getElementById: (id) => ({
                appendChild: () => { },
                remove: () => { },
                parentNode: null
            }),
            createXULElement: (tag) => ({
                setAttribute: () => { },
                addEventListener: () => { }
            }),
            createElementNS: (ns, tag) => {
                const el = {
                    style: {},
                    textContent: '',
                    id: '',
                    cssText: '',
                    disabled: false,
                    appendChild: () => {},
                    addEventListener: () => {},
                    parentNode: null
                };
                el.style = { cssText: '' };
                return el;
            },
            documentElement: { appendChild: () => {} }
        },
        ZotExtract: null
    }),
    getMainWindows: () => [{
        document: {
            getElementById: (id) => ({
                appendChild: () => { },
                remove: () => { }
            }),
            createXULElement: (tag) => ({
                setAttribute: () => { },
                addEventListener: () => { }
            })
        },
        ZotExtract: null
    }],
    getActiveZoteroPane: () => ({
        getSelectedItems: () => [{
            isRegularItem: () => true,
            getField: (field) => field === 'title' ? 'Test Paper' : '',
            getBestAttachment: async () => ({
                id: 123,
                attachmentContentType: 'application/pdf',
                attachmentFilename: 'mock.pdf',
                getFilePathAsync: async () => '/path/to/mock.pdf',
                getField: (field) => field === 'title' ? 'Mock Title' : ''
            }),
            id: 456
        }]
    }),
    logError: (e) => console.error(`[Zotero Error]`, e)
};

// Mock fetch
global.fetch = async (url, options) => {
    console.log(`[Fetch] ${url}`);
    if (options.body) {
        console.log(`[Fetch Body]`, options.body);
    }

    let body = {};
    try { body = JSON.parse(options.body || '{}'); } catch {}
    const user = (body.messages || []).find(m => m.role === 'user')?.content || '';
    const content = /strict JSON|concept|Output format:/i.test(user)
        ? JSON.stringify({
            reasoning: 'The cited line contains the mocked full text used by the extraction workflow, so the answer is limited to that supported context.',
            relevant_context: [
                { lines: 'L000001', note: 'Mock full-text evidence for the structured extraction.' }
            ],
            answer: {
                title: 'Mock structured paper',
                researchQuestions: ['How can Zotero extraction preserve structured evidence?'],
                contributionType: 'tool',
                concepts: [
                    {
                        label: 'Local Zotero extraction',
                        definition: 'A workflow that extracts structured records from PDFs inside Zotero.',
                        evidence: [{ lines: 'L000001', quote: 'full text', note: 'mock evidence' }],
                        confidence: 'high'
                    }
                ],
                methods: ['mocked OpenAI-compatible completion'],
                datasets: [],
                limitations: ['unit test fixture']
            }
        })
        : "This is a mock LLM response.";

    const responsePayload = {
        choices: [{
            message: {
                content
            }
        }]
    };

    return {
        ok: true,
        json: async () => responsePayload,
        text: async () => JSON.stringify(responsePayload)
    };
};

// Mock IOUtils and PathUtils (globals in Zotero 7 / Firefox 115+)
global.IOUtils = {
    exists: async (path) => mockFiles.has(path),
    readUTF8: async (path) => mockFiles.get(path) || "",
    read: async (path) => new Uint8Array([1, 2, 3]),
    makeDirectory: async () => {},
    writeUTF8: async (path, value) => {
        mockFiles.set(path, value);
    },
    write: async (path, value) => {
        mockFiles.set(path, value);
    },
    move: async (from, to) => {
        mockFiles.set(to, mockFiles.get(from) || "");
        mockFiles.delete(from);
    },
    remove: async (path, options = {}) => {
        mockFiles.delete(path);
        if (options.recursive) {
            for (const key of Array.from(mockFiles.keys())) {
                if (key.startsWith(`${path}/`)) mockFiles.delete(key);
            }
        }
    }
};

global.PathUtils = {
    join: (...parts) => parts.join('/')
};

// --- Load Plugin Code ---

const presetsPath = path.join(__dirname, '../content/prompt-presets.js');
const presetsCode = fs.readFileSync(presetsPath, 'utf8');
const providerSettingsPath = path.join(__dirname, '../content/provider-settings.js');
const providerSettingsCode = fs.readFileSync(providerSettingsPath, 'utf8');
const providerRuntimePath = path.join(__dirname, '../content/zotextract-provider-runtime.js');
const providerRuntimeCode = fs.readFileSync(providerRuntimePath, 'utf8');
const sessionExportPath = path.join(__dirname, '../content/zotextract-session-export.js');
const sessionExportCode = fs.readFileSync(sessionExportPath, 'utf8');
const preferencesPath = path.join(__dirname, '../content/preferences.js');
const preferencesCode = fs.readFileSync(preferencesPath, 'utf8');
const pluginModulePaths = [
    '../content/zotextract.js',
    '../content/zotextract-window.js',
    '../content/zotextract-data.js',
    '../content/zotextract-context.js',
    '../content/zotextract-runner.js',
    '../content/zotextract-window-ui.js',
    '../content/zotextract-session-ui.js',
    '../content/zotextract-evidence-ui.js',
    '../content/zotextract-progress.js'
];
const pluginModuleCode = pluginModulePaths.map(modulePath => fs.readFileSync(path.join(__dirname, modulePath), 'utf8'));
const pluginCode = pluginModuleCode.join('\n');

const vm = require('vm');

// We need to handle the "if (!ZotExtract)" check. 
// In the browser/Zotero, this runs in a shared scope.
// We can define a context for the script.

const context = {
    ZotExtract: undefined,
    ZotExtractPromptPresets: undefined,
    ZotExtractProviderSettings: undefined,
    Zotero: global.Zotero,
    Services: global.Services,
    ChromeUtils: global.ChromeUtils,
    IOUtils: global.IOUtils,
    PathUtils: global.PathUtils,
    alert: global.alert,
    prompt: global.prompt,
    fetch: global.fetch,
    AbortController: global.AbortController,
    Blob: global.Blob,
    FormData: global.FormData,
    URL: URL,
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
};

vm.createContext(context);
vm.runInContext(presetsCode, context);
vm.runInContext(providerSettingsCode, context);
for (const moduleCode of pluginModuleCode) {
    vm.runInContext(moduleCode, context);
}
vm.runInContext(providerRuntimeCode, context);
vm.runInContext(sessionExportCode, context);

// Extract ZotExtract from context
global.ZotExtract = context.ZotExtract;

// --- Run Tests ---

async function runTests() {
    console.log("Starting Tests...");

    if (!global.ZotExtract) {
        console.error("ZotExtract not defined!");
        return;
    }

    console.log("ZotExtract defined.");
    assert.strictEqual(context.ZotExtractProviderSettings.defaults().maxTextCharacters, 400000);
    assert.strictEqual(context.ZotExtractProviderSettings.defaults().reasoningEffort, 'none');
    assert.strictEqual(context.ZotExtractProviderSettings.defaults().timeoutSeconds, 120);
    assert.strictEqual(global.ZotExtract.defaultRequestTimeoutMs, 120000);
    assert.strictEqual(global.ZotExtract.truncateText('x'.repeat(400001)).maxLength, 400000);
    assert(context.ZotExtractPromptPresets.fieldPacks().length >= 5);
    assert(context.ZotExtractPromptPresets.getFieldPack('results').prompts.length >= 2);
    assert(context.ZotExtractPromptPresets.allPrompts().length >= 12, 'Default question set should ship the comparison-first questions.');
    assert(context.ZotExtractPromptPresets.allPrompts().every(p => ['binary', 'list', 'semantic'].includes(p.type)), 'Every default question should have a comparison type.');
    const presetText = context.ZotExtractPromptPresets.allPrompts().map(prompt => `${prompt.id}\n${prompt.name}\n${prompt.prompt}`).join('\n').toLowerCase();
    assert(!/\bjson\b|hidden chain-of-thought|return only|strict json|with this shape/.test(presetText), 'Default presets should not expose technical response-mode artifacts.');
    assert(!pluginCode.includes('data-ze-new-set-small'));
    assert(!pluginCode.includes('data-ze-new-question-small'));
    assert(!pluginCode.includes('data-ze-delete-set title'));
    assert(!pluginCode.includes('data-ze-delete-question title'));
    assert(!pluginCode.includes('data-ze-pick-questions'));
    assert(!pluginCode.includes('data-ze-save-close'));
    assert(!pluginCode.includes('Search questions'));
    assert(!pluginCode.includes('buildExportBundle(items)'));
    assert(!pluginCode.includes('getZotExtractNotesForItem'));
    assert(!pluginCode.includes('extractEmbeddedJson'));
    assert(pluginCode.includes('data-ze-new-set-row'));
    assert(pluginCode.includes('data-ze-new-question-row'));
    assert(pluginCode.includes('data-ze-delete-set-row'));
    assert(pluginCode.includes('data-ze-delete-question-row'));
    const menuAttributes = {};
    const originalRootURI = global.ZotExtract.rootURI;
    try {
        global.ZotExtract.rootURI = 'jar:file:///mock/zotextract.xpi!/';
        global.ZotExtract.configureContextMenuItem({
            getAttribute: name => menuAttributes[name] || '',
            setAttribute: (name, value) => { menuAttributes[name] = value; }
        }, 'session-add');
        assert(menuAttributes.class.split(/\s+/).includes('menuitem-iconic'));
        assert.strictEqual(menuAttributes.image, 'jar:file:///mock/zotextract.xpi!/content/icons/session-add.svg');
    } finally {
        global.ZotExtract.rootURI = originalRootURI;
    }

    global.Zotero.Prefs.set('extensions.zotextract.provider', JSON.stringify({
        name: 'Fake Local',
        baseUrl: 'http://127.0.0.1:8789/v1',
        model: 'fake-model',
        apiKey: '',
        systemPrompt: 'Unit test system prompt'
    }));

    // Test 1: ZotExtract structured JSON from full text
    console.log("\n--- Test 1: ZotExtract (Structured Full Text) ---");

    // Setup mock selection to be 'summary' (which uses fulltext)
    // The mock Services.prompt.select already defaults to index 0 (summary)

    const mockAttachment = {
        id: 123,
        attachmentContentType: 'application/pdf',
        attachmentFilename: 'mock.pdf',
        getFilePathAsync: async () => '/path/to/mock.pdf',
        getField: (field) => field === 'title' ? 'Mock Title' : ''
    };

    const mockRegularItem = {
        isRegularItem: () => true,
        getField: (field) => field === 'title' ? 'Test Paper' : (field === 'DOI' ? '10.0000/mock' : ''),
        getBestAttachment: async () => mockAttachment,
        id: 456
    };
    mockItems.set(123, mockAttachment);
    mockItems.set(456, mockRegularItem);

    const createdSession = await global.ZotExtract.startSessionFromItems([mockRegularItem]);
    const sets = await global.ZotExtract.loadQuestionSets();
    const firstSet = sets.find(set => (set.questions || []).length);
    const firstQuestion = firstSet?.questions?.[0];
    assert(firstSet && firstQuestion, 'At least one default extraction question should be available.');
    await global.ZotExtract.addQuestionsToSession(createdSession.id, [{ questionSetId: firstSet.id, questionId: firstQuestion.id }]);
    await global.ZotExtract.runSession(createdSession.id);
    const sessionId = global.ZotExtract.currentSessionId;
    assert(sessionId, 'Starting from Zotero items should create a session.');
    const session = await global.ZotExtract.getSession(sessionId);
    assert.strictEqual(session.status, 'completed');
    assert.strictEqual(session.paperItemIds.length, 1);
    assert.strictEqual(session.questionRefs.length, 1);
    const cells = await global.ZotExtract.readResultCells(sessionId);
    assert.strictEqual(cells.length, 1);
    assert.strictEqual(cells[0].status, 'completed');
    assert.strictEqual(cells[0].structured.validation.parsed, true);
    assert.strictEqual(cells[0].structured.extraction.reasoning.includes('mocked full text'), true);
    assert.strictEqual(cells[0].structured.extraction.answer.contributionType, 'tool');
    assert.strictEqual(JSON.stringify(cells[0].structured.evidence), JSON.stringify([{ lines: 'L000001', note: 'Mock full-text evidence for the structured extraction.', sourceText: 'L000001: This is the full text of the paper.' }]));
    assert.strictEqual(cells[0].lineSourceMap.records[0].id, 'L000001');
    assert.strictEqual(cells[0].lineSourceMap.records[0].text, undefined, 'Stored session cells should not duplicate full line text in every source-map record.');

    console.log("\nTest 1 Complete.");

    // Test 1a: Running a session processes only pending cells
    console.log("\n--- Test 1a: Incremental Session Runs ---");
    const originalProcessSessionCellForIncremental = global.ZotExtract.processSessionCell;
    const originalRenderWorkspaceForIncremental = global.ZotExtract.renderSessionWorkspace;
    const originalShowProgressForIncremental = global.ZotExtract.showSessionProgress;
    const originalUpdateProgressForIncremental = global.ZotExtract.updateSessionProgress;
    const originalFinishProgressForIncremental = global.ZotExtract.finishSessionProgress;
    const originalUpdateOpenResultCellForIncremental = global.ZotExtract.updateOpenResultCell;
    try {
        const incrementalSet = {
            id: 'incremental-run-set',
            name: 'Incremental Run Set',
            description: '',
            questions: [{
                id: 'q-old',
                name: 'Existing completed question',
                prompt: 'Already done.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }, {
                id: 'q-new',
                name: 'New question',
                prompt: 'Run only this question.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }, {
                id: 'q-failed',
                name: 'Existing failed question',
                prompt: 'Do not rerun this failed cell automatically.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const existingSets = (await global.ZotExtract.loadQuestionSets()).filter(set => set.id !== incrementalSet.id);
        await global.ZotExtract.saveQuestionSets([...existingSets, incrementalSet]);
        const incrementalItem = {
            isRegularItem: () => true,
            getField: (field) => field === 'title' ? 'Incremental Mock Paper' : '',
            getBestAttachment: async () => null,
            getNotes: () => [],
            id: 654
        };
        mockItems.set(654, incrementalItem);
        const incrementalSession = await global.ZotExtract.saveSession({
            id: 'incremental-run-session',
            name: 'Incremental run session',
            status: 'completed',
            paperItemIds: [incrementalItem.id],
            questionRefs: [
                { questionSetId: incrementalSet.id, questionId: 'q-old' },
                { questionSetId: incrementalSet.id, questionId: 'q-new' },
                { questionSetId: incrementalSet.id, questionId: 'q-failed' }
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        await global.ZotExtract.writeResultCells(incrementalSession.id, [{
            sessionId: incrementalSession.id,
            itemId: incrementalItem.id,
            questionId: 'q-old',
            answer: 'old completed answer',
            status: 'completed'
        }, {
            sessionId: incrementalSession.id,
            itemId: incrementalItem.id,
            questionId: 'q-failed',
            answer: '',
            error: 'previous context error',
            status: 'failed'
        }]);
        const processedQuestionIds = [];
        const liveUpdates = [];
        global.ZotExtract.renderSessionWorkspace = async () => {};
        global.ZotExtract.showSessionProgress = () => {};
        global.ZotExtract.updateSessionProgress = () => {};
        global.ZotExtract.finishSessionProgress = () => {};
        global.ZotExtract.updateOpenResultCell = (_sessionId, cell) => liveUpdates.push({ questionId: cell.questionId, status: cell.status });
        global.ZotExtract.processSessionCell = async (session, item, question) => {
            processedQuestionIds.push(question.questionId);
            return {
                sessionId: session.id,
                itemId: item.id,
                questionId: question.questionId,
                questionSnapshot: question,
                answer: 'new answer',
                structured: { extraction: { answer: 'new answer' } },
                warnings: [],
                source: {},
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
                status: 'completed'
            };
        };
        const incrementalResult = await global.ZotExtract.runSession(incrementalSession.id);
        assert.deepStrictEqual(processedQuestionIds, ['q-new'], 'Run should process only missing cells after adding a new question.');
        assert(liveUpdates.some(update => update.questionId === 'q-new' && update.status === 'running'), 'New cells should render as running immediately.');
        assert(liveUpdates.some(update => update.questionId === 'q-new' && update.status === 'completed'), 'New cells should update as soon as the result is available.');
        const incrementalCells = await global.ZotExtract.readResultCells(incrementalSession.id);
        assert.strictEqual(incrementalCells.find(cell => cell.questionId === 'q-old')?.answer, 'old completed answer');
        assert.strictEqual(incrementalCells.find(cell => cell.questionId === 'q-failed')?.status, 'failed');
        assert.strictEqual(incrementalCells.find(cell => cell.questionId === 'q-new')?.status, 'completed');
        assert.strictEqual(incrementalResult.session.status, 'completed', 'Finished sessions should stay completed while failed/reviewable cells remain visible at cell level.');

        processedQuestionIds.length = 0;
        liveUpdates.length = 0;
        const rerunResult = await global.ZotExtract.rerunSessionCell(incrementalSession.id, incrementalItem.id, 'q-failed');
        assert.deepStrictEqual(processedQuestionIds, ['q-failed'], 'Cell rerun should process only the selected paper/question pair.');
        assert(liveUpdates.some(update => update.questionId === 'q-failed' && update.status === 'running'), 'Rerun cell should render as running immediately.');
        assert(liveUpdates.some(update => update.questionId === 'q-failed' && update.status === 'completed'), 'Rerun cell should update when the new result is available.');
        const rerunCells = await global.ZotExtract.readResultCells(incrementalSession.id);
        assert.strictEqual(rerunCells.find(cell => cell.questionId === 'q-old')?.answer, 'old completed answer');
        assert.strictEqual(rerunCells.find(cell => cell.questionId === 'q-new')?.status, 'completed');
        assert.strictEqual(rerunCells.find(cell => cell.questionId === 'q-failed')?.status, 'completed');
        assert.strictEqual(rerunResult.session.status, 'completed', 'A successful targeted rerun should keep the session completed.');
    } finally {
        global.ZotExtract.processSessionCell = originalProcessSessionCellForIncremental;
        global.ZotExtract.renderSessionWorkspace = originalRenderWorkspaceForIncremental;
        global.ZotExtract.showSessionProgress = originalShowProgressForIncremental;
        global.ZotExtract.updateSessionProgress = originalUpdateProgressForIncremental;
        global.ZotExtract.finishSessionProgress = originalFinishProgressForIncremental;
        global.ZotExtract.updateOpenResultCell = originalUpdateOpenResultCellForIncremental;
    }
    console.log("\nTest 1a Complete.");

    // Test 1b: Empty draft sessions can be created from the sessions view
    console.log("\n--- Test 1b: Empty Draft Session Creation ---");
    const emptySession = await global.ZotExtract.createEmptySession();
    assert(emptySession.id, 'Empty session should receive an id.');
    assert.strictEqual(emptySession.status, 'draft');
    assert.strictEqual(emptySession.paperItemIds.length, 0);
    assert.strictEqual(emptySession.questionRefs.length, 0);
    const loadedEmptySession = await global.ZotExtract.getSession(emptySession.id);
    assert.strictEqual(loadedEmptySession.name, 'New ZotExtract session');
    const activeRunningSession = await global.ZotExtract.saveSession({
        id: 'active-running-session',
        name: 'Active running session',
        status: 'completed',
        paperItemIds: [],
        questionRefs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    global.ZotExtract.activeSessionRuns.add(activeRunningSession.id);
    await global.ZotExtract.saveSession({ ...activeRunningSession, status: 'running' });
    assert.strictEqual((await global.ZotExtract.getSession(activeRunningSession.id)).status, 'running', 'Active running sessions must not be recovered while the UI renders them.');
    global.ZotExtract.activeSessionRuns.delete(activeRunningSession.id);
    assert.strictEqual((await global.ZotExtract.getSession(activeRunningSession.id)).status, 'draft', 'Only stale running sessions should be recovered.');
    const originalPromptForRename = global.Services.prompt.prompt;
    try {
        let promptCalledForRename = false;
        global.Services.prompt.prompt = (parent, title, text, input) => {
            promptCalledForRename = true;
            return true;
        };
        global.ZotExtract.currentSessionId = emptySession.id;
        const renamedSession = await global.ZotExtract.renameSession(emptySession.id, 'Renamed draft session', {}, { render: false });
        assert.strictEqual(promptCalledForRename, false, 'Session renaming should not open a prompt dialog.');
        assert.strictEqual(renamedSession.name, 'Renamed draft session');
        assert.strictEqual((await global.ZotExtract.getSession(emptySession.id)).name, 'Renamed draft session');
    } finally {
        global.Services.prompt.prompt = originalPromptForRename;
    }
    const originalRenderSessionsListForInlineRename = global.ZotExtract.renderSessionsList;
    try {
        let inlineInput = null;
        let renderedAfterInlineRename = false;
        const inlineSession = await global.ZotExtract.saveSession({
            ...emptySession,
            id: 'inline-rename-session',
            name: 'Inline rename session'
        });
        global.ZotExtract.renderSessionsList = async () => {
            renderedAfterInlineRename = true;
        };
        const parent = {
            child: null,
            replaceChild(next, previous) {
                assert.strictEqual(previous, this.child);
                previous.parentNode = null;
                next.parentNode = this;
                this.child = next;
            }
        };
        const nameNode = { parentNode: parent };
        parent.child = nameNode;
        const host = {
            querySelector(selector) {
                if (selector === '[data-ze-session-name]') return parent.child === nameNode ? nameNode : null;
                if (selector === '[data-ze-inline-session-name]') return parent.child === inlineInput ? inlineInput : null;
                return null;
            }
        };
        const doc = {
            createElement(tag) {
                assert.strictEqual(tag, 'input');
                inlineInput = {
                    value: '',
                    parentNode: null,
                    listeners: {},
                    setAttribute(key, value) {
                        this[key] = value;
                    },
                    addEventListener(type, listener) {
                        this.listeners[type] = listener;
                    },
                    focus() {
                        this.focused = true;
                    },
                    select() {
                        this.selected = true;
                    }
                };
                return inlineInput;
            }
        };
        const trigger = {
            ownerDocument: doc,
            closest: () => host
        };
        await global.ZotExtract.beginInlineSessionRename(inlineSession.id, {}, trigger, { surface: 'list' });
        assert.strictEqual(parent.child, inlineInput, 'Rename icon should swap the name text for an inline input.');
        assert.strictEqual(inlineInput.value, 'Inline rename session');
        assert.strictEqual(inlineInput.focused, true);
        inlineInput.value = 'Edited inline session';
        inlineInput.listeners.keydown({
            key: 'Enter',
            preventDefault() {},
            stopPropagation() {}
        });
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual((await global.ZotExtract.getSession(inlineSession.id)).name, 'Edited inline session');
        assert.strictEqual(renderedAfterInlineRename, true);
    } finally {
        global.ZotExtract.renderSessionsList = originalRenderSessionsListForInlineRename;
    }
    const originalOpenSessionsTabForEmpty = global.ZotExtract.openSessionsTab;
    const originalPaneForEmpty = global.Zotero.getActiveZoteroPane;
    try {
        global.ZotExtract.openSessionsTab = async () => {};
        global.Zotero.getActiveZoteroPane = () => ({
            getSelectedItems: () => [],
            getSelectedCollection: () => ({
                getChildItems: async () => [
                    { id: 901, isRegularItem: () => true, getField: () => 'Collection paper' }
                ]
            })
        });
        const startedEmptySession = await global.ZotExtract.startEmptySession();
        assert.strictEqual(startedEmptySession.paperItemIds.length, 0, 'New session button should create an empty draft even when a collection is selected.');
    } finally {
        global.ZotExtract.openSessionsTab = originalOpenSessionsTabForEmpty;
        global.Zotero.getActiveZoteroPane = originalPaneForEmpty;
    }
    console.log("\nTest 1b Complete.");

    // Test 2: Question-set migration and session sizing persistence
    console.log("\n--- Test 2: Question Sets and Session Layout Persistence ---");
    mockFiles.delete('/mock-profile/zotextract-data/question-sets.json');
    global.Zotero.Prefs.set('extensions.zotextract.prompts', JSON.stringify([
        {
            id: 'legacy-json',
            name: 'Legacy Research JSON',
            field: 'legacy-field',
            context: 'fulltext',
            output: 'json',
            prompt: 'Extract legacy research facts.'
        },
        {
            id: 'legacy-file-mode',
            name: 'Legacy File Mode',
            field: 'legacy-field',
            context: 'pdf-file',
            output: 'text',
            prompt: 'Process the source file.'
        }
    ]));
    const questionSets = await global.ZotExtract.loadQuestionSets();
    assert(questionSets.length >= 1);
    assert(questionSets[0].questions.length >= 1);
    const legacySet = questionSets.find(set => set.id === 'legacy-field');
    assert(legacySet, 'Legacy prompt field should migrate to a question set.');
    assert(legacySet.questions.some(question => question.name === 'Legacy Research'), 'Question names should hide technical JSON labels.');
    assert(!legacySet.questions.some(question => /File Mode/.test(question.name)), 'File-mode legacy prompts should not appear in the session picker.');
    assert(questionSets.some(set => set.id === 'results'), 'Default comparison-first question sets should be added for upgraded profiles.');
    const legacyQuestion = legacySet.questions.find(question => question.id === 'legacy-json');
    assert.strictEqual(legacyQuestion.context, undefined);
    assert.strictEqual(legacyQuestion.output, 'json');
    await global.ZotExtract.saveQuestionSets([{
        id: 'results',
        name: 'Results & Evaluation',
        description: '',
        questions: [{
            id: 'results-json',
            name: 'Results JSON',
            prompt: 'Return JSON only with this shape for the results.',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }, {
            id: 'custom-results-question',
            name: 'Custom results question',
            prompt: 'Extract the deployment constraints from the paper.',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }]);
    const upgradedSets = await global.ZotExtract.loadQuestionSets();
    const upgradedResultsSet = upgradedSets.find(set => set.id === 'results');
    assert(upgradedResultsSet.questions.some(question => question.id === 'main-result'), 'Built-in pack questions should be merged into a matching saved set.');
    assert(upgradedResultsSet.questions.some(question => question.id === 'custom-results-question'), 'Custom questions should be preserved on upgrade.');
    assert(!upgradedResultsSet.questions.some(question => /json|with this shape/i.test(`${question.id} ${question.name} ${question.prompt}`)), 'Legacy JSON-artifact questions should be scrubbed.');
    const autosaveQuestionSets = [{
        id: 'autosave-set',
        name: 'Autosave Set',
        questions: [{
            id: 'autosave-question',
            name: 'Old question',
            prompt: 'Old prompt',
            updatedAt: '2026-01-01T00:00:00.000Z'
        }],
        updatedAt: '2026-01-01T00:00:00.000Z'
    }];
    const autosaveChanged = global.ZotExtract.applyQuestionEditorValues(autosaveQuestionSets, 'autosave-set', 'autosave-question', {
        name: 'Edited JSON question',
        prompt: '  Updated prompt.  '
    });
    assert.strictEqual(autosaveChanged, true);
    assert.strictEqual(autosaveQuestionSets[0].questions[0].name, 'Edited question');
    assert.strictEqual(autosaveQuestionSets[0].questions[0].prompt, 'Updated prompt.');
    assert.notStrictEqual(autosaveQuestionSets[0].questions[0].updatedAt, '2026-01-01T00:00:00.000Z');
    autosaveQuestionSets[0].updatedAt = '2026-01-01T00:00:00.000Z';
    const autosaveSetChanged = global.ZotExtract.applyQuestionSetEditorValues(autosaveQuestionSets, 'autosave-set', {
        name: '  Renamed extraction set  ',
        description: '  Domain-specific questions.  '
    });
    assert.strictEqual(autosaveSetChanged, true);
    assert.strictEqual(autosaveQuestionSets[0].name, 'Renamed extraction set');
    assert.strictEqual(autosaveQuestionSets[0].description, 'Domain-specific questions.');
    assert.notStrictEqual(autosaveQuestionSets[0].updatedAt, '2026-01-01T00:00:00.000Z');
    session.columnWidths = { [mockRegularItem.id]: 444 };
    session.rowHeights = { 'context-diagnostics': 188 };
    await global.ZotExtract.saveSession(session);
    const reloadedSession = await global.ZotExtract.getSession(session.id);
    assert.strictEqual(reloadedSession.columnWidths[mockRegularItem.id], 444);
    assert.strictEqual(reloadedSession.rowHeights['context-diagnostics'], 188);

    const deletionSetsBase = await global.ZotExtract.loadQuestionSets();
    await global.ZotExtract.saveQuestionSets([
        ...deletionSetsBase.filter(set => !['editor-delete-set', 'editor-delete-whole-set'].includes(set.id)),
        {
            id: 'editor-delete-set',
            name: 'Editor Delete Set',
            description: '',
            questions: [{
                id: 'delete-me',
                name: 'Delete me',
                prompt: 'Remove this question.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }, {
                id: 'keep-me',
                name: 'Keep me',
                prompt: 'Keep this question.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        },
        {
            id: 'editor-delete-whole-set',
            name: 'Editor Delete Whole Set',
            description: '',
            questions: [{
                id: 'delete-with-set',
                name: 'Delete with set',
                prompt: 'Remove this set.',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    ]);
    const editorDeleteSession = await global.ZotExtract.saveSession({
        id: 'editor-delete-session',
        name: 'Editor delete session',
        status: 'completed',
        paperItemIds: [mockRegularItem.id],
        questionRefs: [
            { questionSetId: 'editor-delete-set', questionId: 'delete-me' },
            { questionSetId: 'editor-delete-set', questionId: 'keep-me' },
            { questionSetId: 'editor-delete-whole-set', questionId: 'delete-with-set' }
        ],
        rowHeights: { 'delete-me': 101, 'keep-me': 102, 'delete-with-set': 103 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    await global.ZotExtract.writeResultCells(editorDeleteSession.id, [
        { sessionId: editorDeleteSession.id, itemId: mockRegularItem.id, questionId: 'delete-me', questionSnapshot: { questionSetId: 'editor-delete-set' }, answer: 'delete result', status: 'completed' },
        { sessionId: editorDeleteSession.id, itemId: mockRegularItem.id, questionId: 'keep-me', questionSnapshot: { questionSetId: 'editor-delete-set' }, answer: 'keep result', status: 'completed' },
        { sessionId: editorDeleteSession.id, itemId: mockRegularItem.id, questionId: 'delete-with-set', questionSnapshot: { questionSetId: 'editor-delete-whole-set' }, answer: 'delete set result', status: 'completed' }
    ]);
    const originalConfirmForQuestionDelete = global.Services.prompt.confirm;
    const deleteConfirmations = [];
    try {
        global.Services.prompt.confirm = (parent, title, text) => {
            deleteConfirmations.push({ title, text });
            return true;
        };
        const deletedQuestion = await global.ZotExtract.deleteQuestionFromLibrary('editor-delete-set', 'delete-me');
        assert(deletedQuestion, 'Deleting a question from the editor library should return a result.');
        let afterDeleteSets = await global.ZotExtract.loadQuestionSets();
        assert(!afterDeleteSets.find(set => set.id === 'editor-delete-set').questions.some(question => question.id === 'delete-me'));
        assert(afterDeleteSets.find(set => set.id === 'editor-delete-set').questions.some(question => question.id === 'keep-me'));
        let afterDeleteSession = await global.ZotExtract.getSession(editorDeleteSession.id);
        assert(!afterDeleteSession.questionRefs.some(ref => ref.questionId === 'delete-me'));
        assert(afterDeleteSession.questionRefs.some(ref => ref.questionId === 'keep-me'));
        assert.strictEqual(afterDeleteSession.rowHeights['delete-me'], undefined);
        let afterDeleteCells = await global.ZotExtract.readResultCells(editorDeleteSession.id);
        assert(!afterDeleteCells.some(cell => cell.questionId === 'delete-me'));
        assert(afterDeleteCells.some(cell => cell.questionId === 'keep-me'));

        const deletedSet = await global.ZotExtract.deleteQuestionSetFromLibrary('editor-delete-whole-set');
        assert(deletedSet, 'Deleting a question set from the editor library should return a result.');
        afterDeleteSets = await global.ZotExtract.loadQuestionSets();
        assert(!afterDeleteSets.some(set => set.id === 'editor-delete-whole-set'));
        afterDeleteSession = await global.ZotExtract.getSession(editorDeleteSession.id);
        assert(!afterDeleteSession.questionRefs.some(ref => ref.questionSetId === 'editor-delete-whole-set'));
        assert.strictEqual(afterDeleteSession.rowHeights['delete-with-set'], undefined);
        afterDeleteCells = await global.ZotExtract.readResultCells(editorDeleteSession.id);
        assert(!afterDeleteCells.some(cell => cell.questionId === 'delete-with-set'));
        assert(afterDeleteCells.some(cell => cell.questionId === 'keep-me'));
    } finally {
        global.Services.prompt.confirm = originalConfirmForQuestionDelete;
    }
    assert.strictEqual(deleteConfirmations.length, 2);
    assert(deleteConfirmations[0].text.includes('result cell'));
    assert(deleteConfirmations[1].title.includes('question set'));

    console.log("\nTest 2 Complete.");

    // Test 3: Export bundle uses session result cells
    console.log("\n--- Test 3: ZotExtract Session Export Bundle ---");
    const bundle = await global.ZotExtract.buildSessionExportBundle(sessionId);
    assert.strictEqual(bundle.records.length, 1);
    const structuredRecord = bundle.records.find(record => record.structured?.extraction?.answer?.contributionType === 'tool');
    assert(structuredRecord, 'Export should retain structured session extraction.');
    assert.strictEqual(structuredRecord.validation.parsedEmbeddedJson, true);
    assert.strictEqual(bundle.privacy.includesRawFullText, false);
    const markdown = global.ZotExtract.renderExportMarkdown(bundle);
    const csv = global.ZotExtract.renderExportCsv(bundle);
    const tsv = global.ZotExtract.renderExportTsv(bundle);
    const html = global.ZotExtract.renderExportHtml(bundle);
    const xlsx = global.ZotExtract.renderExportXlsx(bundle);
    assert(markdown.includes('This export omits raw full text'));
    assert(markdown.includes('Extracted Fields'));
    assert(csv.includes('sessionId,sessionName,zoteroItemId,title,doi,questionId,question,model,status'));
    assert(tsv.includes('sessionId\tsessionName\tzoteroItemId\ttitle\tdoi\tquestionId'));
    assert(html.includes('<table>'));
    assert(ArrayBuffer.isView(xlsx));
    assert.strictEqual(String.fromCharCode(xlsx[0], xlsx[1]), 'PK');
    assert(csv.includes('exportedAt,sessionId,sessionName,zoteroItemId,title,doi,questionId,question,model,status,parsed,answer,reasoning,evidence,warnings,extraFields'));
    assert(!csv.split('\n')[0].includes('methods'));
    assert(!csv.split('\n')[0].includes('datasets'));
    assert(csv.includes('contributionType: tool'));
    assert.strictEqual(global.ZotExtract.csvEscape('=1+1'), "'=1+1");
    const exportFormats = global.ZotExtract.exportFormatOptions().map(format => format.id);
    assert.strictEqual(JSON.stringify(exportFormats), JSON.stringify(['xlsx', 'csv', 'tsv', 'json', 'markdown', 'html']));
    assert.strictEqual(global.ZotExtract.exportFormatForPath('results.tsv').id, 'tsv');
    assert(global.ZotExtract.renderExportPayload(bundle, 'json').includes('"schemaId": "zotextract.session-export.v1"'));
    const pickerWindow = { browsingContext: { name: 'picker-context' }, document: {} };
    assert.strictEqual(global.ZotExtract.exportFilePickerParents(pickerWindow)[0], pickerWindow.browsingContext);
    const originalCc = context.Cc;
    const originalCi = context.Ci;
    try {
        const nsIFilePicker = {
            modeSave: 2,
            filterAll: 1,
            returnCancel: 0,
            returnOK: 1,
            returnReplace: 2
        };
        const pickerInitCalls = [];
        context.Ci = { nsIFilePicker };
        context.Cc = {
            '@mozilla.org/filepicker;1': {
                createInstance: () => ({
                    filterIndex: 1,
                    file: { path: '/tmp/zotextract-manual-export' },
                    init: (parent, title, mode) => {
                        pickerInitCalls.push({ parent, title, mode });
                        assert.strictEqual(parent, pickerWindow.browsingContext);
                        assert.strictEqual(title, 'Export ZotExtract results');
                        assert.strictEqual(mode, nsIFilePicker.modeSave);
                    },
                    appendFilter: () => {},
                    appendFilters: () => {},
                    open: callback => callback(nsIFilePicker.returnOK)
                })
            }
        };
        const destination = await global.ZotExtract.pickExportDestination(bundle, pickerWindow);
        assert.strictEqual(pickerInitCalls.length, 1);
        assert.strictEqual(destination.format.id, 'csv');
        assert.strictEqual(destination.path, '/tmp/zotextract-manual-export.csv');
    } finally {
        context.Cc = originalCc;
        context.Ci = originalCi;
    }
    const originalPickExportDestination = global.ZotExtract.pickExportDestination;
    const originalWriteExportFile = global.ZotExtract.writeExportFile;
    const originalRenderWorkspaceForExport = global.ZotExtract.renderSessionWorkspace;
    const originalExportAlert = global.Services.prompt.alert;
    try {
        const writes = [];
        global.ZotExtract.pickExportDestination = async () => ({
            format: global.ZotExtract.exportFormatOptions().find(format => format.id === 'csv'),
            path: '/tmp/session-export.csv'
        });
        global.ZotExtract.writeExportFile = async (exportBundle, format, outputPath) => {
            writes.push({ exportBundle, format, outputPath });
            return outputPath;
        };
        global.ZotExtract.renderSessionWorkspace = async () => {};
        global.Services.prompt.alert = () => {};
        await global.ZotExtract.exportSession(sessionId, pickerWindow);
        assert.strictEqual(writes.length, 1);
        const exportedSession = await global.ZotExtract.getSession(sessionId);
        assert.strictEqual(exportedSession.status, 'completed');
        assert(exportedSession.exportedAt, 'Export should set export metadata without replacing workflow status.');
        assert.strictEqual(exportedSession.exportStale, false);
        assert.strictEqual(global.ZotExtract.sessionStatusLabel(exportedSession), 'Completed · Exported');
        assert.strictEqual(global.ZotExtract.sessionExportCurrent(exportedSession), true);
    } finally {
        global.ZotExtract.pickExportDestination = originalPickExportDestination;
        global.ZotExtract.writeExportFile = originalWriteExportFile;
        global.ZotExtract.renderSessionWorkspace = originalRenderWorkspaceForExport;
        global.Services.prompt.alert = originalExportAlert;
    }
    const exportPaths = await global.ZotExtract.writeExportBundle(bundle);
    assert(exportPaths.xlsx.endsWith('.xlsx'));
    assert(exportPaths.csv.endsWith('.csv'));
    assert(exportPaths.tsv.endsWith('.tsv'));
    assert(exportPaths.json.endsWith('.json'));
    assert(exportPaths.markdown.endsWith('.md'));
    assert(exportPaths.html.endsWith('.html'));
    assert(ArrayBuffer.isView(mockFiles.get(exportPaths.xlsx)));
    console.log("\nTest 3 Complete.");

    // Test 4: Malformed JSON model output becomes reviewable, not silently completed
    console.log("\n--- Test 4: Session JSON Review State ---");
    const originalFetchForReview = context.fetch;
    try {
        context.fetch = async () => ({
            ok: true,
            text: async () => JSON.stringify({
                choices: [{
                    message: {
                        content: '```json\n{"title":"Truncated","concepts":[{"label":"Broken"'
                    }
                }]
            })
        });
        const reviewCell = await global.ZotExtract.processSessionCell(
            { id: 'review-session' },
            mockRegularItem,
            {
                questionId: 'bad-json',
                questionName: 'Bad JSON',
                prompt: 'Return strict JSON.'
            },
            global.ZotExtract.getProviderSettings(),
            { cancelled: false, controllers: new Set() }
        );
        assert.strictEqual(reviewCell.status, 'needs-review');
        assert.strictEqual(reviewCell.structured.validation.parsed, false);
        assert(reviewCell.warnings.some(warning => /Structured JSON did not parse/.test(warning)));
        await global.ZotExtract.saveSession({
            id: 'review-session',
            name: 'Review session',
            status: 'completed',
            paperItemIds: [mockRegularItem.id],
            questionRefs: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        await global.ZotExtract.writeResultCells('review-session', [reviewCell]);
        const reviewBundle = await global.ZotExtract.buildSessionExportBundle('review-session');
        assert.strictEqual(reviewBundle.records.length, 1);
        assert.strictEqual(reviewBundle.records[0].status, 'needs-review');
        assert.strictEqual(reviewBundle.records[0].validation.parsedEmbeddedJson, false);
    } finally {
        context.fetch = originalFetchForReview;
    }
    console.log("\nTest 4 Complete.");

    // Test 4b: Sectioned output and valid legacy answer shapes parse cleanly
    console.log("\n--- Test 4b: Sectioned And Legacy Answer Parsing ---");
    const orphanAnswerText = [
        'Thinking Process:',
        'I should not have emitted this prose.',
        '{"reasoning":"Short support summary.","relevant_context":[{"lines":"L000001","note":"Relevant line."}]}',
        '"answer":{"explicit_limitations":"Recovered answer text."}'
    ].join('\n');
    const parsedLegacyAnswer = global.ZotExtract.parseJsonAnswer(orphanAnswerText);
    assert.strictEqual(parsedLegacyAnswer.ok, true);
    assert.strictEqual(parsedLegacyAnswer.value.answer.explicit_limitations, 'Recovered answer text.');
    const missingAnswerStructured = global.ZotExtract.buildStructuredResult(
        '{"reasoning":"Only support metadata.","relevant_context":[{"lines":"L000001","note":"Relevant line."}]}',
        { title: 'Missing Answer Paper' },
        { output: 'json' },
        [],
        {}
    );
    assert.strictEqual(missingAnswerStructured.validation.parsed, false);
    assert.strictEqual(missingAnswerStructured.validation.error, 'Structured JSON omitted top-level "answer".');
    const sectionedAnswer = global.ZotExtract.parseJsonAnswer([
        '## reasoning',
        'The cited line supports the answer.',
        '## context',
        'L000001-L000002 - Direct evidence.',
        '## answer',
        'Recovered section answer.'
    ].join('\n'));
    assert.strictEqual(sectionedAnswer.ok, true);
    assert.strictEqual(sectionedAnswer.value.answer, 'Recovered section answer.');
    assert.strictEqual(JSON.stringify(sectionedAnswer.value.relevant_context), JSON.stringify([{ lines: 'L000001-L000002', note: 'Direct evidence.' }]));
    const compactGemmaEvidence = global.ZotExtract.parseJsonAnswer([
        '## context',
        'Line 1-Line 2 - Compact Gemma-style evidence.',
        'L3 - Another compact citation.'
    ].join('\n'));
    assert.strictEqual(compactGemmaEvidence.ok, true);
    assert.strictEqual(
        JSON.stringify(compactGemmaEvidence.value.relevant_context),
        JSON.stringify([
            { lines: 'L000001-L000002', note: 'Compact Gemma-style evidence.' },
            { lines: 'L000003', note: 'Another compact citation.' }
        ])
    );
    assert.strictEqual(
        JSON.stringify(global.ZotExtract.normalizeLineRanges('Gemma cited L1-L3 and Line 7.')),
        JSON.stringify(['L000001-L000003', 'L000007'])
    );
    assert.strictEqual(
        JSON.stringify(global.ZotExtract.normalizeLineRanges('Use lines: 8 to line 9, line #10, and line numbers 11 through 12.')),
        JSON.stringify(['L000008-L000009', 'L000010', 'L000011-L000012'])
    );
    assert.strictEqual(
        JSON.stringify(global.ZotExtract.normalizeLineRanges('The year 2026 and score 1-3 are not line citations.')),
        JSON.stringify([])
    );
    console.log("\nTest 4b Complete.");

    // Test 5: Provider migration removes legacy embedded API keys
    console.log("\n--- Test 5: Provider Secret Migration ---");
    global.Zotero.Prefs.set('extensions.zotextract.apiKey', '');
    global.Zotero.Prefs.set('extensions.zotextract.provider', JSON.stringify({
        name: 'Legacy Secret Test',
        baseUrl: 'http://127.0.0.1:8789/v1',
        model: 'legacy-model',
        apiKey: 'legacy-secret',
        systemPrompt: 'legacy',
        wholePromptTemplate: 'Extraction question:\n{{question}}\n\nPaper context:\n{{context}}\n\nAnswer the extraction question using only the paper context. Cite line IDs such as L000123 when line-numbered context is available. If the context does not contain enough evidence, say what is missing.',
        chunkPromptTemplate: 'Scan this line-numbered paper window for evidence relevant to the extraction question.\nReturn only concise evidence that could help answer the question later.\nUse at most 5 short bullet lines for this window.\nCite line IDs or line ranges exactly as shown, for example L000123 or L000123-L000128.\nIf this window contains no relevant evidence, return exactly: No relevant evidence'
    }));
    const migratedProvider = global.ZotExtract.getProviderSettings();
    const migratedStored = JSON.parse(global.Zotero.Prefs.get('extensions.zotextract.provider'));
    assert.strictEqual(migratedProvider.apiKey, 'legacy-secret');
    assert.strictEqual(migratedStored.apiKey, undefined);
    assert.strictEqual(global.Zotero.Prefs.get('extensions.zotextract.apiKey'), 'legacy-secret');
    assert(migratedProvider.wholePromptTemplate.includes('## reasoning'));
    assert(migratedProvider.wholePromptTemplate.includes('## answer'));
    assert(migratedProvider.wholePromptTemplate.includes('Line-numbered answer context'));
    assert(!migratedProvider.wholePromptTemplate.includes('Example return format'));
    assert(migratedProvider.chunkPromptTemplate.includes('## context'));
    assert(migratedProvider.chunkPromptTemplate.includes('First pass'));
    console.log("\nTest 5 Complete.");

    // Test 6: Provider JSON does not duplicate the API key
    console.log("\n--- Test 6: Provider Secret Storage ---");
    global.ZotExtract.saveProviderSettings({
        name: 'Secret Test',
        baseUrl: 'http://127.0.0.1:8789/v1',
        model: 'secret-model',
        apiKey: 'secret-value',
        systemPrompt: 'test',
        contextWindowTokens: 16000,
        maxContextWindowTokens: 131072,
        contextWindowSource: 'LM Studio loaded model context',
        concurrentRequests: 99,
        maxTextCharacters: 500000,
        reasoningEffort: 'none',
        wholePromptTemplate: 'Question={{question}}\nContext={{context}}',
        chunkPromptTemplate: 'Chunk question={{question}}\nWindow={{windowRange}}\n{{context}}'
    });
    const providerStored = JSON.parse(global.Zotero.Prefs.get('extensions.zotextract.provider'));
    assert.strictEqual(providerStored.apiKey, undefined);
    assert.strictEqual(providerStored.fileEndpoint, undefined);
    assert.strictEqual(global.Zotero.Prefs.get('extensions.zotextract.apiKey'), 'secret-value');
    assert.strictEqual(providerStored.contextWindowTokens, 16000);
    assert.strictEqual(providerStored.maxContextWindowTokens, 131072);
    assert.strictEqual(providerStored.contextWindowSource, 'LM Studio loaded model context');
    assert.strictEqual(providerStored.concurrentRequests, 16);
    assert.strictEqual(providerStored.maxTextCharacters, 500000);
    assert.strictEqual(providerStored.reasoningEffort, 'none');
    assert.strictEqual(providerStored.wholePromptTemplate, 'Question={{question}}\nContext={{context}}');
    assert.strictEqual(providerStored.chunkPromptTemplate, 'Chunk question={{question}}\nWindow={{windowRange}}\n{{context}}');
    const loadedProvider = global.ZotExtract.getProviderSettings();
    assert.strictEqual(loadedProvider.concurrentRequests, 16);
    assert.strictEqual(loadedProvider.maxTextCharacters, 500000);
    assert.strictEqual(loadedProvider.reasoningEffort, 'none');
    assert.strictEqual(loadedProvider.wholePromptTemplate, 'Question={{question}}\nContext={{context}}');
    assert.strictEqual(loadedProvider.chunkPromptTemplate, 'Chunk question={{question}}\nWindow={{windowRange}}\n{{context}}');
    global.ZotExtract.saveProviderSettings({ ...loadedProvider, reasoningEffort: 'unsupported' });
    const invalidReasoningProvider = global.ZotExtract.getProviderSettings();
    assert.strictEqual(invalidReasoningProvider.reasoningEffort, '');
    global.Zotero.Prefs.set('extensions.zotextract.provider', '');
    global.Zotero.Prefs.set('extensions.zotextract.model', '');
    const defaultProvider = context.ZotExtractProviderSettings.defaults();
    assert.strictEqual(defaultProvider.model, 'gpt-5.4-nano');
    assert.strictEqual(
        context.ZotExtractProviderSettings.normalizeModelForProvider({ name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' }, 'gpt-4o-mini'),
        'gpt-4o-mini',
        'Explicit OpenAI model choices must not be silently migrated to the current default.'
    );
    assert.strictEqual(context.ZotExtractProviderSettings.isBundledDefaultModel('gpt-4o-mini'), false);
    assert.strictEqual(
        JSON.stringify(context.ZotExtractProviderSettings.modelOptionsForProvider({ name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' }).slice(0, 2)),
        JSON.stringify(['gemini-3.5-flash', 'gemini-2.5-flash'])
    );
    assert.strictEqual(
        context.ZotExtractProviderSettings.knownContextForModel('openai/gpt-5.4-nano').contextWindowTokens,
        400000
    );
    assert.strictEqual(
        context.ZotExtractProviderSettings.knownContextForModel('google/gemini-3.5-flash').contextWindowTokens,
        1048576
    );
    console.log("\nTest 6 Complete.");

    // Test 7: Runtime provider context detection and fallback
    console.log("\n--- Test 7: Runtime Provider Context Detection ---");
    const originalFetchForContext = context.fetch;
    try {
        context.fetch = async (url) => {
            if (String(url).includes('/api/v0/models')) {
                return {
                    ok: true,
                    json: async () => ({
                        data: [{
                            id: 'google/gemma-4-e2b',
                            loaded_context_length: 16000,
                            max_context_length: 131072
                        }]
                    })
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        };
        global.Zotero.Prefs.set('extensions.zotextract.apiKey', '');
        global.Zotero.Prefs.set('extensions.zotextract.provider', JSON.stringify({
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'google/gemma-4-e2b',
            contextWindowTokens: 0,
            maxContextWindowTokens: 0,
            contextWindowSource: '',
            concurrentRequests: 4
        }));
        const resolvedProvider = await global.ZotExtract.resolveProviderContext(global.ZotExtract.getProviderSettings());
        assert.strictEqual(resolvedProvider.contextWindowTokens, 16000);
        assert.strictEqual(resolvedProvider.maxContextWindowTokens, 131072);
        assert.strictEqual(resolvedProvider.contextWindowSource, 'LM Studio loaded model context');
        const resolvedStored = JSON.parse(global.Zotero.Prefs.get('extensions.zotextract.provider'));
        assert.strictEqual(resolvedStored.contextWindowTokens, 16000);
        assert.strictEqual(resolvedStored.maxContextWindowTokens, 131072);
        assert.strictEqual(resolvedStored.contextWindowSource, 'LM Studio loaded model context');

        context.fetch = async (url) => {
            if (String(url).includes('/api/v0/models')) {
                return {
                    ok: true,
                    json: async () => ({
                        data: [{
                            id: 'google/gemma-4-e2b',
                            loaded_context_length: 8192,
                            max_context_length: 131072
                        }]
                    })
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        };
        const refreshedProvider = await global.ZotExtract.resolveProviderContext({
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'google/gemma-4-e2b',
            contextWindowTokens: 16000,
            maxContextWindowTokens: 131072,
            contextWindowSource: 'LM Studio loaded model context'
        }, { refresh: true, persist: false });
        assert.strictEqual(refreshedProvider.contextWindowTokens, 8192, 'Run-time context refresh should honor the currently loaded LM Studio context.');
        assert.strictEqual(refreshedProvider.maxContextWindowTokens, 131072);

        context.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
        const fallbackProvider = await global.ZotExtract.resolveProviderContext({
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'unknown-local-model'
        }, { persist: false });
        assert.strictEqual(fallbackProvider.contextWindowTokens, 12000);
        assert.strictEqual(fallbackProvider.contextWindowSource, 'Conservative LM Studio fallback');

        context.fetch = async (url) => {
            if (String(url).includes('/api/v0/models')) {
                return {
                    ok: true,
                    json: async () => ({
                        data: [{
                            id: 'google/gemma-4-e2b',
                            max_context_length: 131072
                        }]
                    })
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        };
        const maxOnlyProvider = await global.ZotExtract.resolveProviderContext({
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'google/gemma-4-e2b'
        }, { persist: false });
        assert.strictEqual(maxOnlyProvider.contextWindowTokens, 12000, 'LM Studio max_context_length must not be treated as active usable context.');
        assert.strictEqual(maxOnlyProvider.maxContextWindowTokens, 12000);
        assert.strictEqual(maxOnlyProvider.contextWindowSource, 'Conservative LM Studio fallback');

        const openAIKnownContext = global.ZotExtract.fallbackProviderContextWindow({
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.4-nano'
        });
        assert.strictEqual(openAIKnownContext.contextWindowTokens, 400000);
        assert.strictEqual(openAIKnownContext.contextWindowSource, 'Known OpenAI model context');
        const googleKnownContext = global.ZotExtract.fallbackProviderContextWindow({
            name: 'Google Gemini',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            model: 'gemini-3.5-flash'
        });
        assert.strictEqual(googleKnownContext.contextWindowTokens, 1048576);

        const preferencesContext = {
            ZotExtractPreferences: undefined,
            ZotExtractProviderSettings: context.ZotExtractProviderSettings,
            Zotero: global.Zotero,
            fetch: null,
            AbortController: global.AbortController,
            URL: URL,
            console: console,
            setTimeout: setTimeout,
            clearTimeout: clearTimeout
        };
        vm.createContext(preferencesContext);
        vm.runInContext(preferencesCode.replace(/\nwaitForElement\('providerName', initPreferences\);\s*$/, ''), preferencesContext);
        const preferences = preferencesContext.ZotExtractPreferences;
        preferences.baseUrlInput = { value: '' };
        preferences.providerNameInput = { value: '' };
        preferences.modelInput = { value: '' };

        const localCandidateUrls = preferences.localProviderCandidates().map(candidate => candidate.probeUrl);
        assert(localCandidateUrls.includes('http://127.0.0.1:1234/v1/models'));
        assert(localCandidateUrls.includes('http://localhost:1234/v1/models'));
        assert(localCandidateUrls.includes('http://127.0.0.1:1234/api/v1/models'));
        assert(localCandidateUrls.includes('http://localhost:1234/api/v0/models'));
        const lmStudioApiCandidate = preferences.localProviderCandidates()
            .find(candidate => candidate.probeUrl === 'http://localhost:1234/api/v0/models');
        assert.strictEqual(lmStudioApiCandidate.baseUrl, 'http://localhost:1234/v1');
        assert.deepStrictEqual(
            lmStudioApiCandidate.parser({ data: [{ key: 'google/gemma-4-e2b' }, { display_name: 'display-model' }] }),
            ['google/gemma-4-e2b', 'display-model']
        );

        let zoteroHttpCall = null;
        let browserFetchUsed = false;
        preferencesContext.Zotero = {
            ...global.Zotero,
            HTTP: {
                request: async (method, url, options = {}) => {
                    zoteroHttpCall = { method, url, options };
                    return {
                        status: 200,
                        responseText: JSON.stringify({ data: [{ id: 'local-model' }] })
                    };
                }
            }
        };
        preferencesContext.fetch = async () => {
            browserFetchUsed = true;
            throw new Error('Browser fetch should not be used when Zotero.HTTP is available.');
        };
        const httpJson = await preferences.fetchJsonWithTimeout('http://localhost:1234/v1/models', 1800);
        assert.strictEqual(httpJson.data[0].id, 'local-model');
        assert.strictEqual(zoteroHttpCall.method, 'GET');
        assert.strictEqual(zoteroHttpCall.options.responseType, 'json');
        assert.strictEqual(browserFetchUsed, false);
        const discoveredOverZoteroHttp = await preferences.probeLocalProvider({
            id: 'openai-compatible-local',
            name: 'OpenAI-compatible local server',
            baseUrl: 'http://localhost:1234/v1',
            probeUrl: 'http://localhost:1234/v1/models',
            parser: data => (data.data || []).map(model => model.id).filter(Boolean)
        });
        assert.strictEqual(discoveredOverZoteroHttp.model, 'local-model');
        preferencesContext.Zotero = global.Zotero;

        let loadCalls = 0;
        preferencesContext.fetch = async (url, options = {}) => {
            if (String(url).includes('/api/v1/models/load')) {
                loadCalls += 1;
                return { ok: true, json: async () => ({ status: 'loaded' }) };
            }
            if (String(url).includes('/api/v1/models')) {
                return {
                    ok: true,
                    json: async () => ({
                        models: [{
                            id: 'google/gemma-4-e2b',
                            loaded_context_length: 16000,
                            max_context_length: 131072
                        }]
                    })
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        };
        const alreadyLoadedContext = await preferences.detectContextWindowForProvider({
            id: 'lm-studio',
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'google/gemma-4-e2b'
        }, { loadIfNeeded: true });
        assert.strictEqual(alreadyLoadedContext.contextWindowTokens, 16000);
        assert.strictEqual(loadCalls, 0, 'Settings context check should not load an already-loaded LM Studio model again.');

        let modelsProbeCount = 0;
        loadCalls = 0;
        preferencesContext.fetch = async (url, options = {}) => {
            if (String(url).includes('/api/v1/models/load')) {
                loadCalls += 1;
                assert.strictEqual(options.method, 'POST');
                assert.strictEqual(JSON.parse(options.body).model, 'google/gemma-4-e2b');
                return { ok: true, json: async () => ({ status: 'loaded' }) };
            }
            if (String(url).includes('/api/v1/models')) {
                modelsProbeCount += 1;
                return {
                    ok: true,
                    json: async () => ({
                        models: [{
                            id: 'google/gemma-4-e2b',
                            max_context_length: 131072,
                            ...(modelsProbeCount > 1 ? { loaded_context_length: 24000 } : {})
                        }]
                    })
                };
            }
            return { ok: false, status: 404, json: async () => ({}) };
        };
        const loadedAfterPreloadContext = await preferences.detectContextWindowForProvider({
            id: 'lm-studio',
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'google/gemma-4-e2b'
        }, { loadIfNeeded: true });
        assert.strictEqual(loadCalls, 1, 'Settings context check should preload an unloaded selected LM Studio model.');
        assert.strictEqual(loadedAfterPreloadContext.contextWindowTokens, 24000);
        assert.strictEqual(loadedAfterPreloadContext.maxContextWindowTokens, 131072);
    } finally {
        context.fetch = originalFetchForContext;
    }
    console.log("\nTest 7 Complete.");

    // Test 8: Provider fetch timeout and transient local-provider retry
    console.log("\n--- Test 8: Provider Fetch Timeout And Retry ---");
    const originalFetchForTimeout = context.fetch;
    const originalDefaultTimeout = global.ZotExtract.defaultRequestTimeoutMs;
    try {
        global.ZotExtract.defaultRequestTimeoutMs = 25;
        context.fetch = async () => new Promise(() => {});
        const startedAt = Date.now();
        await assert.rejects(
            () => global.ZotExtract.fetchWithTimeout(
                'http://127.0.0.1:8789/v1/chat/completions',
                { method: 'POST', body: '{}' },
                {},
                { cancelled: false, controllers: new Set() }
            ),
            /Request timed out/
        );
        assert(Date.now() - startedAt < 1000, 'Timeout should not wait for an abort-aware fetch implementation.');

        context.fetch = async () => new Promise(() => {});
        const cancelRunState = { cancelled: false, controller: null, controllers: new Set(), cancelWaiters: new Set() };
        const cancelStartedAt = Date.now();
        const cancellableRequest = global.ZotExtract.fetchWithTimeout(
            'http://127.0.0.1:8789/v1/chat/completions',
            { method: 'POST', body: '{}' },
            { timeoutSeconds: 120 },
            cancelRunState
        );
        global.ZotExtract.cancelRunState(cancelRunState);
        await assert.rejects(cancellableRequest, /Request cancelled by user/);
        assert(Date.now() - cancelStartedAt < 1000, 'Cancel should stop ZotExtract immediately even when fetch never settles.');
        assert.strictEqual(cancelRunState.cancelled, true);
        assert.strictEqual(cancelRunState.cancelWaiters.size, 0);

        let attempts = 0;
        const requestBodies = [];
        const requestHeaders = [];
        context.fetch = async (_url, options = {}) => {
            attempts++;
            if (options.body) requestBodies.push(JSON.parse(options.body));
            if (options.headers) requestHeaders.push(options.headers);
            if (attempts === 1) throw new Error('NetworkError when attempting to fetch resource.');
            return {
                ok: true,
                text: async () => JSON.stringify({
                    choices: [{ message: { content: 'retry success' } }]
                })
            };
        };
        const retryAnswer = await global.ZotExtract.callWithText(
            {
                name: 'Local retry provider',
                baseUrl: 'http://127.0.0.1:8789/v1',
                model: 'fake-model',
                systemPrompt: 'Retry test',
                retryCount: 1,
                reasoningEffort: 'none'
            },
            'Retry context',
            'Return text.',
            { cancelled: false, controllers: new Set() }
        );
        assert.strictEqual(retryAnswer, 'retry success');
        assert.strictEqual(attempts, 2);
        assert(requestBodies.every(body => !Object.prototype.hasOwnProperty.call(body, 'reasoning_effort')), 'Reasoning effort "none" should be omitted for generic local chat completion requests.');
        const lmStudioNoneAnswer = await global.ZotExtract.callWithText(
            {
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                model: 'google/gemma-4-e2b',
                systemPrompt: 'Retry test',
                retryCount: 0,
                reasoningEffort: 'none'
            },
            'Retry context',
            'Return text.',
            { cancelled: false, controllers: new Set() }
        );
        assert.strictEqual(lmStudioNoneAnswer, 'retry success');
        assert.strictEqual(requestBodies.at(-1).reasoning_effort, 'none', 'LM Studio needs explicit reasoning_effort "none" to avoid hidden reasoning-only responses.');
        const openAIAnswer = await global.ZotExtract.callWithText(
            {
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-5.4-nano',
                systemPrompt: 'OpenAI request-shape test',
                retryCount: 0,
                reasoningEffort: 'none'
            },
            'Retry context',
            'Return text.',
            { cancelled: false, controllers: new Set() }
        );
        assert.strictEqual(openAIAnswer, 'retry success');
        const openAIBody = requestBodies.at(-1);
        assert.strictEqual(openAIBody.model, 'gpt-5.4-nano');
        assert.strictEqual(Object.prototype.hasOwnProperty.call(openAIBody, 'max_completion_tokens'), true);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(openAIBody, 'max_tokens'), false);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(openAIBody, 'temperature'), false);
        assert.strictEqual(openAIBody.reasoning_effort, 'none');

        await global.ZotExtract.callWithText(
            {
                name: 'Google Gemini',
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
                model: 'gemini-3.5-flash',
                systemPrompt: 'Google request-shape test',
                retryCount: 0,
                reasoningEffort: 'none'
            },
            'Retry context',
            'Return text.',
            { cancelled: false, controllers: new Set() }
        );
        const googleBody = requestBodies.at(-1);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(googleBody, 'max_tokens'), true);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(googleBody, 'temperature'), false);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(googleBody, 'reasoning_effort'), false);

        await global.ZotExtract.callWithText(
            {
                name: 'OpenRouter',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'openai/gpt-5.4-nano',
                apiKey: 'router-key',
                systemPrompt: 'OpenRouter request-shape test',
                retryCount: 0,
                reasoningEffort: 'none'
            },
            'Retry context',
            'Return text.',
            { cancelled: false, controllers: new Set() }
        );
        const openRouterBody = requestBodies.at(-1);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(openRouterBody, 'max_tokens'), true);
        assert.strictEqual(Object.prototype.hasOwnProperty.call(openRouterBody, 'reasoning_effort'), false);
        assert.strictEqual(requestHeaders.at(-1)['X-OpenRouter-Title'], 'ZotExtract');
    } finally {
        context.fetch = originalFetchForTimeout;
        global.ZotExtract.defaultRequestTimeoutMs = originalDefaultTimeout;
    }
    console.log("\nTest 8 Complete.");

    // Test 8b: Prompt templates and context budget diagnostics
    console.log("\n--- Test 8b: Prompt Templates And Context Budget ---");
    const originalFetchForTemplates = context.fetch;
    try {
        const requestBodies = [];
        context.fetch = async (_url, options = {}) => {
            requestBodies.push(JSON.parse(options.body));
            return {
                ok: true,
                text: async () => JSON.stringify({
                    choices: [{ message: { content: 'template success' } }]
                })
            };
        };
        const templatedAnswer = await global.ZotExtract.callWithText(
            {
                name: 'Template Provider',
                baseUrl: 'http://127.0.0.1:8789/v1',
                model: 'fake-model',
                systemPrompt: 'Template system',
                wholePromptTemplate: 'Question={{question}}\nContext={{context}}\nDone',
                contextWindowTokens: 16000,
                retryCount: 0
            },
            'Line context L000001.',
            'Extract facts.',
            { cancelled: false, controllers: new Set() }
        );
        assert.strictEqual(templatedAnswer, 'template success');
        assert(requestBodies[0].messages[1].content.includes('Question=Extract facts.'));
        assert(requestBodies[0].messages[1].content.includes('Context=Line context L000001.'));

        assert.strictEqual(
            global.ZotExtract.effectiveContextWindowTokens({
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                contextWindowTokens: 16000,
                activeConcurrentRequests: 4
            }),
            16000,
            'Concurrent workers must not shrink the per-request context window.'
        );
        assert.strictEqual(
            global.ZotExtract.concurrentRequests({
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                concurrentRequests: 4
            }),
            4,
            'Configured local concurrency should remain available for providers and request sizes that can use it.'
        );
        assert.strictEqual(
            global.ZotExtract.localConcurrencyStrategy({
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1'
            }),
            'context-aware',
            'LM Studio should use context-aware scheduling instead of a blanket serial rule.'
        );
        assert.strictEqual(
            global.ZotExtract.localConcurrencyStrategy({
                name: 'Ollama',
                baseUrl: 'http://127.0.0.1:11434'
            }),
            'server-managed',
            'Ollama should be allowed to manage configured parallel requests and queueing itself.'
        );
        assert.strictEqual(
            global.ZotExtract.contextAwareConcurrentRequests({
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                contextWindowTokens: 16000
            }, 4, { totalTokens: 7200, exact: false }),
            1,
            'Estimated long local requests should be serialized when the aggregate context would not fit.'
        );
        assert.strictEqual(
            global.ZotExtract.contextAwareConcurrentRequests({
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                contextWindowTokens: 16000
            }, 4, { totalTokens: 2200, exact: false }),
            4,
            'Small local requests should keep configured concurrency when the aggregate context fits.'
        );
        const originalGetItemByIdForConcurrency = global.ZotExtract.getItemById;
        const originalBestPdfAttachmentForConcurrency = global.ZotExtract.bestPdfAttachment;
        const originalBuildMaximumContextForConcurrency = global.ZotExtract.buildMaximumContext;
        try {
            let plannedContextText = 'Compact paper context.';
            global.ZotExtract.getItemById = async (id) => ({
                id,
                getField: (field) => field === 'title' ? `Concurrency Paper ${id}` : ''
            });
            global.ZotExtract.bestPdfAttachment = async () => null;
            global.ZotExtract.buildMaximumContext = async () => ({
                text: plannedContextText,
                metadata: 'Title: Concurrency Paper',
                fullText: '',
                chunks: [],
                warnings: []
            });
            const concurrencyProvider = {
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                model: 'google/gemma-4-e2b',
                contextWindowTokens: 16000,
                concurrentRequests: 4,
                systemPrompt: 'Test system prompt'
            };
            const concurrencyJobs = [1, 2, 3, 4].map(id => ({
                itemId: id,
                question: { questionId: `q-${id}`, prompt: 'Extract concise facts.' }
            }));
            const compactPlan = await global.ZotExtract.planRunConcurrency(concurrencyProvider, concurrencyJobs);
            assert.strictEqual(compactPlan.concurrency, 4, 'Context-aware local planning should keep concurrency for compact requests.');
            plannedContextText = 'Long local request context. '.repeat(1600);
            const longPlan = await global.ZotExtract.planRunConcurrency(concurrencyProvider, concurrencyJobs);
            assert.strictEqual(longPlan.concurrency, 1, 'Context-aware local planning should serialize long aggregate requests.');
            assert.strictEqual(compactPlan.progressPlan.totalPapers, 4);
            assert.strictEqual(compactPlan.progressPlan.totalPrompts, 4);
        } finally {
            global.ZotExtract.getItemById = originalGetItemByIdForConcurrency;
            global.ZotExtract.bestPdfAttachment = originalBestPdfAttachmentForConcurrency;
            global.ZotExtract.buildMaximumContext = originalBuildMaximumContextForConcurrency;
        }
        const originalUpdateProgressForPromptGranularity = global.ZotExtract.updateSessionProgress;
        try {
            const progressUpdates = [];
            global.ZotExtract.updateSessionProgress = (done, total, label, options = {}) => {
                progressUpdates.push({ done, total, label, options });
            };
            const progressRunState = {
                progress: global.ZotExtract.createSessionProgressState(
                    { totalPrompts: 5, totalPapers: 2 },
                    [{ itemId: 1 }, { itemId: 1 }, { itemId: 2 }]
                )
            };
            global.ZotExtract.advanceSessionPromptProgress(progressRunState, 1, 'Paper A');
            let latestProgress = progressUpdates[progressUpdates.length - 1];
            assert.strictEqual(latestProgress.done, 0, 'Prompt progress should not change the visible paper count.');
            assert.strictEqual(latestProgress.total, 2);
            assert.strictEqual(latestProgress.options.barDone, 1, 'Prompt progress should advance the bar.');
            assert.strictEqual(latestProgress.options.barTotal, 5);
            global.ZotExtract.markSessionJobComplete(progressRunState, 1, 'Paper A');
            latestProgress = progressUpdates[progressUpdates.length - 1];
            assert.strictEqual(latestProgress.done, 0, 'A paper with remaining prompts should not count as complete.');
            global.ZotExtract.markSessionJobComplete(progressRunState, 1, 'Paper A');
            latestProgress = progressUpdates[progressUpdates.length - 1];
            assert.strictEqual(latestProgress.done, 1, 'The paper count should advance only after all planned cells for that paper finish.');
            assert.strictEqual(latestProgress.options.barDone, 1);
        } finally {
            global.ZotExtract.updateSessionProgress = originalUpdateProgressForPromptGranularity;
        }
        assert.strictEqual(
            global.ZotExtract.concurrentRequests({
                name: 'Remote',
                baseUrl: 'https://api.openai.com/v1',
                concurrentRequests: 4
            }),
            4,
            'Remote providers should still honor configured concurrency.'
        );
        assert(
            global.ZotExtract.contextBudgetTokens({
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                contextWindowTokens: 16000,
                systemPrompt: 'Test system prompt'
            }, 'Extract facts.') < global.ZotExtract.contextBudgetTokens({
                name: 'Remote',
                baseUrl: 'https://api.openai.com/v1',
                contextWindowTokens: 16000,
                systemPrompt: 'Test system prompt'
            }, 'Extract facts.'),
            'Local providers should keep a safety margin below the nominal context window.'
        );
        assert.strictEqual(
            global.ZotExtract.usableContextWindowTokens({
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                contextWindowTokens: 16000
            }),
            12000,
            'Local provider fallback token estimates need a conservative margin below the active context window.'
        );
        assert.strictEqual(
            global.ZotExtract.usableContextWindowTokens({
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                contextWindowTokens: 16000
            }, { tokens: 1000, exact: true }),
            14400,
            'Exact provider tokenizers can use the larger local-provider safety margin.'
        );
        const compactDirectDiagnostics = global.ZotExtract.renderContextDiagnosticsHtml({
            contextWindowTokens: 16000,
            usableWindowTokens: 12000,
            requestInputTokens: 4200,
            maxCompletionTokens: 1440,
            sliding: false,
            evidenceCollectionMode: 'single-window',
            windowCount: 1
        }, { count: 2, totalMs: 181000, averageMs: 90500 });
        assert(compactDirectDiagnostics.includes('Two-pass evidence'));
        assert(compactDirectDiagnostics.includes('1 evidence window'));
        assert(compactDirectDiagnostics.includes('Avg extraction: 1m 31s'));
        assert(!/Input:|Max output:|Window:|Usable:|Budget:|Text cap|Lines:/i.test(compactDirectDiagnostics), 'Context diagnostics should stay compact in the matrix.');
        const compactSlidingDiagnostics = global.ZotExtract.renderContextDiagnosticsHtml({
            contextWindowTokens: 16000,
            usableWindowTokens: 12000,
            requestInputTokens: 18000,
            maxCompletionTokens: 1440,
            sliding: true,
            evidenceCollectionMode: 'sliding-window',
            windowCount: 4
        });
        assert(compactSlidingDiagnostics.includes('Sliding evidence'));
        assert(compactSlidingDiagnostics.includes('4 evidence windows'));
        assert(/12[,.]000 tokens per request/.test(compactSlidingDiagnostics));
        assert(!compactSlidingDiagnostics.includes('19,440 /'), 'Sliding diagnostics should not show the oversized unwindowed request as the active request size.');
        assert(!/Input:|Max output:|Window:|Usable:|Budget:|Text cap|Lines:/i.test(compactSlidingDiagnostics), 'Sliding diagnostics should not expose verbose budgeting rows.');
        const originalTokenFetch = context.fetch;
        try {
            const tokenizedUrls = [];
            context.fetch = async (url) => {
                tokenizedUrls.push(String(url));
                if (String(url).includes('/tokenize')) {
                    return { ok: true, json: async () => ({ tokens: [1, 2, 3, 4, 5, 6, 7] }) };
                }
                return { ok: false, status: 404, json: async () => ({}) };
            };
            global.ZotExtract.tokenCountCache.clear();
            global.ZotExtract.tokenEndpointFailures.clear();
            const providerTokenInfo = await global.ZotExtract.requestInputTokenInfo({
                name: 'llama.cpp',
                baseUrl: 'http://127.0.0.1:8080',
                model: 'llama-test',
                systemPrompt: 'System'
            }, 'Context text.', 'Question text.');
            assert.strictEqual(providerTokenInfo.tokens, 7);
            assert.strictEqual(providerTokenInfo.exact, true);
            assert(providerTokenInfo.method.includes('provider-tokenizer'));
            assert(tokenizedUrls.some(url => url.endsWith('/tokenize')));
        } finally {
            context.fetch = originalTokenFetch;
        }
        const gemmaEstimate = await global.ZotExtract.requestInputTokenInfo({
            name: 'LM Studio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'google/gemma-4-e2b',
            systemPrompt: 'System'
        }, 'Representative local context with L000001 and L000002 citations.', 'Extract facts.', { useProviderTokenizer: false });
        const genericLocalEstimate = await global.ZotExtract.requestInputTokenInfo({
            name: 'Local Server',
            baseUrl: 'http://127.0.0.1:9999/v1',
            model: 'unknown-local-model',
            systemPrompt: 'System'
        }, 'Representative local context with L000001 and L000002 citations.', 'Extract facts.', { useProviderTokenizer: false });
        assert.strictEqual(gemmaEstimate.method, 'estimated-gemma');
        assert.strictEqual(genericLocalEstimate.method, 'estimated-local-conservative');
        assert(genericLocalEstimate.tokens >= gemmaEstimate.tokens, 'Unknown local models should use a more conservative fallback than calibrated Gemma counts.');
        const fittingFullText = Array.from({ length: 90 }, (_, index) => `Line ${index + 1} has reproducible evidence and methodological detail.`).join('\n');
        const fittingContext = {
            metadata: 'Title: Fits Context Paper',
            fullText: fittingFullText,
            text: `Title: Fits Context Paper\n\nFull text with line numbers:\n${fittingFullText}`,
            chunks: [],
            warnings: []
        };
        const originalCallWithTextForFitting = global.ZotExtract.callWithText;
        const fittingScanCalls = [];
        try {
            global.ZotExtract.callWithText = async (_provider, text, promptText, _runState, options = {}) => {
                fittingScanCalls.push({ text, promptText, options });
                const firstLine = String(text).match(/L\d{6}/)?.[0] || 'L000001';
                return ['## context', `${firstLine} - Fitting-paper evidence.`].join('\n');
            };
            const preparedFitting = await global.ZotExtract.prepareContextForQuestion(
                {
                    name: 'LM Studio',
                    baseUrl: 'http://127.0.0.1:1234/v1',
                    model: 'gemma-test',
                    contextWindowTokens: 16000,
                    activeConcurrentRequests: 4,
                    systemPrompt: 'Test system prompt'
                },
                fittingContext,
                'Extract methods and evidence.',
                { cancelled: false, controllers: new Set() }
            );
            assert.strictEqual(fittingScanCalls.length, 1, 'A fitting full-text paper should use one evidence-collection pass.');
            assert(fittingScanCalls[0].options.rawUserPrompt, 'Evidence collection should send the rendered first-pass prompt as the user prompt.');
            assert(preparedFitting.text.includes('first evidence pass'));
            assert(preparedFitting.text.includes('Line 1 has reproducible evidence'));
            assert(!preparedFitting.text.includes('Fitting-paper evidence'), 'Prepared context should rehydrate source lines, not scan notes.');
            assert.strictEqual(preparedFitting.evidenceCollectionMode, 'single-window');
            assert.strictEqual(preparedFitting.evidenceWindowCount, 1);
            assert.strictEqual(preparedFitting.finalContextMode, 'collected-evidence');
        } finally {
            global.ZotExtract.callWithText = originalCallWithTextForFitting;
        }
        const emptyEvidenceCalls = [];
        try {
            global.ZotExtract.callWithText = async (_provider, text, promptText, _runState, options = {}) => {
                emptyEvidenceCalls.push({ text, promptText, options });
                return ['## context', 'No relevant evidence.'].join('\n');
            };
            const fallbackPrepared = await global.ZotExtract.prepareContextForQuestion(
                {
                    name: 'OpenAI',
                    baseUrl: 'https://api.openai.com/v1',
                    model: 'gpt-5.4-nano',
                    contextWindowTokens: 400000,
                    systemPrompt: 'Test system prompt'
                },
                {
                    metadata: 'Title: Broad Overview Paper',
                    fullText: 'The abstract states a clear contribution. The paper introduces a useful extraction system.',
                    text: 'Title: Broad Overview Paper\n\nFull text with line numbers:\nL000001: The abstract states a clear contribution.\nL000002: The paper introduces a useful extraction system.',
                    chunks: [],
                    warnings: []
                },
                'State the single main contribution or claim of this paper.',
                { cancelled: false, controllers: new Set() }
            );
            assert.strictEqual(emptyEvidenceCalls.length, 1, 'Empty evidence should still run the first-pass scan once.');
            assert.strictEqual(fallbackPrepared.finalContextMode, 'full-line-context');
            assert.strictEqual(fallbackPrepared.evidenceCollectionMode, 'single-window');
            assert(fallbackPrepared.text.includes('L000001: The abstract states a clear contribution.'));
            assert(fallbackPrepared.warnings.some(warning => warning.includes('evidence pass returned no cited lines')));
        } finally {
            global.ZotExtract.callWithText = originalCallWithTextForFitting;
        }
        const metadataOnlyPrepared = await global.ZotExtract.prepareContextForQuestion(
            {
                name: 'LM Studio',
                baseUrl: 'http://127.0.0.1:1234/v1',
                model: 'gemma-test',
                contextWindowTokens: 16000,
                systemPrompt: 'Test system prompt'
            },
            {
                metadata: 'Title: Metadata Only Paper',
                fullText: '',
                text: 'Title: Metadata Only Paper',
                chunks: [],
                warnings: []
            },
            'Extract methods and evidence.',
            { cancelled: false, controllers: new Set() }
        );
        assert.strictEqual(metadataOnlyPrepared.evidenceCollectionMode, 'metadata-only');
        assert.strictEqual(metadataOnlyPrepared.evidenceWindowCount, 0);
        assert.strictEqual(metadataOnlyPrepared.finalContextMode, 'metadata-only');
        assert(metadataOnlyPrepared.warnings.some(warning => warning.includes('metadata only')));
        const mediumLineContext = Array.from({ length: 110 }, (_, index) => {
            const id = `L${String(index + 1).padStart(6, '0')}`;
            return `${id}: This line contains detailed scientific prose, numeric evidence, treatment planning context, and methodological information for context-window testing.`;
        }).join('\n');
        assert.strictEqual(
            global.ZotExtract.requestFitsContextWindow(
                {
                    name: 'LM Studio',
                    baseUrl: 'http://127.0.0.1:1234/v1',
                    model: 'google/gemma-4-e2b',
                    contextWindowTokens: 16000,
                    systemPrompt: 'Test system prompt'
                },
                `Title: Medium Paper\n\nFull text with line numbers:\n${mediumLineContext}`,
                'Summarize the paper in 5 focused bullets.'
            ),
            true,
            'A medium rendered prompt with room for max output should fit into a 16k local context.'
        );
        const realPaperSizedLines = Array.from({ length: 900 }, (_, index) => {
            const id = `L${String(index + 1).padStart(6, '0')}`;
            return `${id}: This line stands in for extracted scientific paper text with citations, equations, method details, benchmark values, limitations, and repeated technical terminology.`;
        }).join('\n');
        assert.strictEqual(
            global.ZotExtract.requestFitsContextWindow(
                {
                    name: 'LM Studio',
                    baseUrl: 'http://127.0.0.1:1234/v1',
                    model: 'google/gemma-4-e2b',
                    contextWindowTokens: 16000,
                    systemPrompt: 'Test system prompt'
                },
                `Title: Real Paper Sized\n\nFull text with line numbers:\n${realPaperSizedLines}`,
                'Summarize the paper in 5 focused bullets.'
            ),
            false,
            'A real-paper-sized rendered prompt must not be treated as fitting into a 16k local context.'
        );
        const originalStorageDirectory = global.Zotero.Attachments.getStorageDirectory;
        const originalBuildLineSourceMap = global.ZotExtract.buildLineSourceMapForAttachment;
        const originalItemsGet = global.Zotero.Items.get;
        try {
            const cacheText = Array.from({ length: 400 }, (_, index) => `Full cached paper line ${index + 1} with methods, evidence, and results.`).join('\n');
            mockFiles.set('/mock-storage/.zotero-ft-cache', cacheText);
            global.Zotero.Attachments.getStorageDirectory = () => ({ path: '/mock-storage' });
            global.Zotero.Items.get = (id) => id === 999
                ? { id: 999, getFilePathAsync: async () => '/mock-storage/mock.pdf' }
                : originalItemsGet(id);
            let sourceMapCalls = 0;
            global.ZotExtract.buildLineSourceMapForAttachment = async () => {
                sourceMapCalls++;
                return {
                    records: [
                        { id: 'L000001', lineNumber: 1, text: 'Partial coordinate line.', page: 1, rects: [] }
                    ],
                    hasCoordinates: true
                };
            };
            const textInfo = await global.ZotExtract.getFullText(999, { info: true, provider: { maxTextCharacters: 400000 } });
            assert.strictEqual(textInfo.text, cacheText, 'Full-text cache should remain canonical when coordinate extraction is partial.');
            assert(textInfo.lineRecords.length > 100, 'Partial coordinate records should be replaced with fallback lines from cached text.');
            assert.strictEqual(sourceMapCalls, 0, 'Plain full-text reads should not run the coordinate coverage pass.');
            const coordinateTextInfo = await global.ZotExtract.getFullText(999, { info: true, coordinateAware: true, provider: { maxTextCharacters: 400000 } });
            assert.strictEqual(coordinateTextInfo.warnings.length, 0, 'Partial coordinate coverage should silently fall back to indexed text.');
            assert.strictEqual(sourceMapCalls, 1);
            const maximumContext = await global.ZotExtract.buildMaximumContext(
                {
                    id: 1000,
                    getField: field => field === 'title' ? 'Line source extraction paper' : ''
                },
                { id: 999 },
                { maxTextCharacters: 400000 }
            );
            assert.strictEqual(sourceMapCalls, 2, 'Session extraction context should request coordinate-aware maps for PDF evidence navigation.');
            assert.strictEqual(maximumContext.warnings.length, 0);
        } finally {
            global.Zotero.Attachments.getStorageDirectory = originalStorageDirectory;
            global.ZotExtract.buildLineSourceMapForAttachment = originalBuildLineSourceMap;
            global.Zotero.Items.get = originalItemsGet;
            mockFiles.delete('/mock-storage/.zotero-ft-cache');
        }
        assert.strictEqual(global.ZotExtract.questionExpectsJson({ questionId: 'legacy-json-id' }, 'Extract research facts.'), true);
    } finally {
        context.fetch = originalFetchForTemplates;
    }
    console.log("\nTest 8b Complete.");

    // Test 9: Result-cell rendering escapes model-controlled fields
    console.log("\n--- Test 9: ZotExtract Result Cell HTML Escaping ---");
    const hostileCellHtml = global.ZotExtract.renderResultCellHtml({
        sessionId: 'hostile-session',
        itemId: 456,
        questionId: 'hostile-question',
        answer: '<script>alert(1)</script>\n<img src=x onerror=alert(2)>',
        structured: {
            extraction: {
                reasoning: '<script>alert(4)</script>',
                answer: {
                    risk: '<img src=x onerror=alert(3)>',
                    score: 0.98
                }
            },
            evidence: [{ lines: 'L000001', note: '<img src=x onerror=alert(5)>' }],
            provenance: { evidenceCollectionMode: 'single-window', evidenceWindowCount: 1, finalContextMode: 'collected-evidence' }
        },
        warnings: ['<script>alert(6)</script>'],
        status: 'completed'
    });
    assert(!hostileCellHtml.includes('<script>alert(1)</script>'));
    assert(!hostileCellHtml.includes('<script>alert(4)</script>'));
    assert(!hostileCellHtml.includes('<script>alert(6)</script>'));
    assert(!hostileCellHtml.includes('<img src=x onerror=alert'));
    assert(hostileCellHtml.includes('&lt;img src=x onerror=alert(3)&gt;'));
    assert(hostileCellHtml.includes('&lt;img src=x onerror=alert(5)&gt;'));
    assert(hostileCellHtml.includes('0.98'));
    assert(hostileCellHtml.includes('ze-result-evidence'), 'Completed result cells should expose a collapsed evidence/reasoning disclosure.');
    assert(hostileCellHtml.includes('data-ze-rerun-cell'), 'Completed result cells should expose a targeted rerun action.');
    const failedCellHtml = global.ZotExtract.renderSessionCellContent({
        sessionId: 'hostile-session',
        itemId: 456,
        questionId: 'hostile-question',
        error: 'context error',
        status: 'failed'
    });
    assert(failedCellHtml.includes('data-ze-rerun-cell'), 'Failed result cells should expose a targeted rerun action.');
    console.log("\nTest 9 Complete.");

    // Test 10: Oversized contexts use line-numbered evidence windows, not chunk preselection
    console.log("\n--- Test 10: Line-Numbered Evidence Window Context ---");
    const originalCallWithText = global.ZotExtract.callWithText;
    const scanCalls = [];
    let failedWindowOnce = false;
    global.ZotExtract.callWithText = async (provider, text, promptText) => {
        scanCalls.push({ text, promptText });
        if (!failedWindowOnce) {
            failedWindowOnce = true;
            throw new Error('NetworkError when attempting to fetch resource.');
        }
        const firstLine = String(text).match(/L\d{6}/)?.[0] || 'L000001';
        return JSON.stringify({
            relevant_context: [
                { lines: firstLine, note: 'Relevant evidence from this window.' }
            ]
        });
    };
    try {
        const longFullText = Array.from({ length: 160 }, (_, index) => (
            `Line ${index + 1} describes a reproducible research detail with method, dataset, baseline, evaluation, and limitation evidence for ZotExtract.`
        )).join('\n');
        const oversizedContext = {
            metadata: 'Title: Sliding Window Paper',
            fullText: longFullText,
            text: `Title: Sliding Window Paper\n\nFull text:\n${longFullText}`,
            chunks: [{
                id: 'chunk-should-not-appear',
                start: 0,
                end: longFullText.length,
                text: longFullText
            }],
            warnings: []
        };
        const prepared = await global.ZotExtract.prepareContextForQuestion(
            {
                name: 'Small Context Local',
                model: 'small-context-model',
                contextWindowTokens: 1800,
                systemPrompt: 'Test system prompt'
            },
            oversizedContext,
            'Extract the reproducibility details and cite evidence.',
            { cancelled: false, controllers: new Set() }
        );
        assert(scanCalls.length > 1, 'Oversized context should be scanned with multiple sliding windows.');
        assert(scanCalls.every(call => /L\d{6}/.test(call.text)), 'Every scan window should contain numbered lines.');
        assert(scanCalls.every(call => !call.text.includes('chunk-should-not-appear')), 'Line-window scan must not use precomputed chunks.');
        assert(scanCalls.every(call => call.promptText.includes('Cite line IDs')), 'Scan prompt should require line citations.');
        assert(prepared.text.includes('first evidence pass'));
        assert(/L\d{6}/.test(prepared.text));
        assert(prepared.text.includes('describes a reproducible research detail'), 'Prepared context should contain source lines, not just scan summaries.');
        assert(!prepared.text.includes('Relevant evidence from this window.'), 'Prepared context should rehydrate cited source lines instead of forwarding scan notes.');
        assert.strictEqual(prepared.chunks.length, 0, 'Line-window answers should not advertise chunk provenance.');
        assert(prepared.warnings.some(warning => warning.includes('line-numbered evidence windows')));
        assert(prepared.warnings.some(warning => warning.includes('failed and was skipped')));
    } finally {
        global.ZotExtract.callWithText = originalCallWithText;
    }
    console.log("\nTest 10 Complete.");

    // Test 10b: Collected sliding-window evidence is fitted before the final provider call
    console.log("\n--- Test 10b: Sliding Evidence Final Fit ---");
    const originalCollectRelevantLineEvidence = global.ZotExtract.collectRelevantLineEvidence;
    try {
        const oversizedEvidenceLine = 'This collected source line contains repeated evidence text that would overflow a small final request if ZotExtract forwarded every scanned line unchanged.';
        global.ZotExtract.collectRelevantLineEvidence = async () => [{
            windowIndex: 1,
            windowCount: 2,
            range: 'L000001-L000080',
            text: Array.from({ length: 80 }, (_, index) => `L${String(index + 1).padStart(6, '0')}: ${oversizedEvidenceLine}`).join('\n')
        }, {
            windowIndex: 2,
            windowCount: 2,
            range: 'L000081-L000160',
            text: Array.from({ length: 80 }, (_, index) => `L${String(index + 81).padStart(6, '0')}: ${oversizedEvidenceLine}`).join('\n')
        }];
        const provider = {
            name: 'Small Context Local',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'small-context-model',
            contextWindowTokens: 1800,
            maxCompletionTokens: 256,
            systemPrompt: 'Test system prompt'
        };
        const promptText = 'Extract the research facts and cite lines.';
        const fullText = Array.from({ length: 180 }, (_, index) => `Line ${index + 1} has enough text to trigger the sliding-window path before collection.`).join('\n');
        const prepared = await global.ZotExtract.prepareContextForQuestion(
            provider,
            {
                metadata: 'Title: Final Fit Paper',
                fullText,
                text: `Title: Final Fit Paper\n\nFull text with line numbers:\n${fullText}`,
                chunks: [],
                warnings: []
            },
            promptText,
            { cancelled: false, controllers: new Set() }
        );
        assert(
            global.ZotExtract.requestFitsContextWindow(provider, prepared.text, promptText),
            'Prepared sliding evidence must fit the provider window before the final API call.'
        );
        assert(prepared.warnings.some(warning => warning.includes('shortened from')));
        assert(!prepared.warnings.some(warning => warning.includes('kept the collected evidence unchanged')));
    } finally {
        global.ZotExtract.collectRelevantLineEvidence = originalCollectRelevantLineEvidence;
    }
    console.log("\nTest 10b Complete.");

    // Test 10c: Provider context-size rejection retries with smaller evidence windows
    console.log("\n--- Test 10c: Context Rejection Evidence Retry ---");
    const originalBuildMaximumContextForRetry = global.ZotExtract.buildMaximumContext;
    const originalBestPdfAttachmentForRetry = global.ZotExtract.bestPdfAttachment;
    const originalCallWithTextForRetry = global.ZotExtract.callWithText;
    try {
        const retryFullText = Array.from({ length: 80 }, (_, index) => (
            `Line ${index + 1} contains retry evidence, methods, findings, and limitations for the context fallback test.`
        )).join('\n');
        global.ZotExtract.bestPdfAttachment = async () => null;
        global.ZotExtract.buildMaximumContext = async () => ({
            metadata: 'Title: Retry Paper',
            fullText: retryFullText,
            text: `Title: Retry Paper\n\nFull text with line numbers:\n${retryFullText}`,
            chunks: [],
            warnings: []
        });
        let finalCalls = 0;
        let scanCallsForRetry = 0;
        global.ZotExtract.callWithText = async (_provider, text, _promptText, _runState, options = {}) => {
            if (options.rawUserPrompt) {
                scanCallsForRetry += 1;
                const firstLine = String(text).match(/L\d{6}/)?.[0] || 'L000001';
                return JSON.stringify({ relevant_context: [{ lines: firstLine, note: 'Retry evidence.' }] });
            }
            finalCalls += 1;
            if (finalCalls === 1) {
                throw new Error('API Error 400: {"error":"Context size has been exceeded."}');
            }
            return JSON.stringify({
                reasoning: 'The retry used cited line evidence.',
                relevant_context: [{ lines: 'L000001', note: 'Retry evidence.' }],
                answer: { status: 'retried' }
            });
        };
        const retryCell = await global.ZotExtract.processSessionCell(
            { id: 'retry-session' },
            { id: 811, getField: field => field === 'title' ? 'Retry Paper' : '' },
            { questionId: 'retry-question', questionName: 'Retry question', prompt: 'Extract retry facts.' },
            {
                name: 'Small Context Local',
                baseUrl: 'http://127.0.0.1:1234/v1',
                model: 'small-context-model',
                contextWindowTokens: 3200,
                maxCompletionTokens: 512,
                systemPrompt: 'Test system prompt'
            },
            { cancelled: false, controllers: new Set() }
        );
        assert.strictEqual(retryCell.status, 'completed');
        assert.strictEqual(finalCalls, 2, 'A final evidence-context rejection should retry the final call once after smaller evidence collection.');
        assert(scanCallsForRetry > 0, 'Retry should force smaller line-numbered evidence collection.');
        assert(retryCell.warnings.some(warning => warning.includes('retried with smaller line-numbered evidence windows')));
        assert.strictEqual(retryCell.structured.extraction.answer.status, 'retried');
    } finally {
        global.ZotExtract.buildMaximumContext = originalBuildMaximumContextForRetry;
        global.ZotExtract.bestPdfAttachment = originalBestPdfAttachmentForRetry;
        global.ZotExtract.callWithText = originalCallWithTextForRetry;
    }
    console.log("\nTest 10c Complete.");

    // Test 11: Session paper/question removal auto-saves and confirms destructive result removal
    console.log("\n--- Test 11: Session Paper And Question Removal ---");
    const secondMockRegularItem = {
        isRegularItem: () => true,
        getField: (field) => field === 'title' ? 'Second Mock Paper' : (field === 'abstractNote' ? 'Second abstract' : ''),
        getBestAttachment: async () => null,
        getNotes: () => [],
        id: 789
    };
    const thirdMockRegularItem = {
        isRegularItem: () => true,
        getField: (field) => field === 'title' ? 'Third Mock Paper' : '',
        getBestAttachment: async () => null,
        getNotes: () => [],
        id: 790
    };
    mockItems.set(789, secondMockRegularItem);
    mockItems.set(790, thirdMockRegularItem);
    await global.ZotExtract.saveQuestionSets([{
        id: 'removal-set',
        name: 'Removal Test Set',
        description: '',
        questions: [{
            id: 'q-remove',
            name: 'Remove test question',
            prompt: 'Extract removal test data.',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }, {
            id: 'q-keep',
            name: 'Keep test question',
            prompt: 'Keep this question.',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }]);
    const removalSession = await global.ZotExtract.saveSession({
        id: 'remove-session',
        name: 'Removal Session',
        status: 'completed',
        paperItemIds: [mockRegularItem.id, secondMockRegularItem.id],
        questionRefs: [
            { questionSetId: 'removal-set', questionId: 'q-remove' },
            { questionSetId: 'removal-set', questionId: 'q-keep' }
        ],
        columnWidths: { [mockRegularItem.id]: 444, [secondMockRegularItem.id]: 333 },
        rowHeights: { 'q-remove': 155, 'q-keep': 144 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    await global.ZotExtract.writeResultCells(removalSession.id, [
        { sessionId: removalSession.id, itemId: mockRegularItem.id, questionId: 'q-remove', answer: 'paper one answer', structured: { field: 'one' }, status: 'completed' },
        { sessionId: removalSession.id, itemId: mockRegularItem.id, questionId: 'q-keep', answer: '', structured: {}, status: 'ready' },
        { sessionId: removalSession.id, itemId: secondMockRegularItem.id, questionId: 'q-remove', answer: 'paper two answer', structured: { field: 'two' }, status: 'completed' }
    ]);
    const originalConfirm = global.Services.prompt.confirm;
    const confirmations = [];
    try {
        global.Services.prompt.confirm = (parent, title, text) => {
            confirmations.push({ title, text });
            return true;
        };
        const afterPaperRemoval = await global.ZotExtract.removePaperFromSession(removalSession.id, mockRegularItem.id);
        assert.strictEqual(afterPaperRemoval.paperItemIds.length, 1);
        assert.strictEqual(afterPaperRemoval.paperItemIds[0], secondMockRegularItem.id);
        assert.strictEqual(afterPaperRemoval.columnWidths[mockRegularItem.id], undefined);
        assert.strictEqual(afterPaperRemoval.status, 'completed');
        let remainingCells = await global.ZotExtract.readResultCells(removalSession.id);
        assert.strictEqual(remainingCells.length, 1);
        assert.strictEqual(remainingCells[0].itemId, secondMockRegularItem.id);
        assert.strictEqual(remainingCells[0].questionId, 'q-remove');

        const afterQuestionRemoval = await global.ZotExtract.removeQuestionFromSession(removalSession.id, 'removal-set', 'q-remove');
        assert(!afterQuestionRemoval.questionRefs.some(ref => ref.questionId === 'q-remove'));
        assert.strictEqual(afterQuestionRemoval.rowHeights['q-remove'], undefined);
        assert.strictEqual(afterQuestionRemoval.status, 'draft');
        remainingCells = await global.ZotExtract.readResultCells(removalSession.id);
        assert.strictEqual(remainingCells.length, 0);

        const addFlowSession = await global.ZotExtract.saveSession({
            id: 'add-flow-session',
            name: 'Add Flow Session',
            status: 'draft',
            paperItemIds: [mockRegularItem.id, secondMockRegularItem.id],
            questionRefs: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        const originalOpenSessionsTabForAdd = global.ZotExtract.openSessionsTab;
        try {
            global.ZotExtract.currentSessionId = addFlowSession.id;
            global.ZotExtract.openSessionsTab = async () => {};
            const afterAdd = await global.ZotExtract.addSelectedItemsToCurrentSession([thirdMockRegularItem]);
            assert.deepStrictEqual(Array.from(afterAdd.paperItemIds), [mockRegularItem.id, secondMockRegularItem.id, thirdMockRegularItem.id]);
            const compactDiagnostics = new Map(afterAdd.paperItemIds.map((itemId, index) => [itemId, {
                contextWindowTokens: 16000,
                usableWindowTokens: 12000,
	                requestInputTokens: 12000 + index,
	                maxCompletionTokens: 1440,
	                sliding: true,
	                evidenceCollectionMode: 'sliding-window',
	                windowCount: 3 + index,
                warnings: ['No indexed full text: fixture warning']
            }]));
            const timingCells = [
                {
                    itemId: thirdMockRegularItem.id,
                    questionId: 'timing-1',
                    startedAt: '2026-06-01T00:00:00.000Z',
                    completedAt: '2026-06-01T00:01:30.000Z',
                    status: 'completed'
                }
            ];
            const matrixHtml = global.ZotExtract.renderSessionMatrixHtml(afterAdd, [mockRegularItem, secondMockRegularItem, thirdMockRegularItem], [], timingCells, compactDiagnostics);
            assert(matrixHtml.includes('Third Mock Paper'));
	            assert(matrixHtml.includes('Sliding evidence'));
            assert(matrixHtml.includes('Avg extraction: 1m 30s'));
            assert(!/Full text:|Context:\s*[\d.]+\s*tokens|Request in:|Max out:|Usable:|Budget:|Text cap:|Lines:/i.test(matrixHtml), 'Adding papers must keep context diagnostics compact.');

            const exportedAddSession = await global.ZotExtract.saveSession({
                id: 'exported-add-flow-session',
                name: 'Exported Add Flow Session',
                status: 'completed',
                exportedAt: '2026-06-01T00:00:00.000Z',
                exportStale: false,
                paperItemIds: [mockRegularItem.id],
                questionRefs: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            global.ZotExtract.currentSessionId = exportedAddSession.id;
            const afterExportedAdd = await global.ZotExtract.addSelectedItemsToCurrentSession([thirdMockRegularItem]);
            assert.strictEqual(afterExportedAdd.status, 'draft');
            assert.strictEqual(afterExportedAdd.exportStale, true);
            assert.strictEqual(global.ZotExtract.sessionStatusLabel(afterExportedAdd), 'Draft');
        } finally {
            global.ZotExtract.openSessionsTab = originalOpenSessionsTabForAdd;
        }

        const deletableSession = await global.ZotExtract.saveSession({
            id: 'delete-session',
            name: 'Delete Session',
            status: 'completed',
            paperItemIds: [secondMockRegularItem.id],
            questionRefs: [{ questionSetId: 'removal-set', questionId: 'q-keep' }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        await global.ZotExtract.writeResultCells(deletableSession.id, [
            { sessionId: deletableSession.id, itemId: secondMockRegularItem.id, questionId: 'q-keep', answer: 'delete me', status: 'completed' }
        ]);
        const originalRenderSessionsList = global.ZotExtract.renderSessionsList;
        global.ZotExtract.renderSessionsList = async () => {};
        try {
            const deleted = await global.ZotExtract.deleteSession(deletableSession.id, {});
            assert.strictEqual(deleted, true);
            assert.strictEqual(await global.ZotExtract.getSession(deletableSession.id), null);
            const deletedCells = await global.ZotExtract.readResultCells(deletableSession.id);
            assert.strictEqual(deletedCells.length, 0);
        } finally {
            global.ZotExtract.renderSessionsList = originalRenderSessionsList;
        }
    } finally {
        global.Services.prompt.confirm = originalConfirm;
    }
    assert.strictEqual(confirmations.length, 3, 'Removing extracted papers/questions and deleting a session should ask for confirmation.');
    assert(confirmations[0].text.includes('extracted result cell'));
    assert(confirmations[1].text.includes('extracted result cell'));
    assert(confirmations[2].text.includes('Zotero library items and PDFs are not deleted.'));
    const originalMainLibraryWindows = global.ZotExtract.mainLibraryWindows;
    const originalCurrentSessionIdForLiveUpdate = global.ZotExtract.currentSessionId;
    try {
        const target = { innerHTML: '' };
        const panel = {
            getAttribute: (name) => name === 'data-ze-open' ? 'true' : '',
            querySelector: () => target
        };
        global.ZotExtract.mainLibraryWindows = () => [{ document: { getElementById: () => panel } }];
        global.ZotExtract.currentSessionId = 'live-session';
        global.ZotExtract.updateOpenResultCell('live-session', {
            sessionId: 'live-session',
            itemId: 1,
            questionId: 'q-live',
            status: 'running'
        });
        assert(target.innerHTML.includes('Running'));
        global.ZotExtract.updateOpenResultCell('live-session', {
            sessionId: 'live-session',
            itemId: 1,
            questionId: 'q-live',
            answer: 'Live answer',
            structured: null,
            status: 'completed'
        });
        assert(target.innerHTML.includes('Live answer'));
    } finally {
        global.ZotExtract.mainLibraryWindows = originalMainLibraryWindows;
        global.ZotExtract.currentSessionId = originalCurrentSessionIdForLiveUpdate;
    }
    console.log("\nTest 11 Complete.");

    // Test 12: Coordinate source maps drive evidence PDF navigation
    console.log("\n--- Test 12: Evidence PDF Source Map ---");
    const pageLineRecords = global.ZotExtract.reconstructPdfJsLineRecords([
        { str: 'Alpha', transform: [1, 0, 0, 12, 10, 700], width: 32, height: 12 },
        { str: 'Beta', transform: [1, 0, 0, 12, 48, 700], width: 28, height: 12 },
        { str: 'Gamma', transform: [1, 0, 0, 12, 10, 680], width: 44, height: 12 }
    ], 2, 600, 800);
    pageLineRecords.forEach((record, index) => {
        record.lineNumber = index + 1;
        record.id = `L${String(index + 1).padStart(6, '0')}`;
    });
    assert.strictEqual(pageLineRecords.length, 2);
    assert.strictEqual(pageLineRecords[0].text, 'Alpha Beta');
    assert.strictEqual(pageLineRecords[0].page, 2);
    assert(pageLineRecords[0].rects[0].width > 60);
    assert.strictEqual(pageLineRecords[0].rects[0].pageHeight, 800);
    const recognizerPage = [
        600,
        800,
        [[[[0, 0, 0, 0, [
            [[10, 20, 42, 32, 12, 1, 780, 0, 0, 0, 0, 0, 0, 'Delta'], [46, 20, 76, 32, 12, 0, 780, 0, 0, 0, 0, 0, 0, 'Echo']],
            [[10, 44, 52, 56, 12, 0, 756, 0, 0, 0, 0, 0, 0, 'Foxtrot']]
        ]]]]]
    ];
    const recognizerLines = global.ZotExtract.flattenRecognizerLines(recognizerPage);
    assert.strictEqual(recognizerLines.length, 2);
    assert.strictEqual(recognizerLines[0].map(word => word[13]).join(' '), 'Delta Echo');
    const recognizerRect = global.ZotExtract.mergeRecognizerWordRects(recognizerLines[0], 1, 600, 800)[0];
    assert.strictEqual(recognizerRect.width, 66);
    assert.strictEqual(recognizerRect.pageHeight, 800);
    const evidenceExtraction = {
        reasoning: 'The first line directly supports the answer.',
        relevant_context: [{ lines: 'L000001', note: 'Direct supporting evidence.' }],
        answer: { summary: 'Alpha Beta is the extracted answer.' }
    };
    const evidenceCell = {
        sessionId: 'evidence-session',
        itemId: 456,
        questionId: 'research-facts',
        questionSnapshot: { questionName: 'Research facts' },
        paperSnapshot: { title: 'Coordinate Paper' },
        source: { attachmentId: 123, title: 'Coordinate Paper' },
        answer: JSON.stringify(evidenceExtraction),
        structured: {
            extraction: evidenceExtraction,
            evidence: global.ZotExtract.extractRelevantContextEntries(evidenceExtraction)
                .map(entry => ({ ...entry, sourceText: 'L000001: Alpha Beta' }))
        },
        lineSourceMap: {
            version: 1,
            source: 'pdfjs-text-layer',
            hasCoordinates: true,
            records: pageLineRecords
        },
        status: 'completed'
    };
    const resultHtml = global.ZotExtract.renderResultCellHtml(evidenceCell);
    assert(resultHtml.includes('Alpha Beta is the extracted answer.'));
    assert(resultHtml.includes('data-ze-open-evidence'));
    assert(!resultHtml.includes('data-ze-annotate-evidence'), 'Matrix result cell should only expose supported evidence actions.');
    assert(resultHtml.includes('Evidence / reasoning'), 'Matrix result cell should expose collapsed evidence/reasoning details.');
    const resultPreviewHtml = resultHtml.match(/<div class="ze-result-preview">([\s\S]*?)<\/div>/)?.[1] || '';
    assert(!resultPreviewHtml.includes('The first line directly supports the answer.'), 'Matrix result preview should display the final answer, not reasoning.');
    assert(!resultPreviewHtml.includes('Direct supporting evidence.'), 'Matrix result preview should not render evidence notes inline.');
    assert(resultHtml.includes('The first line directly supports the answer.'), 'Collapsed details should include visible reasoning.');
    assert(resultHtml.includes('Direct supporting evidence.'), 'Collapsed details should include cited evidence notes.');
    const nestedAnswerPreview = global.ZotExtract.finalAnswerPreview({
        title: 'Fake test paper',
        concepts: [
            {
                label: 'Zotero workflow integration',
                definition: 'Testing concept extraction from a local Zotero PDF workflow.',
                evidence: { lines: 'L000001-L000004' },
                quote: 'supporting quote should stay out of the grid'
            }
        ]
    });
    assert(nestedAnswerPreview.includes('Zotero workflow integration'));
    assert(nestedAnswerPreview.includes('Testing concept extraction'));
    assert(!nestedAnswerPreview.includes('L000001'), 'Nested answer preview should hide line evidence from the matrix.');
    assert(!nestedAnswerPreview.includes('supporting quote'), 'Nested answer preview should hide supporting quotes from the matrix.');
    const pdfLocation = global.ZotExtract.buildEvidencePdfLocation(evidenceCell, 'L000001');
    assert.strictEqual(pdfLocation.position.pageIndex, 1);
    assert.deepStrictEqual(Array.from(pdfLocation.position.rects[0], value => Math.round(value)), [10, 700, 76, 712]);
    assert.strictEqual(global.ZotExtract.firstEvidencePage(evidenceCell, 'L000001'), 2);
    const fallbackEvidenceCell = {
        ...evidenceCell,
        lineSourceMap: {
            version: 1,
            source: 'zotero-indexed-full-text',
            hasCoordinates: false,
            records: [{ id: 'L000001', lineNumber: 1 }]
        }
    };
    assert(!global.ZotExtract.hasEvidencePdfLocation(fallbackEvidenceCell, 'L000001'));
    assert(!global.ZotExtract.renderResultCellHtml(fallbackEvidenceCell).includes('data-ze-open-evidence'), 'PDF evidence action should be hidden when no saved PDF location exists.');
    console.log("\nTest 12 Complete.");

    // Test 13: User-triggered plugin data purge removes ZotExtract-owned data and prefs
    console.log("\n--- Test 13: ZotExtract Local Data Purge ---");
    mockFiles.set('/mock-profile/zotextract-data', 'dir');
    mockFiles.set('/mock-profile/zotextract-data/sessions.json', '[]');
    mockFiles.set('/mock-profile/zotextract-data/results/session.json', '[]');
    mockFiles.set('/mock-profile/zotextract-exports', 'dir');
    mockFiles.set('/mock-profile/zotextract-exports/session.csv', 'csv');
    global.Zotero.Prefs.set('extensions.zotextract.provider', '{"name":"Local"}');
    global.Zotero.Prefs.set('extensions.zotextract.apiKey', 'secret');
    global.Zotero.Prefs.set('extensions.zotextract.providerSetupTipShown', true);
    global.ZotExtract.currentSessionId = 'session-before-delete';
    global.ZotExtract.sessionFilter = 'completed';
    global.ZotExtract.sessionSearchQuery = 'paper';
    global.ZotExtract.providerSetupPromptScheduled = true;
    await global.ZotExtract.deleteAllLocalData();
    assert.strictEqual(mockFiles.has('/mock-profile/zotextract-data'), false);
    assert.strictEqual(mockFiles.has('/mock-profile/zotextract-data/sessions.json'), false);
    assert.strictEqual(mockFiles.has('/mock-profile/zotextract-data/results/session.json'), false);
    assert.strictEqual(mockFiles.has('/mock-profile/zotextract-exports'), false);
    assert.strictEqual(mockFiles.has('/mock-profile/zotextract-exports/session.csv'), false);
    assert.strictEqual(global.Zotero.Prefs.get('extensions.zotextract.provider'), undefined);
    assert.strictEqual(global.Zotero.Prefs.get('extensions.zotextract.apiKey'), undefined);
    assert.strictEqual(global.Zotero.Prefs.get('extensions.zotextract.providerSetupTipShown'), undefined);
    assert.strictEqual(global.ZotExtract.currentSessionId, null);
    assert.strictEqual(global.ZotExtract.sessionFilter, 'all');
    assert.strictEqual(global.ZotExtract.sessionSearchQuery, '');
    assert.strictEqual(global.ZotExtract.providerSetupPromptScheduled, false);
    console.log("\nTest 13 Complete.");
}

runTests().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
