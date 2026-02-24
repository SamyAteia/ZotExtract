var ZotExtract;

function log(msg) {
    Zotero.debug("ZotExtract: " + msg);
}

function install() {
    log("Installed");
}

async function startup({ id, version, resourceURI, rootURI }) {
    log("Starting");

    try {
        // Load main script using rootURI (works with jar: URIs)
        Services.scriptloader.loadSubScript(rootURI + 'content/zotextract.js');
    } catch (e) {
        Zotero.logError(e);
        log("Failed to load main script: " + e.message);
        return;
    }

    try {
        Zotero.PreferencePanes.register({
            pluginID: 'zotextract@nfdixcs.org',
            src: rootURI + 'content/preferences.xhtml',
            scripts: [rootURI + 'content/preferences.js']
        });
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
}

function shutdown() {
    log("Shutting down");
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
}
