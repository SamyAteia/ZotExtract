var ZotExtractProgress = {
        showSessionProgress(total, runState) {
            const win = this.mainWindow();
            const doc = win?.document;
            if (!doc || typeof doc.createElementNS !== 'function') return;
            const existing = doc.getElementById('zotextract-progress');
            if (existing) existing.remove();
            const progressDiv = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
            progressDiv.setAttribute('id', 'zotextract-progress');
            progressDiv.style.cssText = 'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:99999;display:flex;align-items:center;gap:12px;box-shadow:0 4px 12px rgba(0,0,0,.3);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
            const unit = Number(total) === 1 ? 'paper' : 'papers';
            this.setInnerHTML(progressDiv, `<span data-ze-progress-label>ZotExtract: 0/${total} ${unit}</span><div style="width:200px;height:8px;background:#555;border-radius:4px;overflow:hidden"><div data-ze-progress-bar style="width:0%;height:100%;background:#4CAF50;transition:width .3s"></div></div>${this.actionHtml('Cancel', 'data-ze-cancel-progress type="button" style="border:1px solid #777;border-radius:4px;background:#444;color:#fff;padding:4px 8px;cursor:pointer;text-decoration:none"', 'ze-progress-cancel')}`);
            progressDiv.querySelector?.('[data-ze-cancel-progress]')?.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                this.cancelRunState(runState);
                const button = event.currentTarget;
                if (button) {
                    button.textContent = 'Cancelling...';
                    button.setAttribute('data-ze-disabled', 'true');
                    button.setAttribute('aria-disabled', 'true');
                    button.style.cursor = 'default';
                    button.style.opacity = '.75';
                }
                this.updateSessionProgress(
                    runState.progress?.paperDone || 0,
                    runState.progress?.paperTotal || total,
                    'Cancelling...',
                    this.progressUpdateOptions(runState)
                );
            });
            doc.documentElement.appendChild(progressDiv);
        },

        updateSessionProgress(done, total, label, options = {}) {
            const doc = this.mainWindow()?.document;
            const progress = doc?.getElementById('zotextract-progress');
            if (!progress || !progress.querySelector) return;
            const shortLabel = label && label.length > 50 ? label.slice(0, 47) + '...' : label;
            const unit = options.unit || '';
            const unitText = unit ? ` ${unit}` : '';
            const barDone = Number.isFinite(Number(options.barDone)) ? Number(options.barDone) : done;
            const barTotal = Number.isFinite(Number(options.barTotal)) ? Number(options.barTotal) : total;
            progress.querySelector('[data-ze-progress-label]').textContent = `ZotExtract: ${done}/${total}${unitText}${shortLabel ? ' - ' + shortLabel : ''}`;
            progress.querySelector('[data-ze-progress-bar]').style.width = `${Math.round((barDone / Math.max(1, barTotal)) * 100)}%`;
        },

        finishSessionProgress(cancelled, done, failed, review = 0, total = null) {
            const doc = this.mainWindow()?.document;
            const progress = doc?.getElementById('zotextract-progress');
            if (!progress || !progress.querySelector) return;
            const reviewText = review ? `, ${review} reviewable` : '';
            const paperText = total ? `${done}/${total} papers` : `${done} visited`;
            const failedText = failed ? `, ${failed} failed cell${failed === 1 ? '' : 's'}` : ', 0 failed cells';
            progress.querySelector('[data-ze-progress-label]').textContent = cancelled
                ? `Cancelled: ${paperText}${failedText}${reviewText}`
                : `Complete: ${paperText}${failedText}${reviewText}`;
            progress.querySelector('[data-ze-progress-bar]').style.width = '100%';
            setTimeout(() => {
                if (progress.parentNode) progress.remove();
            }, cancelled ? 3000 : 650);
        },



        htmlEscape(str) {
            if (str === null || typeof str === 'undefined') return '';
            return String(str).replace(/[&<>"']/g, c => {
                switch (c) {
                    case '&': return '&amp;';
                    case '<': return '&lt;';
                    case '>': return '&gt;';
                    case '"': return '&quot;';
                    case "'": return '&#39;';
                }
                return c;
            });
        },

        htmlUnescape(str) {
            return String(str || '')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&');
        },
};

if (typeof ZotExtract !== 'undefined' && ZotExtract) {
    Object.assign(ZotExtract, ZotExtractProgress);
}
