// background.js
console.log("BACKGROUND.JS SCRIPT STARTED - v1.0 CS");

const blockedPageUrl = chrome.runtime.getURL('blocked.html');
// --- Use YOUR Render URL BASE ---
const backendUrlBase = 'https://chrometest-backend-xxxx.onrender.com'; // Replace YOUR URL (NO PATH!)

let userApiKey = null;

async function loadApiKey() {
    try {
        const items = await chrome.storage.sync.get('userApiKey');
        userApiKey = items.userApiKey;
        console.log("API Key loaded:", userApiKey ? "Yes" : "No");
    } catch (error) {
        console.error("Error loading API key:", error);
    }
}

// Load the key when the extension starts
loadApiKey();

// Listen for changes in storage
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.userApiKey) {
    userApiKey = changes.userApiKey.newValue;
    console.log("API Key updated:", userApiKey ? "Yes" : "No");
  }
});

// --- Listen for messages from Content Script ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Check message type, ensure we have tab info and URL data
    if (message.type === 'PAGE_DATA_RECEIVED' && sender.tab?.id && message.data?.url) {
        const tabId = sender.tab.id;
        const pageData = message.data;
        const targetUrl = pageData.url; // URL is now part of pageData

        console.log("Background: Received PAGE_DATA for:", targetUrl);

        // Use the API key loaded into memory
        if (!userApiKey) {
            console.log('No API key set in storage. Stopping block check.');
            return true; // Indicate async potential if needed, though we stop here
        }

        // Prevent loop if somehow the blocked page sends data
        if (targetUrl.startsWith(blockedPageUrl)) {
            console.log("Ignoring message from blocked page.");
            return true;
        }

        // --- Make the call to the backend ---
        // Use POST, send data in body
        fetch(`${backendUrlBase}/check-url`, { // Use base URL + path
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${userApiKey}`
            },
            body: JSON.stringify(pageData) // Send title, desc, h1, url
        })
        .then(response => {
            const contentType = response.headers.get("content-type");
            if (!response.ok || !contentType || !contentType.includes("application/json")) {
               console.error('Backend did not return valid JSON. Status:', response.status);
               // Block on error
               if (tabId >= 0) { chrome.tabs.update(tabId, { url: blockedPageUrl }); }
               throw new Error('Invalid backend response');
            }
            return response.json();
          })
          .then(data => {
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
          })
          .catch(error => {
            console.error('Error fetching/processing backend response:', error);
             // Block on error
             chrome.tabs.get(tabId, (tab) => {
                 if (chrome.runtime.lastError) {
                      console.warn(`Tab ${tabId} closed before error block could be applied.`);
                 } else if (tab) {
                     chrome.tabs.update(tabId, { url: blockedPageUrl });
                 }
              });
          });

        return true; // Indicate you will respond asynchronously
    }
    // Return false or undefined for messages you don't handle
    return false;
});

console.log("BACKGROUND.JS LISTENING FOR MESSAGES");