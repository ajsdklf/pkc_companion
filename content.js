let port;
let isConnected = false;
let reconnectInterval;
let sidebarInjected = false;
let currentActivity = null;
let summaries = {};
let selectedText = '';
let activityStatsInterval;

function connectToBackgroundScript() {
    port = chrome.runtime.connect({name: "pkc-connection"});
    
    port.onDisconnect.addListener(function() {
        console.log("Disconnected from background script. Attempting to reconnect...");
        isConnected = false;
        clearInterval(reconnectInterval);
        reconnectInterval = setInterval(connectToBackgroundScript, 5000);
    });

    port.onMessage.addListener(handleBackgroundMessage);

    isConnected = true;
    clearInterval(reconnectInterval);
    console.log("Connected to background script");
}

function handleBackgroundMessage(msg) {
    console.log("Received message from background:", msg);

    const handlers = {
        pong: () => console.log("Background script is alive"),
        updateSummary: () => updateSummaryContent(msg.summary),
        updateActivityStatus: () => updateActivityUI(msg.activity),
        endActivity: () => handleActivityEnd(msg.finalReport),
        reportOpened: () => console.log("Final report opened in new tab"),
        updateImportantContext: () => updateImportantContextUI(msg.context),
        updateMemos: () => updateMemoList(msg.memo),
        updateActivityStats: () => updateActivityStats(msg.stats),
        error: () => handleError(msg.message)
    };

    const handler = handlers[msg.action];
    if (handler) {
        handler();
    } else {
        console.warn("Unknown message type received:", msg.action);
    }
}

function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
        if (!isConnected) {
            reject(new Error("Not connected to background script"));
            return;
        }
        try {
            port.postMessage(message);
            port.onMessage.addListener(function listener(response) {
                port.onMessage.removeListener(listener);
                resolve(response);
            });
        } catch (error) {
            reject(error);
        }
    });
}

async function checkExtensionValidity() {
    if (!chrome.runtime || !chrome.runtime.id) {
        return false;
    }
    
    try {
        await sendMessageToBackground({action: "ping"});
        return true;
    } catch (error) {
        console.warn('Extension validity check failed:', error);
        return false;
    }
}

function handleError(error) {
    console.error('Extension error:', error);
    if (error.message && error.message.includes('Extension context invalidated')) {
        console.log('Extension context invalidated. Attempting to reconnect...');
        isConnected = false;
        clearInterval(activityStatsInterval);
        disableExtensionFunctionality();
        connectToBackgroundScript();
    }
}

function disableExtensionFunctionality() {
    const sidebar = document.getElementById('pkc-sidebar-container');
    if (sidebar) {
        sidebar.style.display = 'none';
    }
    const toggleButton = document.getElementById('pkc-toggle');
    if (toggleButton) {
        toggleButton.style.display = 'none';
    }
}

async function initializeContentScript() {
    console.log('Initializing content script...');
    try {
        const isValid = await checkExtensionValidity();
        if (isValid) {
            await injectSidebar();
            setupEventListeners();
            await loadExistingData();
        } else {
            throw new Error('Extension context is invalid. Please refresh the page.');
        }
    } catch (error) {
        handleError(error);
    }
}

async function injectSidebar() {
    if (sidebarInjected) return;
    
    const sidebarContainer = createSidebarContainer();
    await fetchAndInjectSidebar(sidebarContainer);
    createToggleButton();
}

function createSidebarContainer() {
    const container = document.createElement('div');
    container.id = 'pkc-sidebar-container';
    Object.assign(container.style, {
        position: 'fixed',
        top: '0',
        right: '0',
        width: '300px',
        height: '100%',
        zIndex: '9999',
        transition: 'transform 0.3s ease-in-out',
        transform: 'translateX(100%)'
    });
    return container;
}

async function fetchAndInjectSidebar(container) {
    try {
        const response = await fetch(chrome.runtime.getURL('sidebar.html'));
        const data = await response.text();
        container.innerHTML = data;
        document.body.appendChild(container);
        console.log('Sidebar container appended to body');
        sidebarInjected = true;
        await initializeSidebar();
    } catch (error) {
        console.error('Error fetching sidebar HTML:', error);
        handleError(error);
    }
}

function createToggleButton() {
    const button = document.createElement('button');
    button.id = 'pkc-toggle';
    button.textContent = 'PKC';
    Object.assign(button.style, {
        position: 'fixed',
        top: '50%',
        right: '0',
        transform: 'translateY(-50%) rotate(-90deg)',
        transformOrigin: 'right bottom',
        zIndex: '10000',
        padding: '5px 10px',
        backgroundColor: '#3e6ae1',
        color: 'white',
        border: 'none',
        borderRadius: '0 0 5px 5px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 'bold',
        boxShadow: '0 0 5px rgba(62, 106, 225, 0.5)'
    });
    button.addEventListener('click', toggleSidebar);
    document.body.appendChild(button);
}

