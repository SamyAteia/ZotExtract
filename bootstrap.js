var ZotExtract;
var ZotExtractPreferencePaneRegistered = false;

function log(msg) {
    Zotero.debug("ZotExtract: " + msg);
}

async function writeE2EStatus(stage, error) {
    try {
        Zotero.Prefs.set('extensions.zotextract.e2e.bootstrapStage', stage, true);
        const artifactDir = Zotero.Prefs.get('extensions.zotextract.e2e.artifactDir', true);
        if (!artifactDir || typeof IOUtils === 'undefined' || typeof PathUtils === 'undefined') return;
        await IOUtils.writeUTF8(
            PathUtils.join(artifactDir, 'e2e-bootstrap-status.json'),
            JSON.stringify({
                stage,
                error: error ? (error.stack || error.message || String(error)) : null,
                time: new Date().toISOString()
            }, null, 2)
        );
    } catch (e) {
        try {
            Zotero.logError(e);
        } catch (_) {}
    }
}

function install() {
    log("Installed");
}

async function startup({ id, version, resourceURI, rootURI }) {
    log("Starting");

    try {
        // Load main script using rootURI (works with jar: URIs)
        Services.scriptloader.loadSubScript(rootURI + 'content/prompt-presets.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/provider-settings.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-window.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-data.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-context.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-quote-recovery.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-runner.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-window-ui.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-session-ui.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-evidence-ui.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-progress.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-provider-runtime.js');
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-session-export.js');
    } catch (e) {
        Zotero.logError(e);
        log("Failed to load main script: " + e.message);
        return;
    }

    try {
        await Zotero.PreferencePanes.register({
            pluginID: 'zotextract@nfdixcs.org',
            id: 'zotextract-prefpane',
            label: 'ZotExtract',
            src: rootURI + 'content/preferences.xhtml',
            scripts: [
                rootURI + 'content/provider-settings.js',
                rootURI + 'content/preferences.js'
            ]
        });
        ZotExtractPreferencePaneRegistered = true;
    } catch (e) {
        Zotero.logError(e);
        log("Failed to register preference pane: " + e.message);
    }

    try {
        ZotExtract.init({ id, version, rootURI });
        await ZotExtract.addToAllWindows();
    } catch (e) {
        Zotero.logError(e);
        log("Failed to initialize ZotExtract: " + e.message);
    }

    try {
        if (Zotero.Prefs.get('extensions.zotextract.e2e.enabled', true)) {
            await writeE2EStatus('startup-entered');
            await writeE2EStatus('loading');
            try {
                Services.scriptloader.loadSubScript(rootURI + 'content/zotextract-e2e.js');
            } catch (loadError) {
                await writeE2EStatus('not-bundled', loadError);
                log("E2E harness requested but not bundled in this build");
                return;
            }
            await writeE2EStatus('loaded');
            ZotExtractE2E.run().catch(async e => {
                Zotero.logError(e);
                await writeE2EStatus('run-error', e);
            });
        }
    } catch (e) {
        Zotero.logError(e);
        await writeE2EStatus('startup-error', e);
        log("Failed to start ZotExtract E2E harness: " + e.message);
    }
}

function cleanupPreferencePane() {
    try {
        if (ZotExtractPreferencePaneRegistered && Zotero.PreferencePanes) {
            if (typeof Zotero.PreferencePanes.unregister === 'function') {
                Zotero.PreferencePanes.unregister('zotextract-prefpane');
            } else if (typeof Zotero.PreferencePanes.remove === 'function') {
                Zotero.PreferencePanes.remove('zotextract-prefpane');
            } else if (typeof Zotero.PreferencePanes.unregisterPane === 'function') {
                Zotero.PreferencePanes.unregisterPane('zotextract-prefpane');
            }
        }
    } catch (e) {
        Zotero.logError(e);
    }
    ZotExtractPreferencePaneRegistered = false;

    try {
        if (Zotero.Prefs.get('extensions.zotero.lastSelectedPrefPane', true) === 'zotextract-prefpane') {
            if (typeof Zotero.Prefs.clear === 'function') {
                Zotero.Prefs.clear('extensions.zotero.lastSelectedPrefPane', true);
            } else if (Services.prefs?.clearUserPref) {
                Services.prefs.clearUserPref('extensions.zotero.lastSelectedPrefPane');
            } else {
                Zotero.Prefs.set('extensions.zotero.lastSelectedPrefPane', '', true);
            }
        }
    } catch (e) {
        Zotero.logError(e);
    }
}

function shutdown() {
    log("Shutting down");
    cleanupPreferencePane();
    if (ZotExtract) {
        try {
            ZotExtract.removeFromAllWindows();
        } catch (e) {
            Zotero.logError(e);
        }
        ZotExtract = undefined;
    }
}

function uninstall() {
    log("Uninstalled");
    cleanupPreferencePane();
}
