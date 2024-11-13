document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('pkc-sidebar');
    
    const activitySelect = sidebar.getElementById('activity-select');
    const startButton = sidebar.getElementById('start-button');
    const memoInput = sidebar.getElementById('memo-input');
    const addMemoButton = sidebar.getElementById('add-memo-button');
    const endActivityButton = sidebar.getElementById('end-activity-button');
    const summaryContent = sidebar.getElementById('summary-content');
    const currentActivityTag = sidebar.getElementById('current-activity-tag');
    const activityProgressBar = sidebar.getElementById('activity-progress-bar');
    const contextMemoInput = sidebar.querySelector('#context-memo-input');
    const addContextMemoButton = sidebar.querySelector('#add-context-memo-button');

    let currentContextIndex = 0; // Initialize currentContextIndex

    function updateActivityUI(activity) {
        currentActivityTag.textContent = activity.charAt(0).toUpperCase() + activity.slice(1);
        currentActivityTag.style.display = 'inline-block';
        activityProgressBar.style.width = '0%';
        activityProgressBar.style.transition = 'width 3600s linear';
        setTimeout(() => {
            activityProgressBar.style.width = '100%';
        }, 50);
    }

    function resetActivityUI() {
        currentActivityTag.textContent = '';
        currentActivityTag.style.display = 'none';
        activityProgressBar.style.width = '0%';
        activityProgressBar.style.transition = 'none';
    }

    chrome.storage.local.get('currentActivity', (data) => {
        if (data.currentActivity) {
            activitySelect.value = data.currentActivity;
            activitySelect.disabled = true;
            startButton.disabled = true;
            endActivityButton.disabled = false;
            updateActivityUI(data.currentActivity);
        } else {
            endActivityButton.disabled = true;
        }
    });

    startButton.addEventListener('click', () => {
        const activity = activitySelect.value;
        if (activity) {
            chrome.runtime.sendMessage({ action: "startActivity", activity });
            activitySelect.disabled = true;
            startButton.disabled = true;
            endActivityButton.disabled = false;
            updateActivityUI(activity);
        }
    });

    addMemoButton.addEventListener('click', () => {
        const memo = memoInput.value.trim();
        if (memo) {
            chrome.runtime.sendMessage({ 
                action: "addMemo", 
                memo,
                url: window.location.href
            });
            memoInput.value = '';
            updateMemoList(memo);
        }
    });

    addContextMemoButton.addEventListener('click', () => {
        const memo = contextMemoInput.value.trim();
        if (memo) {
            chrome.runtime.sendMessage({ 
                action: "addContextMemo", 
                memo,
                url: window.location.href,
                contextIndex: currentContextIndex
            });
            contextMemoInput.value = '';
            updateContextMemoList(memo);
        }
    });

    endActivityButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "endActivity" }, (response) => {
            if (response && response.status === 'success') {
                // Open the final report page
                chrome.tabs.create({ url: chrome.runtime.getURL('finalReport.html') });
            }
        });
        activitySelect.disabled = false;
        startButton.disabled = false;
        endActivityButton.disabled = true;
        activitySelect.value = '';
        resetActivityUI();
    });

    function updateMemoList(memo) {
        const memoList = sidebar.querySelector('#memo-list');
        const memoItem = document.createElement('div');
        memoItem.className = 'memo-item';
        memoItem.textContent = memo;
        memoList.insertBefore(memoItem, memoList.firstChild);
    }

    function updateContextMemoList(memo) {
        const importantContextElement = sidebar.querySelector('#important-context');
        if (importantContextElement) {
            const memoItem = document.createElement('div');
            memoItem.className = 'context-memo-item';
            memoItem.textContent = `Memo: ${memo}`;
            importantContextElement.appendChild(memoItem);
        } else {
            console.error('Important context element not found in the sidebar');
        }
    }

    // Load existing memos and summary for the current page
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        const currentUrl = tabs[0].url;
        chrome.storage.local.get('summaries', (data) => {
            if (data.summaries && data.summaries[currentUrl]) {
                const pageData = data.summaries[currentUrl];
                summaryContent.textContent = pageData.summary;
                pageData.memos.forEach(updateMemoList);
            }
        });
    });

    // Listen for messages from the content script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "updateSummary") {
            summaryContent.textContent = request.summary;
        }
    });
});