function toggleSidebar() {
    const sidebar = document.getElementById('pkc-sidebar-container');
    sidebar.style.transform = 
        sidebar.style.transform === 'translateX(100%)' ? 'translateX(0)' : 'translateX(100%)';
}

function handleTextSelection() {
    selectedText = window.getSelection().toString().trim();
}

function handleKeyPress(e) {
    if (e.metaKey && e.key === 'h') {  // Command + H
        if (selectedText) {
            appendImportantContext(selectedText);
        }
    }
}

async function appendImportantContext(context) {
    try {
        const url = window.location.href;
        const response = await sendMessageToBackground({
            action: "appendImportantContext",
            context,
            url
        });
        if (response.status === 'success') {
            updateImportantContextUI(context);
            selectedText = '';
        } else {
            throw new Error(response.message || 'Unknown error');
        }
    } catch (error) {
        console.error('Error appending important context:', error);
        handleError(error);
    }
}

function updateImportantContextUI(context) {
    const importantContextElement = document.querySelector('#important-context');
    if (importantContextElement) {
        const contextItem = document.createElement('div');
        contextItem.className = 'important-context-item';
        contextItem.textContent = context;
        importantContextElement.appendChild(contextItem);
    } else {
        console.error('Important context element not found in the sidebar');
    }
}

function setupEventListeners() {
    document.addEventListener('selectionchange', handleTextSelection);
    document.addEventListener('keydown', handleKeyPress);
    
    const elements = getSidebarElements();
    elements.startButton.addEventListener('click', startActivity);
    elements.addMemoButton.addEventListener('click', addMemo);
    elements.endActivityButton.addEventListener('click', endActivity);
    elements.viewReportButton.addEventListener('click', viewReport);
}

async function initializeSidebar() {
    const sidebarElements = getSidebarElements();
    if (!validateSidebarElements(sidebarElements)) return;
    
    await initializeUIState(sidebarElements);
    loadImportantContext();
}

function loadImportantContext() {
    chrome.storage.local.get('importantContexts', data => {
        const importantContexts = data.importantContexts || {};
        const currentUrl = window.location.href;
        if (importantContexts[currentUrl]) {
            importantContexts[currentUrl].forEach(context => updateImportantContextUI(context.text));
        }
    });
}

function getSidebarElements() {
    const sidebar = document.getElementById('pkc-sidebar-container');
    if (!sidebar) return null;

    const pkcSidebar = sidebar.querySelector('#pkc-sidebar');
    if (!pkcSidebar) return null;

    return {
        activitySelect: pkcSidebar.querySelector('#activity-select'),
        startButton: pkcSidebar.querySelector('#start-button'),
        memoInput: pkcSidebar.querySelector('#memo-input'),
        addMemoButton: pkcSidebar.querySelector('#add-memo-button'),
        endActivityButton: pkcSidebar.querySelector('#end-activity-button'),
        summaryContent: pkcSidebar.querySelector('#summary-content'),
        currentActivityTag: pkcSidebar.querySelector('#current-activity-tag'),
        activityProgressBar: pkcSidebar.querySelector('#activity-progress-bar'),
        viewReportButton: pkcSidebar.querySelector('#view-report-button'),
        pagesVisited: pkcSidebar.querySelector('#pages-visited'),
        memosAdded: pkcSidebar.querySelector('#memos-added'),
        timeSpent: pkcSidebar.querySelector('#time-spent')
    };
}

function validateSidebarElements(elements) {
    for (const [key, value] of Object.entries(elements)) {
        if (!value) {
            console.error(`Sidebar element not found: ${key}`);
            return false;
        }
    }
    return true;
}

async function initializeUIState(elements) {
    try {
        const data = await chrome.storage.local.get('currentActivity');
        if (data.currentActivity) {
            currentActivity = data.currentActivity;
            elements.activitySelect.value = currentActivity;
            elements.activitySelect.disabled = true;
            elements.startButton.disabled = true;
            elements.endActivityButton.disabled = false;
            updateActivityUI(currentActivity);
            requestActivityStats();
        } else {
            elements.endActivityButton.disabled = true;
        }
    } catch (error) {
        console.error('Error initializing UI state:', error);
        handleError(error);
    }
}

async function loadExistingData() {
    try {
        const data = await chrome.storage.local.get('summaries');
        if (data.summaries) {
            summaries = data.summaries;
            if (summaries[window.location.href]) {
                const pageData = summaries[window.location.href];
                updateSummaryContent(pageData.summary);
                pageData.memos.forEach(updateMemoList);
            } else {
                await summarizePage();
            }
        }
    } catch (error) {
        console.error('Error loading existing data:', error);
        handleError(error);
    }
}

