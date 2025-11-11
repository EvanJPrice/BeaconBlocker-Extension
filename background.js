// background.js
console.log("BACKGROUND.JS SCRIPT STARTED");

const blockedPageUrl = chrome.runtime.getURL('blocked.html');
// --- Use YOUR Backend Render URL ---
const backendUrlBase = 'https://ai-backend.onrender.com'; // <-- ENSURE THIS IS YOUR URL

let userApiKey = null;

// --- API Key Loading ---
async function loadApiKey() {
    try {
        const items = await chrome.storage.sync.get('userApiKey');
        userApiKey = items.userApiKey;
        console.log("API Key loaded:", userApiKey ? "Yes" : "No");
    } catch (error) {
        console.error("Error loading API key:", error);
    }
}

// Listen for changes in storage (e.g., when user saves in options)
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.userApiKey) {
        userApiKey = changes.userApiKey.newValue;
        console.log("API Key updated:", userApiKey ? "Yes" : "No");
        // Re-run heartbeat setup now that we have a key
        setupHeartbeat();
    }
});

// --- Heartbeat Setup ---
const HEARTBEAT_ALARM_NAME = 'heartbeat';

// Function to send the heartbeat ping
async function sendHeartbeat() {
    const { userApiKey } = await chrome.storage.sync.get('userApiKey');
    
    // This check is also important here!
    if (userApiKey && userApiKey.trim() !== '') {
        try {
            // Use your original, correct variable name 'backendUrlBase'
            const heartbeatUrl = `${backendUrlBase}/heartbeat?key=${userApiKey}`;

            await fetch(heartbeatUrl, { method: 'POST' });
            console.log("Heartbeat sent.");
        } catch (e) {
            console.error("Heartbeat failed:", e);
        }
    }
}

// Listen for the alarm to fire
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEARTBEAT_ALARM_NAME) {
        console.log("Heartbeat alarm triggered.");
        sendHeartbeat();
    }
});

// --- NEW: Send heartbeat on BROWSER startup ---
chrome.runtime.onStartup.addListener(() => {
    console.log("Browser startup detected, sending heartbeat.");
    sendHeartbeat();
});

// --- NEW: Send heartbeat on extension install/update ---
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install" || details.reason === "update") {
        console.log("Extension installed/updated, sending heartbeat.");
        sendHeartbeat();
    }
});

// --- UPDATED: Create alarm (if needed) ---
chrome.alarms.get(HEARTBEAT_ALARM_NAME, (alarm) => {
    if (!alarm) {
        chrome.alarms.create(HEARTBEAT_ALARM_NAME, { 
            delayInMinutes: 1,  // Wait 1 minute after start
            periodInMinutes: 10 // Ping every 10 minutes
        });
        console.log("Heartbeat alarm created.");
    }
});

// (The bad global sendHeartbeat() call is now GONE)
// --- End Heartbeat Setup ---

// --- UPDATED CHECK ---
        // This now correctly catches null, undefined, and empty/whitespace strings
        if (!userApiKey || userApiKey.trim() === '') { 
            console.log('No API key set in storage. Stopping block check.');
            return true; // Stop processing
        }


// --- Listen for messages from Content Script (NOW ASYNC) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Check message type, ensure we have tab info and URL data
    if (message.type === 'PAGE_DATA_RECEIVED' && sender.tab?.id && message.data?.url) {
        const tabId = sender.tab.id;
        const pageData = message.data;
        const targetUrl = pageData.url; // URL is now part of pageData

        console.log("Background: Received PAGE_DATA for:", targetUrl);

        // --- ENTIRELY NEW ASYC BLOCK ---
        // This IIFE (Immediately Invoked Function Expression)
        // allows us to use async/await inside the listener.
        (async () => {
            // 1. Get the key from storage directly, ensuring we have it.
            const { userApiKey } = await chrome.storage.sync.get('userApiKey');

            // 2. Perform the robust check on the key we just fetched.
            if (!userApiKey || userApiKey.trim() === '') {
                console.log('No API key set in storage. Stopping block check.');
                return; // Stop processing
            }

            // 3. Prevent loop if somehow the blocked page sends data
            if (targetUrl.startsWith(blockedPageUrl)) {
                console.log("Ignoring message from blocked page.");
                return;
            }

            // 4. Proceed with the fetch call
            try {
                const response = await fetch(`${backendUrlBase}/check-url`, { // Use base URL + path
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${userApiKey}`
                    },
                    body: JSON.stringify(pageData) // Send title, desc, h1, url
                });

                const contentType = response.headers.get("content-type");
                if (!response.ok || !contentType || !contentType.includes("application/json")) {
                   console.error('Backend did not return valid JSON. Status:', response.status);
                   // Block on error
                   if (tabId >= 0) { chrome.tabs.update(tabId, { url: blockedPageUrl }); }
                   throw new Error('Invalid backend response');
                }
                
                const data = await response.json();
                console.log('Server decision for', targetUrl, 'is', data.decision);
                if (data.decision === 'BLOCK') {
                  // Check tab still exists before updating
                  chrome.tabs.get(tabId, (tab) => {
                      if (chrome.runtime.lastError) {
                          console.warn(`Tab ${tabId} closed before block could be applied.`);
                      } else if (tab && tab.url !== blockedPageUrl) { // Double check URL to prevent loop
                          chrome.tabs.update(tabId, { url: blockedPageUrl });
                      }
                  });
                }
            } catch (error) {
                console.error('Error fetching/processing backend response:', error);
                 // Block on error
                 chrome.tabs.get(tabId, (tab) => {
                     if (chrome.runtime.lastError) {
                          console.warn(`Tab ${tabId} closed before error block could be applied.`);
                     } else if (tab) {
                         chrome.tabs.update(tabId, { url: blockedPageUrl });
                     }
                  });
            }
        })(); // End of async IIFE
        // --- END OF NEW BLOCK ---

        return true; // Indicate you will respond asynchronously
    }
    // Return false or undefined for messages you don't handle
    return false;
});

// --- !! STARTUP LOGIC !! ---
// Load the key first, and THEN set up the heartbeat.
// This fixes the race condition.
loadApiKey().then(() => {
    setupHeartbeat();
});

console.log("BACKGROUND.JS LISTENING FOR MESSAGES");