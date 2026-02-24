const fs = require('fs');
const path = require('path');

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
        set: (key, val) => global.Zotero.Prefs._store[key] = val
    },
    Items: {
        get: (id) => {
            return {
                id: id,
                isPDFAttachment: () => true,
                getFilePathAsync: async () => "/path/to/mock.pdf",
                attachmentFilename: "mock.pdf",
                getField: (field) => field === 'title' ? 'Mock Title' : ''
            };
        }
    },
    Fulltext: {
        getTextForItem: async (id) => "This is the full text of the paper.",
        getItemContent: async (id) => ({ text: "This is the full text of the paper." }),
        indexItems: async (ids) => { }
    },
    Attachments: {
        getStorageDirectory: (attachment) => null
    },
    Promise: {
        delay: (ms) => new Promise(resolve => setTimeout(resolve, ms))
    },
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
                const el = { style: {}, textContent: '', id: '', cssText: '', appendChild: () => {}, parentNode: null };
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
    Item: class {
        constructor(type) {
            this.type = type;
            this.note = "";
            this.parentID = null;
        }
        setNote(html) {
            this.note = html;
        }
        async saveTx() {
            console.log(`[Save Note] Saved note for parent ${this.parentID}`);
            console.log(`[Note Content] ${this.note}`);
        }
    },
    logError: (e) => console.error(`[Zotero Error]`, e)
};

// Mock fetch
global.fetch = async (url, options) => {
    console.log(`[Fetch] ${url}`);
    if (options.body) {
        console.log(`[Fetch Body]`, options.body);
    }

    return {
        ok: true,
        json: async () => ({
            choices: [{
                message: {
                    content: "This is a mock LLM response."
                }
            }]
        }),
        text: async () => "Mock response text"
    };
};

// Mock IOUtils and PathUtils (globals in Zotero 7 / Firefox 115+)
global.IOUtils = {
    exists: async (path) => false,
    readUTF8: async (path) => "",
    read: async (path) => new Uint8Array([1, 2, 3])
};

global.PathUtils = {
    join: (...parts) => parts.join('/')
};

// --- Load Plugin Code ---

const pluginPath = path.join(__dirname, '../content/zotextract.js');
const pluginCode = fs.readFileSync(pluginPath, 'utf8');

const vm = require('vm');

// We need to handle the "if (!ZotExtract)" check. 
// In the browser/Zotero, this runs in a shared scope.
// We can define a context for the script.

const context = {
    ZotExtract: undefined,
    Zotero: global.Zotero,
    Services: global.Services,
    ChromeUtils: global.ChromeUtils,
    IOUtils: global.IOUtils,
    PathUtils: global.PathUtils,
    alert: global.alert,
    prompt: global.prompt,
    fetch: global.fetch,
    Blob: global.Blob,
    FormData: global.FormData,
    console: console,
    setTimeout: setTimeout
};

vm.createContext(context);
vm.runInContext(pluginCode, context);

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

    // Test 1: ZotExtract (Full Text)
    console.log("\n--- Test 1: ZotExtract (Full Text) ---");

    // Setup mock selection to be 'summary' (which uses fulltext)
    // The mock Services.prompt.select already defaults to index 0 (summary)

    const mockAttachment = {
        id: 123,
        attachmentContentType: 'application/pdf',
        attachmentFilename: 'mock.pdf',
        getFilePathAsync: async () => '/path/to/mock.pdf',
        getField: (field) => field === 'title' ? 'Mock Title' : ''
    };

    // Trigger the action
    await global.ZotExtract.askLLM([{
        isRegularItem: () => true,
        getField: (field) => field === 'title' ? 'Test Paper' : '',
        getBestAttachment: async () => mockAttachment,
        id: 456
    }]);

    console.log("\nTest 1 Complete.");

    // Test 2: ZotExtract (PDF Context)
    console.log("\n--- Test 2: ZotExtract (PDF Context) ---");

    // Update mock selection to be 'pdf-figures' (index 3)
    global.Services.prompt.select = (parent, title, text, labels, selectedIndex) => {
        console.log(`[Select] ${title}: ${text}`);
        selectedIndex.value = 3; // 'pdf-figures'
        return true;
    };

    // Trigger the action
    await global.ZotExtract.askLLM([{
        isRegularItem: () => true,
        getField: (field) => field === 'title' ? 'Test Paper' : '',
        getBestAttachment: async () => mockAttachment,
        id: 456
    }]);

    console.log("\nTest 2 Complete.");
}

runTests().catch(e => console.error(e));