function updateActivityUI(activity) {
    const elements = getSidebarElements();
    elements.currentActivityTag.textContent = activity.charAt(0).toUpperCase() + activity.slice(1);
    elements.currentActivityTag.style.display = 'inline-block';
    elements.currentActivityTag.className = `activity-tag ${activity}`;
    elements.activityProgressBar.style.width = '0%';
    elements.activityProgressBar.style.transition = 'width 3600s linear';
    setTimeout(() => {
        elements.activityProgressBar.style.width = '100%';
    }, 50);
}

function updateMemoList(memo) {
    const memoList = document.querySelector('#memo-list');
    const memoItem = document.createElement('div');
    memoItem.className = 'memo-item';
    memoItem.textContent = memo;
    memoList.insertBefore(memoItem, memoList.firstChild);
}

async function startActivity() {
    const elements = getSidebarElements();
    const activity = elements.activitySelect.value;
    if (activity) {
        try {
            const response = await sendMessageToBackground({ action: "startActivity", activity });
            if (response.status === 'success') {
                currentActivity = activity;
                elements.activitySelect.disabled = true;
                elements.startButton.disabled = true;
                elements.endActivityButton.disabled = false;
                updateActivityUI(activity);
                await summarizePage();
                requestActivityStats();
            } else {
                console.error('Error starting activity:', response.message);
            }
        } catch (error) {
            console.error('Error starting activity:', error);
            handleError(error);
        }
    }
}

async function addMemo() {
    const elements = getSidebarElements();
    const memo = elements.memoInput.value.trim();
    if (memo) {
        if (!summaries[window.location.href]) {
            summaries[window.location.href] = { summary: '', memos: [] };
        }
        summaries[window.location.href].memos.push(memo);
        try {
            await chrome.storage.local.set({ summaries });
            elements.memoInput.value = '';
            updateMemoList(memo);
            requestActivityStats();
        } catch (error) {
            console.error('Error adding memo:', error);
            handleError(error);
        }
    }
}

async function summarizePage() {
    try {
        const response = await sendMessageToBackground({
            action: "summarize",
            content: document.body.innerText,
            url: window.location.href
        });
        
        if (response.status === 'success') {
            updateSummaryContent(response.summary);
            summaries[window.location.href] = { summary: response.summary, memos: [] };
            await chrome.storage.local.set({ summaries });
            requestActivityStats();
        } else {
            throw new Error(response.message || 'Unknown error');
        }
    } catch (error) {
        console.error('Error in summarizePage:', error);
        updateSummaryContent('Failed to generate summary. Please try again later.');
    }
}

async function endActivity() {
    try {
        const response = await sendMessageToBackground({ action: "endActivity", summaries });
        if (response.status === 'success') {
            console.log('Activity ended successfully');
            await chrome.storage.local.set({ 
                currentActivity: null, 
                finalReport: response.finalReport 
            });
            currentActivity = null;
            summaries = {};
            updateUIAfterActivityEnd();
        } else {
            console.error('Error ending activity:', response.message);
        }
    } catch (error) {
        console.error('Error ending activity:', error);
        handleError(error);
    }
}

function updateUIAfterActivityEnd() {
    const elements = getSidebarElements();
    elements.activitySelect.disabled = false;
    elements.startButton.disabled = false;
    elements.endActivityButton.disabled = true;
    elements.viewReportButton.style.display = 'block';
    elements.currentActivityTag.style.display = 'none';
    elements.activityProgressBar.style.width = '0%';
}

async function viewReport() {
    try {
        await sendMessageToBackground({ action: "openFinalReport" });
    } catch (error) {
        console.error('Error opening final report:', error);
        handleError(error);
    }
}

function updateSummaryContent(summary) {
    const summaryContent = document.querySelector('#summary-content');
    if (summaryContent) {
        summaryContent.textContent = summary;
    }
}

function updateActivityStats(stats) {
    const elements = getSidebarElements();
    if (elements) {
        elements.pagesVisited.textContent = stats.pagesVisited;
        elements.memosAdded.textContent = stats.memosAdded;
        elements.timeSpent.textContent = stats.timeSpent;
    }
}

function requestActivityStats() {
    sendMessageToBackground({ action: "getActivityStats" });
}

function cleanup() {
    document.removeEventListener('selectionchange', handleTextSelection);
    document.removeEventListener('keydown', handleKeyPress);
    clearInterval(activityStatsInterval);
}

// Listen for extension updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "extensionUpdated") {
        location.reload();
    }
});

// Listen for navigation events
if (chrome.webNavigation) {
    chrome.webNavigation.onBeforeNavigate.addListener((details) => {
        if (details.frameId === 0 && details.tabId === chrome.tabs.TAB_ID_NONE) {
            cleanup();
        }
    });
}

// Add a global error handler
window.addEventListener('error', (event) => {
    handleError(event.error);
});

// Add unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
    handleError(event.reason);
});

// Initialize the content script
connectToBackgroundScript();
initializeContentScript().catch(handleError);

console.log('Content script finished running');