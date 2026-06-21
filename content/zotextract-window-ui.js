var ZotExtractWindowUI = {
        isMainLibraryWindow(window) {
            const doc = window?.document;
            if (!doc) return false;
            return !!(
                doc.getElementById('zotero-pane') ||
                doc.getElementById('zotero-itemmenu') ||
                doc.getElementById('zotero-collectionmenu') ||
                window.ZoteroPane
            );
        },

        mainLibraryWindows() {
            const windows = [];
            const seen = new Set();
            const add = win => {
                if (!win || seen.has(win) || !this.isMainLibraryWindow(win)) return;
                seen.add(win);
                windows.push(win);
            };
            try {
                if (Zotero.getMainWindows) {
                    for (const win of Zotero.getMainWindows() || []) add(win);
                }
            } catch (_) {}
            try {
                if (Zotero.getMainWindow) add(Zotero.getMainWindow());
            } catch (_) {}
            return windows;
        },

        mainWindow(window) {
            if (this.isMainLibraryWindow(window)) return window;
            return this.mainLibraryWindows()[0] || window || (Zotero.getMainWindow && Zotero.getMainWindow());
        },

        selectLibraryTab(window) {
            const win = this.mainWindow(window);
            try {
                const tabs = win?.Zotero_Tabs || (typeof Zotero_Tabs !== 'undefined' ? Zotero_Tabs : null);
                if (tabs?.select && tabs.selectedID !== 'zotero-pane') {
                    tabs.select('zotero-pane', false, { keepTabFocused: true });
                }
            } catch (e) {
                Zotero.logError(e);
            }
            return win;
        },

        xhtmlFragment(html) {
            return String(html)
                .replace(/\s(data-ze-[a-z0-9-]+)(?=[\s>])/g, ' $1="true"')
                .replace(/\sdisabled(?=[\s>])/g, ' disabled="disabled"')
                .replace(/\schecked(?=[\s>])/g, ' checked="checked"')
                .replace(/<br>/g, '<br />')
                .replace(/<input([^>]*?)>/g, match => /\/\s*>$/.test(match) ? match : match.replace(/>$/, ' />'));
        },

        setInnerHTML(element, html) {
            element.innerHTML = this.xhtmlFragment(html);
        },

        actionHtml(label, attrs = '', className = 'ze-btn', disabled = false) {
            const disabledAttrs = disabled ? ' aria-disabled="true" data-ze-disabled="true" tabindex="-1"' : ' tabindex="0"';
            return `<a class="${this.htmlEscape(className)}" role="button" ${attrs}${disabledAttrs}>${this.htmlEscape(label)}</a>`;
        },

        actionDisabled(element) {
            return element?.getAttribute?.('data-ze-disabled') === 'true' || element?.getAttribute?.('aria-disabled') === 'true';
        },

        installSessionsUI(window) {
            const win = this.mainWindow(window);
            if (!win || !win.document) return;
            const doc = win.document;
            if (!doc.getElementById('zotextract-style')) {
                const stylesheet = doc.createElementNS('http://www.w3.org/1999/xhtml', 'link');
                stylesheet.setAttribute('id', 'zotextract-style');
                stylesheet.setAttribute('rel', 'stylesheet');
                stylesheet.setAttribute('type', 'text/css');
                stylesheet.setAttribute('href', this.rootURI ? `${this.rootURI}content/zotextract.css` : 'chrome://zotextract/content/zotextract.css');
                doc.documentElement.appendChild(stylesheet);
            }
            this.installLibrarySessionsNav(win);
            if (!doc.getElementById('zotextract-sessions-panel')) {
                const panel = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                panel.setAttribute('id', 'zotextract-sessions-panel');
                doc.documentElement.appendChild(panel);
            }
            this.positionSessionsPanel(win);
        },

        installLibrarySessionsNav(window) {
            const win = this.mainWindow(window);
            const doc = win?.document;
            if (!doc) return;
            let section = doc.getElementById('zotextract-library-section');
            if (!section) {
                section = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                section.setAttribute('id', 'zotextract-library-section');
            }
            const container = this.libraryNavContainer(win);
            if (container && typeof container.appendChild === 'function') {
                if (container.style && win.getComputedStyle?.(container).position === 'static') {
                    container.style.position = 'relative';
                }
                if (section.parentNode !== container) {
                    container.appendChild(section);
                }
                this.installLibraryReturnHandler(win, container);
            } else if (!section.parentNode && doc.documentElement && typeof doc.documentElement.appendChild === 'function') {
                doc.documentElement.appendChild(section);
                section.style.position = 'fixed';
                section.style.left = '8px';
                section.style.top = '330px';
                section.style.width = '218px';
                section.style.zIndex = '9000';
            } else if (!section.parentNode) {
                return;
            }
            this.renderLibrarySessionsNav(win);
            this.positionLibrarySessionsNav(win);
        },

        renderLibrarySessionsNav(window) {
            const win = this.mainWindow(window);
            const doc = win?.document;
            const section = doc?.getElementById('zotextract-library-section');
            if (!section) return;
            const selected = this.sessionsTabIsOpen(win);
            const collapsed = this.librarySessionsCollapsed !== false && !selected;
            const filter = this.sessionFilter || 'all';
            const filters = [
                ['all', 'All sessions'],
                ['draft', 'Drafts'],
                ['running', 'Running'],
                ['completed', 'Completed'],
                ['exported', 'Exported']
            ];
            section.setAttribute('data-ze-collapsed', collapsed ? 'true' : 'false');
            this.setInnerHTML(section, `
                <div class="ze-tree-row" data-ze-sessions-root>
                    <span class="ze-disclosure" data-ze-toggle-sessions>${collapsed ? '>' : 'v'}</span>
                    <span class="ze-tree-icon">ZE</span>
                    <span class="ze-tree-label" title="My ZotExtract Sessions">My ZotExtract Sessions</span>
                </div>
                <div class="ze-tree-children">
                    ${filters.map(([status, label]) => `<div class="ze-tree-row child ${selected && filter === status ? 'selected' : ''}" data-ze-session-nav-filter="${this.htmlEscape(status)}"><span class="ze-tree-label" title="${this.htmlEscape(label)}">${this.htmlEscape(label)}</span></div>`).join('')}
                </div>
            `);
            section.querySelector('[data-ze-sessions-root]')?.addEventListener('click', event => {
                if (event.target?.getAttribute?.('data-ze-toggle-sessions') === 'true') {
                    this.librarySessionsCollapsed = !collapsed;
                    this.renderLibrarySessionsNav(win);
                    return;
                }
                if (this.sessionsTabIsOpen(win) && (this.sessionFilter || 'all') === 'all') {
                    this.closeSessionsTab(win);
                } else {
                    this.sessionFilter = 'all';
                    this.openSessionsTab(win);
                }
            });
            section.querySelectorAll('[data-ze-session-nav-filter]').forEach(row => {
                row.addEventListener('click', event => {
                    event.stopPropagation();
                    this.sessionFilter = row.getAttribute('data-ze-session-nav-filter') || 'all';
                    this.openSessionsTab(win);
                });
            });
            this.positionLibrarySessionsNav(win);
        },

        libraryNavContainer(window) {
            const doc = window?.document;
            if (!doc || !doc.querySelector) return null;
            const paneSelectors = [
                '#zotero-collections-pane',
                '#collections-pane',
                '[id*="collections"][id*="pane"]'
            ];
            for (const selector of paneSelectors) {
                const node = doc.querySelector(selector);
                if (node && !/menu/i.test(node.id || '')) {
                    return node;
                }
            }
            const treeSelectors = [
                '#zotero-collections-tree',
                '#collections-tree',
                '[id*="collections-tree"]'
            ];
            for (const selector of treeSelectors) {
                const node = doc.querySelector(selector);
                const pane = node?.closest?.('#zotero-collections-pane, #collections-pane, [id*="collections"][id*="pane"]');
                if (pane && !/menu/i.test(pane.id || '')) return pane;
            }
            const candidates = Array.from(doc.querySelectorAll('div, tree, richlistbox, virtualized-table'))
                .map(node => ({ node, rect: node.getBoundingClientRect ? node.getBoundingClientRect() : null }))
                .filter(({ rect }) => rect && rect.left < 80 && rect.width >= 150 && rect.width <= 320 && rect.height >= 240)
                .sort((a, b) => (b.rect.height - a.rect.height));
            return candidates[0]?.node || null;
        },

        collectionTreeElement(window) {
            const doc = window?.document;
            if (!doc || !doc.querySelector) return null;
            const selectors = [
                '#zotero-collections-tree',
                '#collections-tree',
                '[id*="collections-tree"]'
            ];
            for (const selector of selectors) {
                const node = doc.querySelector(selector);
                if (node && !/menu/i.test(node.id || '')) return node;
            }
            return null;
        },

        visibleCollectionRows(window) {
            const tree = this.collectionTreeElement(window);
            if (!tree || !tree.querySelectorAll) return [];
            return Array.from(tree.querySelectorAll('.row, [role="row"]'))
                .filter(row => row.id !== 'zotextract-library-section')
                .filter(row => {
                    if (!row.getBoundingClientRect) return false;
                    const rect = row.getBoundingClientRect();
                    return rect.width > 20 && rect.height > 8;
                });
        },

        collectionRowIndent(window, row) {
            try {
                const style = window.getComputedStyle?.(row);
                const value = style?.paddingInlineStart || style?.paddingLeft || row.style?.paddingInlineStart || row.style?.paddingLeft || '0';
                const parsed = parseFloat(String(value).replace('px', ''));
                return Number.isFinite(parsed) ? parsed : 0;
            } catch (_) {
                return 0;
            }
        },

        collectionRowText(row) {
            return String(row?.textContent || '').replace(/\s+/g, ' ').trim();
        },

        librarySessionsAnchorRect(window) {
            const rows = this.visibleCollectionRows(window);
            if (!rows.length) return null;
            const libraryIndex = rows.findIndex(row => /(^|\s)My Library($|\s)/i.test(this.collectionRowText(row)));
            const libraryRow = rows[libraryIndex >= 0 ? libraryIndex : 0];
            if (!libraryRow?.getBoundingClientRect) return null;
            const libraryIndent = this.collectionRowIndent(window, libraryRow);
            const isOpen = !!libraryRow.querySelector?.('.twisty.open, .icon-css.twisty.open, [class*="twisty"][class*="open"]');
            let anchorRow = libraryRow;
            if (isOpen) {
                for (let i = (libraryIndex >= 0 ? libraryIndex : 0) + 1; i < rows.length; i++) {
                    const row = rows[i];
                    const text = this.collectionRowText(row);
                    if (!text) continue;
                    const indent = this.collectionRowIndent(window, row);
                    if (indent <= libraryIndent) break;
                    anchorRow = row;
                }
            }
            return anchorRow.getBoundingClientRect();
        },

        positionLibrarySessionsNav(window) {
            const win = this.mainWindow(window);
            const doc = win?.document;
            const section = doc?.getElementById('zotextract-library-section');
            const container = this.libraryNavContainer(win);
            if (!section || !container || !section.style || !container.getBoundingClientRect) return;
            const containerRect = container.getBoundingClientRect();
            const anchorRect = this.librarySessionsAnchorRect(win);
            const fallbackTop = Math.max(6, Math.round((this.collectionTreeElement(win)?.getBoundingClientRect?.().top || containerRect.top) - containerRect.top + 32));
            const top = anchorRect
                ? Math.max(6, Math.round(anchorRect.bottom - containerRect.top + 6))
                : fallbackTop;
            section.style.top = `${top}px`;
            section.style.left = '6px';
            section.style.right = '6px';
        },

        scheduleLibrarySessionsPosition(window) {
            const win = this.mainWindow(window);
            if (!win) return;
            const reposition = () => this.positionLibrarySessionsNav(win);
            if (typeof win.requestAnimationFrame === 'function') {
                win.requestAnimationFrame(() => {
                    reposition();
                    win.setTimeout?.(reposition, 80);
                });
            } else if (win.setTimeout) {
                win.setTimeout(reposition, 40);
            } else {
                setTimeout(reposition, 40);
            }
        },

        installLibraryReturnHandler(window, container) {
            const win = this.mainWindow(window);
            if (!win || !container || container.getAttribute?.('data-ze-library-return-handler') === 'true') return;
            container.setAttribute('data-ze-library-return-handler', 'true');
            const closeForNativeNavigation = event => {
                const section = win.document?.getElementById('zotextract-library-section');
                if (section?.contains?.(event.target)) return;
                const panel = win.document?.getElementById('zotextract-sessions-panel');
                if (panel?.contains?.(event.target)) return;
                if (this.sessionsTabIsOpen(win)) {
                    const close = () => this.closeSessionsTab(win);
                    if (win.setTimeout) win.setTimeout(close, 0);
                    else setTimeout(close, 0);
                }
            };
            const onNavigate = event => {
                closeForNativeNavigation(event);
                this.scheduleLibrarySessionsPosition(win);
            };
            const onMouseup = () => this.scheduleLibrarySessionsPosition(win);
            const onKeyup = () => this.scheduleLibrarySessionsPosition(win);
            const onScroll = () => this.scheduleLibrarySessionsPosition(win);
            const onResize = () => this.scheduleLibrarySessionsPosition(win);
            container.addEventListener('click', onNavigate, true);
            win.document?.addEventListener?.('mousedown', closeForNativeNavigation, true);
            win.document?.addEventListener?.('pointerdown', closeForNativeNavigation, true);
            container.addEventListener('mouseup', onMouseup, true);
            container.addEventListener('keyup', onKeyup, true);
            const tree = this.collectionTreeElement(win);
            tree?.addEventListener?.('scroll', onScroll, true);
            win.addEventListener?.('resize', onResize);
            if (tree && typeof win.MutationObserver === 'function' && !container._zotextractLibraryObserver) {
                const observer = new win.MutationObserver(() => this.scheduleLibrarySessionsPosition(win));
                observer.observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-expanded'] });
                container._zotextractLibraryObserver = observer;
            }
            this.trackWindowCleanup(win, () => {
                container.removeEventListener?.('click', onNavigate, true);
                win.document?.removeEventListener?.('mousedown', closeForNativeNavigation, true);
                win.document?.removeEventListener?.('pointerdown', closeForNativeNavigation, true);
                container.removeEventListener?.('mouseup', onMouseup, true);
                container.removeEventListener?.('keyup', onKeyup, true);
                tree?.removeEventListener?.('scroll', onScroll, true);
                win.removeEventListener?.('resize', onResize);
                container._zotextractLibraryObserver?.disconnect?.();
                delete container._zotextractLibraryObserver;
                container.removeAttribute?.('data-ze-library-return-handler');
            });
        },

        positionSessionsPanel(window) {
            const win = this.mainWindow(window);
            const panel = win?.document?.getElementById('zotextract-sessions-panel');
            if (!panel || !panel.style) return;
            const contentRect = this.zoteroContentPaneRect(win);
            if (contentRect) {
                panel.style.left = `${Math.round(contentRect.left)}px`;
                panel.style.top = `${Math.round(contentRect.top)}px`;
                return;
            }
            const container = this.libraryNavContainer(win);
            const rect = container?.getBoundingClientRect ? container.getBoundingClientRect() : null;
            if (rect && rect.right > 120 && rect.right < 420) {
                panel.style.left = `${Math.round(rect.right)}px`;
            } else {
                panel.style.left = '233px';
            }
            panel.style.top = this.sessionsPanelTop(win);
        },

        zoteroContentPaneRect(window) {
            const win = this.mainWindow(window);
            const doc = win?.document;
            if (!doc || !doc.querySelectorAll) return null;
            const navRect = this.libraryNavContainer(win)?.getBoundingClientRect?.() || null;
            const selectors = [
                '#zotero-items-pane',
                '#zotero-items-tree',
                '#items-pane',
                '#items-tree',
                '#zotero-item-pane-content',
                '[id*="items"][id*="pane"]',
                '[id*="items"][id*="tree"]'
            ];
            const seen = new Set();
            const candidates = [];
            for (const selector of selectors) {
                for (const node of Array.from(doc.querySelectorAll(selector))) {
                    if (!node || seen.has(node)) continue;
                    seen.add(node);
                    const rect = node.getBoundingClientRect?.();
                    if (!rect || rect.width < 300 || rect.height < 220) continue;
                    if (navRect && rect.left < navRect.right - 8) continue;
                    candidates.push(rect);
                }
            }
            if (!candidates.length && navRect) {
                const bodyRect = doc.documentElement?.getBoundingClientRect?.();
                if (bodyRect) {
                    return {
                        left: navRect.right,
                        top: Math.max(navRect.top, this.collectionTreeElement(win)?.getBoundingClientRect?.().top || navRect.top),
                        width: bodyRect.right - navRect.right,
                        height: bodyRect.bottom - navRect.top
                    };
                }
            }
            candidates.sort((a, b) => (a.left - b.left) || (a.top - b.top));
            return candidates[0] || null;
        },

        sessionsPanelTop(window) {
            const win = this.mainWindow(window);
            const container = this.libraryNavContainer(win);
            const containerRect = container?.getBoundingClientRect ? container.getBoundingClientRect() : null;
            const tree = this.collectionTreeElement(win);
            const treeRect = tree?.getBoundingClientRect ? tree.getBoundingClientRect() : null;
            if (containerRect && containerRect.top > 0) {
                if (treeRect && treeRect.top > 0) {
                    return `${Math.round(treeRect.top)}px`;
                }
                return `${Math.round(containerRect.top)}px`;
            }
            if (treeRect && treeRect.top > 0) return `${Math.round(treeRect.top)}px`;
            return '64px';
        },

        maybeShowInstallTip(window) {
            try {
                if (this.providerSetupTipWasShown()) return;
                if (this.providerSetupPromptScheduled) return;
                this.providerSetupPromptScheduled = true;
                let attempts = 0;
                const render = () => {
                    if (this.providerSetupTipWasShown()) return;
                    const win = this.mainWindow(window);
                    attempts += 1;
                    if (win && win.document && this.isMainLibraryWindow(win)) {
                        this.installSessionsUI(win);
                        this.renderProviderSetupTip(win);
                        const tip = win.document.getElementById('zotextract-install-tip');
                        if (tip) return;
                    }
                    if (attempts < 120) {
                        const retryWindow = this.mainWindow(window);
                        if (retryWindow?.setTimeout) retryWindow.setTimeout(render, 500);
                        else setTimeout(render, 500);
                    } else {
                        this.providerSetupPromptScheduled = false;
                    }
                };
                const win = this.mainWindow(window);
                if (win?.setTimeout) win.setTimeout(render, 300);
                else setTimeout(render, 300);
            } catch (e) {
                Zotero.logError(e);
            }
        },

        renderProviderSetupTip(window) {
            try {
                if (this.providerSetupTipWasShown()) {
                    Zotero.debug('ZotExtract: Provider setup tip already marked as shown');
                    return;
                }
                const win = this.mainWindow(window);
                if (!win || !win.document || !this.isMainLibraryWindow(win)) {
                    Zotero.debug('ZotExtract: Provider setup tip skipped; no library window');
                    return;
                }
                const doc = win.document;
                if (doc.getElementById('zotextract-install-tip')) {
                    Zotero.debug('ZotExtract: Provider setup tip already present');
                    return;
                }
                const tip = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                tip.setAttribute('id', 'zotextract-install-tip');
                const title = doc.createElementNS('http://www.w3.org/1999/xhtml', 'h3');
                title.textContent = 'Set up ZotExtract';
                const body = doc.createElementNS('http://www.w3.org/1999/xhtml', 'p');
                body.textContent = 'Configure your model provider before running extraction sessions. You can discover local Ollama or LM Studio servers in Settings.';
                const actions = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                actions.setAttribute('class', 'ze-tip-actions');
                const makeButton = (label, className, attrName) => {
                    const button = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
                    button.setAttribute('class', className);
                    button.setAttribute('type', 'button');
                    button.setAttribute(attrName, 'true');
                    button.textContent = label;
                    actions.appendChild(button);
                    return button;
                };
                const settingsButton = makeButton('Configure provider', 'ze-btn primary', 'data-ze-open-settings');
                const sessionsButton = makeButton('Open sessions', 'ze-btn', 'data-ze-open-sessions');
                const dismissButton = makeButton('Not now', 'ze-btn', 'data-ze-dismiss-tip');
                tip.appendChild(title);
                tip.appendChild(body);
                tip.appendChild(actions);
                settingsButton.addEventListener('click', async () => {
                    Zotero.Prefs.set(this.PREFS.providerSetupTipShown, true, true);
                    tip.remove();
                    await this.openPreferencesPane();
                });
                sessionsButton.addEventListener('click', async () => {
                    Zotero.Prefs.set(this.PREFS.providerSetupTipShown, true, true);
                    tip.remove();
                    await this.openSessionsTab(win);
                });
                dismissButton.addEventListener('click', () => {
                    Zotero.Prefs.set(this.PREFS.providerSetupTipShown, true, true);
                    tip.remove();
                });
                doc.documentElement.appendChild(tip);
                Zotero.debug('ZotExtract: Provider setup tip rendered');
            } catch (e) {
                Zotero.logError(e);
            }
        },

        maybeShowEmptySessionHint(window = null) {
            try {
                if (Zotero.Prefs.get(this.PREFS.emptySessionHintShown, true) === true) return;
                const win = this.mainWindow(window);
                if (!win || !win.document || !this.isMainLibraryWindow(win)) return;
                this.installSessionsUI(win);
                const doc = win.document;
                if (doc.getElementById('zotextract-shortcut-tip')) return;
                const tip = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                tip.setAttribute('id', 'zotextract-shortcut-tip');
                const title = doc.createElementNS('http://www.w3.org/1999/xhtml', 'h3');
                title.textContent = 'ZotExtract shortcut';
                const body = doc.createElementNS('http://www.w3.org/1999/xhtml', 'p');
                body.textContent = 'Did you know you can also start a ZotExtract session by right-clicking selected papers or a collection in your Zotero library?';
                const actions = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                actions.setAttribute('class', 'ze-tip-actions');
                const okButton = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
                okButton.setAttribute('class', 'ze-btn primary');
                okButton.setAttribute('type', 'button');
                okButton.textContent = 'Got it';
                okButton.addEventListener('click', () => {
                    Zotero.Prefs.set(this.PREFS.emptySessionHintShown, true, true);
                    tip.remove();
                });
                actions.appendChild(okButton);
                tip.appendChild(title);
                tip.appendChild(body);
                tip.appendChild(actions);
                doc.documentElement.appendChild(tip);
            } catch (e) {
                Zotero.logError(e);
            }
        },

        maybeShowLibraryAddHint(window = null) {
            try {
                if (Zotero.Prefs.get(this.PREFS.libraryAddHintShown, true) === true) return;
                const win = this.mainWindow(window);
                if (!win || !win.document || !this.isMainLibraryWindow(win)) return;
                this.installSessionsUI(win);
                const doc = win.document;
                if (doc.getElementById('zotextract-shortcut-tip')) return;
                const tip = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                tip.setAttribute('id', 'zotextract-shortcut-tip');
                const title = doc.createElementNS('http://www.w3.org/1999/xhtml', 'h3');
                title.textContent = 'Add papers to this session';
                const body = doc.createElementNS('http://www.w3.org/1999/xhtml', 'p');
                body.textContent = 'Select papers or a collection in your Zotero library, then right-click and choose the ZotExtract add-to-session action. ZotExtract will return to this session after adding them.';
                const actions = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
                actions.setAttribute('class', 'ze-tip-actions');
                const okButton = doc.createElementNS('http://www.w3.org/1999/xhtml', 'button');
                okButton.setAttribute('class', 'ze-btn primary');
                okButton.setAttribute('type', 'button');
                okButton.textContent = 'Got it';
                okButton.addEventListener('click', () => {
                    Zotero.Prefs.set(this.PREFS.libraryAddHintShown, true, true);
                    tip.remove();
                });
                actions.appendChild(okButton);
                tip.appendChild(title);
                tip.appendChild(body);
                tip.appendChild(actions);
                doc.documentElement.appendChild(tip);
            } catch (e) {
                Zotero.logError(e);
            }
        },

        async openPreferencesPane() {
            try {
                if (Zotero.Utilities?.Internal?.openPreferences) {
                    Zotero.Utilities.Internal.openPreferences('zotextract-prefpane');
                    return;
                }
                if (Zotero.openPreferences) {
                    Zotero.openPreferences('zotextract-prefpane');
                    return;
                }
            } catch (e) {
                Zotero.logError(e);
            }
            Services.prompt.alert(null, 'ZotExtract Settings', 'Open Zotero Settings, then choose ZotExtract to configure your model provider.');
        },

        closeSessionsTab(window) {
            const win = this.mainWindow(window);
            const panel = win?.document?.getElementById('zotextract-sessions-panel');
            if (panel) {
                panel.style.display = 'none';
                panel.setAttribute('data-ze-open', 'false');
            }
            this.librarySessionsCollapsed = true;
            this.renderLibrarySessionsNav(win);
        },

        async returnToLibraryForPaperSelection(sessionId, window) {
            if (sessionId) this.currentSessionId = sessionId;
            const win = this.mainWindow(window);
            this.closeSessionsTab(win);
            this.maybeShowLibraryAddHint(win);
        },

        sessionsTabIsOpen(window) {
            const win = this.mainWindow(window);
            const panel = win?.document?.getElementById('zotextract-sessions-panel');
            return panel?.getAttribute?.('data-ze-open') === 'true' && panel.style.display !== 'none';
        },

        async openSessionsTab(window, sessionId) {
            const win = this.selectLibraryTab(window);
            if (!win || !win.document) return;
            this.installSessionsUI(win);
            const panel = win.document.getElementById('zotextract-sessions-panel');
            if (!panel) return;
            if (!panel.style) return;
            this.positionSessionsPanel(win);
            panel.style.display = 'block';
            panel.setAttribute('data-ze-open', 'true');
            this.librarySessionsCollapsed = false;
            this.renderLibrarySessionsNav(win);
            if (sessionId) {
                this.currentSessionId = sessionId;
                await this.renderSessionWorkspace(sessionId, win);
            } else {
                await this.renderSessionsList(win);
            }
        },
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractWindowUI);
}
