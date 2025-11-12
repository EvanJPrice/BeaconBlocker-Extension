// content-script.js
console.log("CONTENT SCRIPT INJECTED into:", window.location.href);

let lastProcessedUrl = '';
let debounceTimeout = null;
let pageObserver = null;
// --- Use the more specific selector derived from Inspect Element ---
const YT_TITLE_SELECTOR = 'h1 yt-formatted-string.style-scope.ytd-watch-metadata, #video-title'; // Prioritize specific element, fallback to common ID

// --- Helper: Extract Search Query ---
function getSearchQuery(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        if (hostname.includes("google.") || hostname.includes("bing.")) {
            const query = urlObj.searchParams.get('q');
            if (query) { console.log("Search query:", query); return query; }
        }
        if (hostname.includes("youtube.com") && urlObj.pathname === "/results") {
             const query = urlObj.searchParams.get('search_query');
             if (query) { console.log("YT search query:", query); return query; }
        }
    } catch (e) { console.error("Error parsing URL:", e); }
    return null;
}

// --- Function: Get Page Data (Uses specific YT selector) ---
async function getPageData() {
    console.log("getPageData function called.");
    let title = '', description = '', h1 = '';
    const currentUrl = window.location.href;
    const hostname = window.location.hostname;
    const searchQuery = getSearchQuery(currentUrl);

    if (hostname.includes("youtube.com")) {
        // --- THIS IS THE NEW LOGIC ---
        if (currentUrl.includes("/watch")) {
            // It's a video page, scrape the details.
            console.log("getPageData: YouTube watch page. Using specific selector.");

            console.log("getPageData: Reading YT element now.");

            const ytTitleElement = document.querySelector(YT_TITLE_SELECTOR);
            title = ytTitleElement?.textContent?.trim() || document.title || '';
            description = document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content || '';
            h1 = title; // Use the found title as H1 for consistency

        } else {
            // It's the YT main page, search, or subscriptions. DO NOT CHECK.
            console.log("getPageData: YouTube browse page. Allowing by default.");
            return null; // This is the key: we stop here and send no message.
        }
        // --- END NEW LOGIC ---

    } else { // General Fallback for non-YouTube sites
        title = document.title || '';
        description = document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content || '';
        if (!searchQuery) { // Removed the !hostname.includes("youtube.com") check
            h1 = document.querySelector('h1')?.textContent || '';
        }
    }

    title = title.trim(); description = description.trim(); h1 = h1 ? h1.trim() : '';
    console.log("Cleaned title:", title || '(empty)');

    if ((!title && !description && !h1 && !searchQuery) || !currentUrl.startsWith('http')) {
        console.log("getPageData: Not enough useful data or not HTTP(S) URL.");
        return null;
    }
    return { title, description, h1, url: currentUrl, searchQuery };
}

// --- Function to send the message (Debounced) ---
async function sendMessageIfNeeded() { // Made async to await getPageData
    try {
        const pageData = await getPageData(); // Await potential delay
        if (pageData && pageData.url.startsWith('http')) {
            if (pageData.url !== lastProcessedUrl) {
                console.log("CS: URL changed/confirmed, preparing send for", pageData.url);
                lastProcessedUrl = pageData.url;

                clearTimeout(debounceTimeout);
                debounceTimeout = setTimeout(() => {
                    console.log("CS: Debounce timer fired, sending message for", pageData.url);
                    chrome.runtime.sendMessage({ type: 'PAGE_DATA_RECEIVED', data: pageData }, (response) => {
                         if (chrome.runtime.lastError) { console.warn("CS: Error sending message:", chrome.runtime.lastError.message); }
                    });
                }, 500); // Debounce delay
            }
        } else {
             console.log("CS: No useful data or not HTTP URL, not sending.");
        }
    } catch (error) { console.error("CS: Error preparing/sending message:", error); }
}

// --- Smarter Mutation Observer Callback ---
function handlePageMutation(mutationsList, observer) {
    let titleChanged = false;

    // Check if the URL itself has changed
    if (window.location.href !== lastProcessedUrl && window.location.href.startsWith('http')) {
        console.log("CS Observer: URL change detected.");
        // If it's NOT a YouTube watch page, send immediately.
        // If it IS a YouTube watch page, we WAIT for the title mutation.
        if (!window.location.hostname.includes("youtube.com") || !window.location.href.includes("/watch")) {
             significantChangeDetected = true;
        }
    }

    // Check if the title element has changed
    for(const mutation of mutationsList) {
         if (mutation.type === 'childList' || mutation.type === 'characterData') {
             // Check if the mutation happened on or inside the title element
             const targetIsTitleRelated = mutation.target.matches?.(YT_TITLE_SELECTOR) ||
                                       mutation.target.closest?.(YT_TITLE_SELECTOR);

             if (targetIsTitleRelated) {
                console.log("CS Observer: Title-related mutation detected.");
                titleChanged = true;
                break;
             }
        }
    }

    // This is the new logic:
    // On YouTube, we ONLY send a message if the title has changed.
    // This solves the race condition.
    if (window.location.hostname.includes("youtube.com") && window.location.href.includes("/watch")) {
        if (titleChanged) {
            console.log("CS Observer: YouTube title changed, triggering check.");
            sendMessageIfNeeded();
        }
    } else if (significantChangeDetected) {
        // For all other pages, send on URL change.
        console.log("CS Observer: Non-YT change confirmed, triggering check.");
        sendMessageIfNeeded();
    }
}

// --- Setup Mutation Observer ---
function setupPageObserver() {
    if (pageObserver) { pageObserver.disconnect(); }
    const targetNode = document.querySelector('ytd-page-manager') || document.getElementById('content') || document.body;
    if (!targetNode) {
        console.warn("CS Observer: Target node not found. Retrying...");
        setTimeout(setupPageObserver, 1000); return;
    }
    const config = { childList: true, subtree: true, characterData: true, attributes: false }; // Don't need attributes now
    pageObserver = new MutationObserver(handlePageMutation);
    pageObserver.observe(targetNode, config);
    console.log("CS Observer: Now observing page changes on:", targetNode.tagName);
}

// --- Initial Run and SPA Navigation Listeners ---
async function runInitialSetup() { // Make async
    console.log("Running initial setup...");
     lastProcessedUrl = '';
    await sendMessageIfNeeded(); // Await initial check (includes delay)
    setupPageObserver();
}

// Start initial setup
if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(runInitialSetup, 500);
} else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(runInitialSetup, 500));
}

// Keep history listeners
window.addEventListener('popstate', runInitialSetup); // Re-run setup on history change
window.addEventListener('hashchange', runInitialSetup);
(function(history){
    var pushState = history.pushState; var replaceState = history.replaceState;
    history.pushState = function(state) { console.log("CS: pushState"); runInitialSetup(); return pushState.apply(history, arguments); };
    history.replaceState = function(state) { console.log("CS: replaceState"); runInitialSetup(); return replaceState.apply(history, arguments); };
})(window.history);

console.log("CONTENT SCRIPT: Initial execution finished, listeners & observer active.");