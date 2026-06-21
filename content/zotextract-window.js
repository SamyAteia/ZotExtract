var ZotExtractWindow = {
        init({ id, version, rootURI }) {
            if (this.initialized) return;
            this.id = id;
            this.version = version;
            this.rootURI = rootURI;
            this.initialized = true;
        },

        providerSetupTipWasShown() {
            return Zotero.Prefs.get(this.PREFS.providerSetupTipShown, true) === true;
        },

        async addToAllWindows() {
            var windows = this.mainLibraryWindows();
            for (let win of windows) {
                this.addToWindow(win);
            }
            if (windows.length) {
                this.addToAllWindowsRetry = 0;
                this.addToAllWindowsTimer = null;
                return;
            }
            if (!windows.length && typeof setTimeout !== 'undefined') {
                if (this.addToAllWindowsRetry >= 20 || this.addToAllWindowsTimer) return;
                this.addToAllWindowsRetry += 1;
                this.addToAllWindowsTimer = setTimeout(() => {
                    this.addToAllWindowsTimer = null;
                    this.addToAllWindows();
                }, 500);
            }
        },

        trackWindowCleanup(window, cleanup) {
            if (!window || typeof cleanup !== 'function') return;
            if (!this.windowCleanups.has(window)) this.windowCleanups.set(window, []);
            this.windowCleanups.get(window).push(cleanup);
        },

        cleanupWindowHandlers(window) {
            const cleanups = this.windowCleanups.get(window) || [];
            this.windowCleanups.delete(window);
            for (const cleanup of cleanups.reverse()) {
                try {
                    cleanup();
                } catch (e) {
                    Zotero.logError(e);
                }
            }
        },

        configureContextMenuItem(menuitem, iconName) {
            const existing = typeof menuitem.getAttribute === 'function' ? (menuitem.getAttribute('class') || '') : '';
            const classes = new Set(existing.split(/\s+/).filter(Boolean));
            classes.add('menuitem-iconic');
            classes.add('zotextract-menuitem');
            menuitem.setAttribute('class', Array.from(classes).join(' '));
            if (iconName && this.rootURI) {
                menuitem.setAttribute('image', `${this.rootURI}content/icons/${iconName}.svg`);
            }
        },

        addToWindow(window) {
            let doc = window.document;
            window.ZotExtract = this;
            this.windows.add(window);
            let popup = doc.getElementById('zotero-itemmenu');
            if (popup) {
                if (!doc.getElementById('zotero-itemmenu-zotextract-start')) {
                    let startItem = doc.createXULElement('menuitem');
                    startItem.setAttribute('id', 'zotero-itemmenu-zotextract-start');
                    startItem.setAttribute('label', 'Start ZotExtract session...');
                    this.configureContextMenuItem(startItem, 'session-start');
                    startItem.addEventListener('command', () => {
                        this.startSessionFromItems(Zotero.getActiveZoteroPane().getSelectedItems());
                    });
                    popup.appendChild(startItem);
                    this.addedElementIDs.push('zotero-itemmenu-zotextract-start');
                }

                if (!doc.getElementById('zotero-itemmenu-zotextract-add-to-session')) {
                    let addItem = doc.createXULElement('menuitem');
                    addItem.setAttribute('id', 'zotero-itemmenu-zotextract-add-to-session');
                    addItem.setAttribute('label', 'Add to ZotExtract session');
                    this.configureContextMenuItem(addItem, 'session-add');
                    addItem.addEventListener('command', () => {
                        this.addSelectedItemsToCurrentSession(Zotero.getActiveZoteroPane().getSelectedItems());
                    });
                    popup.appendChild(addItem);
                    this.addedElementIDs.push('zotero-itemmenu-zotextract-add-to-session');
                }
            }
            let collectionPopup = doc.getElementById('zotero-collectionmenu');
            if (collectionPopup) {
                if (!doc.getElementById('zotero-collectionmenu-zotextract-start')) {
                    let startCollectionItem = doc.createXULElement('menuitem');
                    startCollectionItem.setAttribute('id', 'zotero-collectionmenu-zotextract-start');
                    startCollectionItem.setAttribute('label', 'Start ZotExtract session...');
                    this.configureContextMenuItem(startCollectionItem, 'session-start');
                    startCollectionItem.addEventListener('command', () => this.startSessionFromSelectedCollection());
                    collectionPopup.appendChild(startCollectionItem);
                    this.addedElementIDs.push('zotero-collectionmenu-zotextract-start');
                }

                if (!doc.getElementById('zotero-collectionmenu-zotextract-add')) {
                    let addCollectionItem = doc.createXULElement('menuitem');
                    addCollectionItem.setAttribute('id', 'zotero-collectionmenu-zotextract-add');
                    addCollectionItem.setAttribute('label', 'Add collection to ZotExtract session');
                    this.configureContextMenuItem(addCollectionItem, 'session-add');
                    addCollectionItem.addEventListener('command', () => this.addSelectedCollectionToCurrentSession());
                    collectionPopup.appendChild(addCollectionItem);
                    this.addedElementIDs.push('zotero-collectionmenu-zotextract-add');
                }
            }
            this.installSessionsUI(window);
            this.renderProviderSetupTip(window);
            this.maybeShowInstallTip(window);
        },

        removeFromAllWindows() {
            var windows = Zotero.getMainWindows();
            for (let win of windows) {
                this.removeFromWindow(win);
            }
        },

        removeFromWindow(window) {
            let doc = window.document;
            this.cleanupWindowHandlers(window);
            if (this.addToAllWindowsTimer && typeof clearTimeout !== 'undefined') {
                clearTimeout(this.addToAllWindowsTimer);
                this.addToAllWindowsTimer = null;
            }
            for (let id of this.addedElementIDs) {
                let elem = doc.getElementById(id);
                if (elem) elem.remove();
            }
            ['zotextract-style', 'zotextract-library-section', 'zotextract-sessions-panel', 'zotextract-install-tip', 'zotextract-shortcut-tip'].forEach(id => {
                let elem = doc.getElementById(id);
                if (elem) elem.remove();
            });
            this.windows.delete(window);
            if (window.ZotExtract === this) window.ZotExtract = null;
        },

};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractWindow);
}
