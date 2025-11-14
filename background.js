// FILE: background.js
// VERSION: v5.0 (Combined Listeners + Startup Fix)

console.log("BACKGROUND.JS SCRIPT STARTED");

const blockedPageUrl = chrome.runtime.getURL('blocked.html');
// !!! ENSURE THIS IS YOUR CORRECT BACKEND URL !!!
const backendUrlBase = 'https://ai-backend.onrender.com'; 

let userApiKey = null; // In-memory cache

// --- 1. API KEY LOADING ---
async function loadApiKey() {
    try {
        const items = await chrome.storage.sync.get('userApiKey');
        userApiKey = items.userApiKey;
        console.log("API Key loaded:", userApiKey ? "Yes" : "No");
    } catch (error) { console.error("Error loading API key:", error); }
}

// Listen for key changes
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.userApiKey) {
        userApiKey = changes.userApiKey.newValue;
        console.log("API Key updated:", userApiKey ? "Yes" : "No");
        // Re-run heartbeat setup now that we have a key
        setupHeartbeat();
    }
});

// --- 2. HEARTBEAT LOGIC ---
const HEARTBEAT_ALARM_NAME = 'heartbeat';

async function sendHeartbeat() {
    if (!userApiKey || userApiKey.trim() === '') {
        console.log("No API key, skipping heartbeat.");
        return; 
    }
    try {
        const heartbeatUrl = `${backendUrlBase}/heartbeat?key=${userApiKey}`;
        await fetch(heartbeatUrl, { method: 'POST' });
        console.log("Heartbeat sent.");
    } catch (e) { console.error("Heartbeat failed:", e); }
}

function setupHeartbeat() {
    if (!userApiKey || userApiKey.trim() === '') {
        console.log("No API key, not setting up heartbeat alarm.");
        return;
    }
    
    console.log("Setting up heartbeat alarm...");
    chrome.alarms.get(HEARTBEAT_ALARM_NAME, (alarm) => {
        if (!alarm) {
            chrome.alarms.create(HEARTBEAT_ALARM_NAME, { 
                delayInMinutes: 1,  // Wait 1 minute after start
                periodInMinutes: 10 // Ping every 10 minutes
            });
            console.log("Heartbeat alarm created.");
        }
    });
    // Send one immediately on setup
    sendHeartbeat();
}

// Listen for the alarm to fire
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM_NAME) {
        console.log("Heartbeat alarm triggered.");
        sendHeartbeat();
    }
});
// Listen for browser startup
chrome.runtime.onStartup.addListener(() => {
    console.log("Browser startup, loading key and sending heartbeat.");
    loadApiKey().then(sendHeartbeat); // Load key, then send
});

// --- 3. CORE MESSAGE LISTENER (Only ONE) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // We must have an API key to do anything
    if (!userApiKey || userApiKey.trim() === '') {
        console.log('Message received, but no API key is set. Ignoring.');
        return; 
    }

    // --- ROUTER ---
    if (message.type === 'PAGE_DATA_RECEIVED' && sender.tab?.id && message.data?.url) {
        handlePageCheck(message.data, sender.tab.id);
        return true; // We are handling this asynchronously
    }
    
    if (message.type === 'LOG_SHORTS_EVENT') {
        handleShortsSession(message.isEnteringShorts, sender.tab.url);
        return true; // Handling asynchronously
    }
    // --- END ROUTER ---

    return false; // We didn't handle this message
});

// --- 4. SHORTS SESSION MANAGEMENT ---
// (The duplicate function block that was here has been removed)

async function handleShortsSession(isEnteringShorts, url) {
    // Get the current session state from storage
    const { shortsSession } = await chrome.storage.local.get('shortsSession');
    
    if (isEnteringShorts) {
        // --- User is ON a Shorts page ---
        if (!shortsSession || !shortsSession.active) {
            // STARTING a new session
            console.log("Starting Shorts Session");
            const newSession = { active: true, count: 1, startTime: Date.now() };
            await chrome.storage.local.set({ 'shortsSession': newSession });
            
            // Log the START
            await sendLogEvent({ 
                title: "Started watching Shorts", 
                reason: "Shorts Session (Start)", 
                decision: "ALLOW",
                url: url
            });
        } else {
            // CONTINUING a session
            const newCount = shortsSession.count + 1;
            // Update the count in storage
            await chrome.storage.local.set({ 'shortsSession': { ...shortsSession, count: newCount } });
            // Do NOT log, just count
        }
    } else {
        // --- User has LEFT a Shorts page ---
        if (shortsSession && shortsSession.active) {
            // ENDING a session
            console.log(`Ending Shorts Session. Total: ${shortsSession.count}`);
            const totalCount = shortsSession.count;
            // Clear the session from storage
            await chrome.storage.local.remove('shortsSession');
            
            // Log the END
            await sendLogEvent({ 
                title: `Finished watching Shorts (Total: ${totalCount})`, 
                reason: "Shorts Session (End)", 
                decision: "ALLOW",
                url: url // Send the URL they navigated *to*
            });
        }
    }
}

// Helper to send logs to our new '/log-event' endpoint
async function sendLogEvent(logData) {
    if (!userApiKey) return;
    try {
        await fetch(`${backendUrlBase}/log-event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userApiKey}` },
            body: JSON.stringify(logData)
        });
    } catch (error) { console.error("Log error:", error); }
}

// --- 5. PAGE CHECK HANDLER ---
async function handlePageCheck(pageData, tabId) {
    if (!tabId) return;
    
    const targetUrl = pageData.url;
    if (targetUrl.startsWith(blockedPageUrl)) return; // Prevent loop

    console.log("Background: Received PAGE_DATA for:", targetUrl);

    try {
        const response = await fetch(`${backendUrlBase}/check-url`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userApiKey}`
            },
            body: JSON.stringify(pageData)
        });

        if (!response.ok) {
           console.error('Backend returned an error. Status:', response.status);
           throw new Error('Server error');
        }
        
        const data = await response.json();
        console.log('Server decision for', targetUrl, 'is', data.decision);
        
        if (data.decision === 'BLOCK') {
          chrome.tabs.get(tabId, (tab) => {
              if (chrome.runtime.lastError || !tab) {
                  console.warn(`Tab ${tabId} closed before block could be applied.`);
              } else if (tab.url !== blockedPageUrl) {
                  chrome.tabs.update(tabId, { url: blockedPageUrl });
              }
          });
        }
    } catch (error) {
        console.error('Error fetching/processing backend response:', error);
         chrome.tabs.get(tabId, (tab) => {
             if (chrome.runtime.lastError || !tab) {
                  console.warn(`Tab ${tabId} closed before error block could be applied.`);
             } else if (tab) {
                 chrome.tabs.update(tabId, { url: blockedPageUrl });
             }
          });
    }
}

// --- 6. STARTUP LOGIC ---
// This runs once when the extension is first loaded or reloaded.
// It loads the key into memory, then sets up the heartbeat.
async function initialize() {
    await loadApiKey();
    setupHeartbeat();
}

initialize();

console.log("BACKGROUND.JS LISTENING FOR MESSAGES");