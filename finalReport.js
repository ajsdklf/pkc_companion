document.addEventListener('DOMContentLoaded', () => {
    const activitySelect = document.getElementById('activity-select');
    const reportContent = document.getElementById('report-content');

    // Fetch and populate activity list
    chrome.storage.local.get('finalReports', (data) => {
        const finalReports = data.finalReports || {};
        const activities = Object.keys(finalReports);

        if (activities.length === 0) {
            reportContent.innerHTML = '<p style="text-align: center; color: #666;">No activities found. Start an activity to generate reports.</p>';
            return;
        }

        activities.forEach((activity) => {
            const option = document.createElement('option');
            option.value = activity;
            option.textContent = activity;
            activitySelect.appendChild(option);
        });

        // Load the first activity by default
        if (activities.length > 0) {
            activitySelect.value = activities[0];
            loadReport(activities[0]);
        }
    });

    // Load report when an activity is selected
    activitySelect.addEventListener('change', (event) => {
        const selectedActivity = event.target.value;
        if (selectedActivity) {
            loadReport(selectedActivity);
        } else {
            reportContent.innerHTML = '<p style="text-align: center; color: #666;">Please select an activity to view its report.</p>';
        }
    });

    function loadReport(activity) {
        chrome.storage.local.get(['finalReports', 'importantContexts'], (data) => {
            const finalReports = data.finalReports || {};
            const importantContexts = data.importantContexts || {};
            const report = finalReports[activity];

            if (report) {
                const { summaries, connections, overallSummary } = report;
                
                reportContent.innerHTML = `
                    <section class="report-section">
                        <h2>Overall Summary</h2>
                        <p>${escapeHTML(overallSummary)}</p>
                    </section>

                    <section class="report-section">
                        <h2>Connections</h2>
                        <ul class="connection-list">
                            ${connections.map(connection => `<li>${escapeHTML(connection)}</li>`).join('')}
                        </ul>
                    </section>

                    <section class="report-section">
                        <h2>Page Summaries</h2>
                        ${Object.entries(summaries).map(([url, data]) => `
                            <div class="summary-card">
                                <h3><a href="${escapeHTML(url)}" target="_blank">${escapeHTML(url)}</a></h3>
                                <p>${escapeHTML(data.summary)}</p>
                                ${renderImportantContexts(importantContexts[url])}
                                ${renderMemos(data.memos)}
                            </div>
                        `).join('')}
                    </section>
                `;
            } else {
                reportContent.innerHTML = '<p style="text-align: center; color: #666;">No report data available for this activity.</p>';
            }
        });
    }

    function renderImportantContexts(contexts) {
        if (!contexts || contexts.length === 0) return '';

        return `
            <h4>Important Context:</h4>
            <ul class="important-context-list">
                ${contexts.map(context => `
                    <li>
                        ${escapeHTML(context.text)}
                        ${renderMemos(context.memos)}
                    </li>
                `).join('')}
            </ul>
        `;
    }

    function renderMemos(memos) {
        if (!memos || memos.length === 0) return '';

        return `
            <h4>Memos:</h4>
            <ul class="memo-list">
                ${memos.map(memo => `<li>${escapeHTML(memo)}</li>`).join('')}
            </ul>
        `;
    }

    function escapeHTML(str) {
        if (str === null || str === undefined) {
            return '';
        }
        return str.toString().replace(/[&<>'"]/g, 
            tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag)
        );
    }
});