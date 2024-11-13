import { OPENAI_API_KEY } from './config.js';

const OPENAI_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

let ports = new Map();
let activityStats = {
    pagesVisited: 0,
    memosAdded: 0,
    startTime: null
};

chrome.runtime.onConnect.addListener(function(port) {
    const tabId = port.sender.tab.id;
    ports.set(tabId, port);
    console.log(`New connection established for tab ${tabId}`);

    port.onDisconnect.addListener(() => {
        ports.delete(tabId);
        console.log(`Connection closed for tab ${tabId}`);
    });

    port.onMessage.addListener((msg) => handleMessage(msg, port));
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log('PKC Extension installed');
    chrome.storage.local.set({ activities: [], summaries: {}, connections: [] });

    if (details.reason === "update") {
        notifyAllTabsOfUpdate();
    }
});

function notifyAllTabsOfUpdate() {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, {action: "extensionUpdated"}).catch(error => {
                console.log(`Failed to send update message to tab ${tab.id}:`, error);
            });
        });
    });
}

async function handleMessage(request, port) {
    console.log('Message received:', request);
    
    try {
        let response;
        switch (request.action) {
            case "ping":
                response = {action: "pong", status: "alive"};
                break;
            case "summarize":
                response = await handleSummarize(request);
                break;
            case "endActivity":
                response = await handleEndActivity(request);
                break;
            case "openFinalReport":
                response = await handleOpenFinalReport();
                break;
            case "startActivity":
                response = await handleStartActivity(request);
                break;
            case "appendImportantContext":
                response = await handleAppendImportantContext(request);
                break;
            case "addContextMemo":
                response = await handleAddContextMemo(request);
                break;
            case "getActivityStats":
                response = await handleGetActivityStats();
                break;
            default:
                throw new Error(`Unknown action: ${request.action}`);
        }
        port.postMessage({...response, status: 'success'});
    } catch (error) {
        console.error(`Error handling ${request.action}:`, error);
        port.postMessage({action: "error", status: 'error', message: error.message});
    }
}

async function handleSummarize(request) {
    const summary = await summarizePage(request.content, request.url);
    updateActivityStats('pagesVisited');
    return {action: "updateSummary", summary};
}

async function handleEndActivity(request) {
    const finalReport = await endActivity(request.summaries);
    resetActivityStats();
    return {action: "endActivity", finalReport};
}

async function handleOpenFinalReport() {
    chrome.tabs.create({ url: chrome.runtime.getURL('finalReport.html') });
    return {action: "reportOpened"};
}

async function handleStartActivity(request) {
    await startActivity(request.activity);
    initializeActivityStats();
    return {action: "updateActivityStatus", activity: request.activity};
}

async function handleAppendImportantContext(request) {
    await appendImportantContext(request.context, request.url);
    return {action: "updateImportantContext", context: request.context};
}

async function handleAddContextMemo(request) {
    await addContextMemo(request.memo, request.url, request.contextIndex);
    updateActivityStats('memosAdded');
    return {action: "updateMemos", memo: request.memo};
}

function handleGetActivityStats() {
    return {action: "updateActivityStats", stats: getActivityStats()};
}

async function callOpenAI(messages) {
    try {
        const response = await fetch(OPENAI_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: messages,
                max_tokens: 150
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
            throw new Error('Unexpected API response structure');
        }
        return data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error calling OpenAI API:', error);
        throw new Error('Failed to generate content. Please try again later.');
    }
}

async function summarizePage(content, url) {
    console.log(`Summarizing page: ${url}`);
    
    const maxLength = 4000;
    const truncatedContent = content.length > maxLength 
        ? content.slice(0, maxLength) + "..." 
        : content;

    const messages = [
        { role: "system", content: "Summarize the following content in 2-3 sentences. Focus on the main idea of the content." },
        { role: "user", content: truncatedContent }
    ];

    return await callOpenAI(messages);
}

async function startActivity(activity) {
    await chrome.storage.local.set({ summaries: {} });
    await chrome.storage.local.set({ currentActivity: activity });

    const { activities = [] } = await chrome.storage.local.get('activities');
    if (!activities.includes(activity)) {
        activities.push(activity);
        await chrome.storage.local.set({ activities });
    }

    console.log(`Activity "${activity}" started`);
}

async function appendImportantContext(context, url) {
    const { importantContexts = {} } = await chrome.storage.local.get('importantContexts');
    if (!importantContexts[url]) {
        importantContexts[url] = [];
    }
    importantContexts[url].push({ text: context, memos: [] });
    await chrome.storage.local.set({ importantContexts });
}

async function addContextMemo(memo, url, contextIndex) {
    const { importantContexts = {} } = await chrome.storage.local.get('importantContexts');
    if (importantContexts[url] && importantContexts[url][contextIndex]) {
        if (!importantContexts[url][contextIndex].memos) {
            importantContexts[url][contextIndex].memos = [];
        }
        importantContexts[url][contextIndex].memos.push(memo);
        await chrome.storage.local.set({ importantContexts });
    } else {
        throw new Error('Context not found');
    }
}

async function endActivity(summaries) {
    const { currentActivity } = await chrome.storage.local.get('currentActivity');
    const { importantContexts = {} } = await chrome.storage.local.get('importantContexts');
    
    if (!currentActivity) {
        throw new Error('No active activity to end');
    }

    const messages = [
        { role: "system", content: "Analyze the following documents, their important contexts, and memos to provide 3 connections between them, as well as an overall summary of the activity. Provide your response in JSON format with 'connections' as an array of 3 strings and 'overallSummary' as a string." },
        { role: "user", content: JSON.stringify({summaries, importantContexts}) }
    ];

    const resultString = await callOpenAI(messages);
    const result = JSON.parse(resultString);

    const connections = Array.isArray(result.connections) ? result.connections : ["No connections generated"];
    const overallSummary = typeof result.overallSummary === 'string' ? result.overallSummary : "No overall summary generated";

    const finalReport = { summaries, connections, overallSummary, importantContexts };

    const { finalReports = {} } = await chrome.storage.local.get('finalReports');
    finalReports[currentActivity] = finalReport;
    await chrome.storage.local.set({ finalReports });
    await chrome.storage.local.set({ currentActivity: null });

    console.log(`Activity "${currentActivity}" ended and report saved`);
    return finalReport;
}

function initializeActivityStats() {
    activityStats = {
        pagesVisited: 1,
        memosAdded: 0,
        startTime: Date.now()
    };
    broadcastActivityStats();
}

function updateActivityStats(type) {
    if (type === 'pagesVisited') {
        activityStats.pagesVisited++;
    } else if (type === 'memosAdded') {
        activityStats.memosAdded++;
    }
    broadcastActivityStats();
}

function getActivityStats() {
    const currentTime = Date.now();
    const timeSpent = Math.floor((currentTime - activityStats.startTime) / 1000);
    const minutes = Math.floor(timeSpent / 60);
    const seconds = timeSpent % 60;
    return {
        pagesVisited: activityStats.pagesVisited,
        memosAdded: activityStats.memosAdded,
        timeSpent: `${minutes}:${seconds.toString().padStart(2, '0')}`
    };
}

function broadcastActivityStats() {
    const stats = getActivityStats();
    ports.forEach(port => {
        port.postMessage({action: "updateActivityStats", status: 'success', stats});
    });
}

function resetActivityStats() {
    activityStats = {
        pagesVisited: 0,
        memosAdded: 0,
        startTime: null
    };
    broadcastActivityStats();
}

chrome.runtime.onMessage.addListener(() => true);

setInterval(broadcastActivityStats, 1000);