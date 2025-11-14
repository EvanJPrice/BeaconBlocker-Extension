// content-script.js (v23 - Cleaned Shorts Session Logic)
console.log("CONTENT SCRIPT INJECTED");

let storedSearchQuery = null;
let lastProcessedVideoID = ""; 
let lastSentTitle = ""; 

// Helper: Get Video ID (Fixed for Shorts, Reels, TikTok)
function getVideoID(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname;
        const pathname = urlObj.pathname;

        // 1. YouTube Watch
        if (hostname.includes('youtube.com') && pathname.includes('/watch')) {
            return urlObj.searchParams.get('v');
        }
        
        // 2. YouTube Shorts
        if (hostname.includes('youtube.com') && pathname.startsWith('/shorts/')) {
            return pathname.split('/')[2]; // /shorts/VIDEO_ID
        }
        
        // 3. Instagram Reels
        if (hostname.includes('instagram.com') && pathname.startsWith('/reels/')) {
            return pathname.split('/')[2]; // /reels/VIDEO_ID
        }

        // 4. TikTok
        if (hostname.includes('tiktok.com')) {
            // URL is often /@username/video/VIDEO_ID
            const parts = pathname.split('/');
            if (parts[2] === 'video' && parts[3]) {
                return parts[3];
            }
        }
        
        // Fallback: return the full URL
        return url; 
    } catch (e) { return url; }
}

// --- STORAGE HELPERS ---
async function getSearchContext() {
    try {
        const data = await chrome.storage.local.get('searchContext');
        if (data.searchContext) {
            const { query, timestamp } = data.searchContext;
            if (Date.now() - timestamp < 300000) return query;
        }
    } catch (e) {}
    return null;
}

async function saveSearchContext(query) {
    if (!query) return;
    try {
        // FIX: Corrected typo Date.Dnow() -> Date.now()
        await chrome.storage.local.set({
            'searchContext': { query: query, timestamp: Date.now() } 
        });
    } catch (e) {}
}

async function clearSearchContext() {
    storedSearchQuery = null; 
    try { await chrome.storage.local.remove('searchContext'); } catch (e) {}
}

// --- 1. The Data Scraper (v25 - Shorts Session Logic) ---
async function getPageData() {
    const url = window.location.href;
    let title = "";
    let h1 = "";
    let bodyText = "";
    let currentSearchQuery = null;

    // --- YOUTUBE SPECIFIC ---
    if (url.includes('youtube.com')) {
        
        // A. WATCH PAGE
        if (url.includes('/watch')) {
            // Tell background we are ENDING any active shorts session
            chrome.runtime.sendMessage({ type: 'LOG_SHORTS_EVENT', isEnteringShorts: false });

            const possibleSelectors = [
                'ytd-watch-metadata h1.ytd-watch-metadata', 
                '#title > h1 > yt-formatted-string',
                'h1.title'
            ];
            
            let foundH1 = false;
            for (const sel of possibleSelectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim().length > 0) {
                    const text = el.textContent.trim();
                    if (!text.endsWith('- YouTube')) {
                        h1 = text; title = h1; foundH1 = true; break; 
                    }
                }
            }
            if (!foundH1) return null;

            const ytDesc = document.querySelector('#description-inline-expander');
            if (ytDesc) bodyText = ytDesc.innerText.replace(/\s+/g, ' ').trim().substring(0, 500);
        
        // B. SHORTS / REELS / TIKTOK PAGE
        } else if (
            url.includes('/shorts/') || 
            url.includes('/reels/') || 
            url.includes('tiktok.com')
        ) {
            // Tell background we are STARTING or CONTINUING a shorts session
            chrome.runtime.sendMessage({ type: 'LOG_SHORTS_EVENT', isEnteringShorts: true });
            
            // Return a special flag to stop further processing in runCheck
            return { isShortsHandled: true };
        
        // C. SEARCH PAGE
        } else if (url.includes('/results')) {
            chrome.runtime.sendMessage({ type: 'LOG_SHORTS_EVENT', isEnteringShorts: false });
            try {
                const urlObj = new URL(url);
                currentSearchQuery = urlObj.searchParams.get('search_query');
                if (!currentSearchQuery) return null; 
            } catch (e) {}
        } else {
            // Home/Channel
            chrome.runtime.sendMessage({ type: 'LOG_SHORTS_EVENT', isEnteringShorts: false });
            title = document.title || "YouTube";
        }
    } else {
        // Non-YT
        chrome.runtime.sendMessage({ type: 'LOG_SHORTS_EVENT', isEnteringShorts: false });
        title = (document.title || '').trim();
        h1 = (document.querySelector('h1')?.textContent || '').trim();
    }

    // --- Standard Logic continues... ---
    if (!h1 && !url.includes('youtube.com')) h1 = (document.querySelector('h1')?.textContent || '').trim();
    if (!bodyText && !url.includes('youtube.com')) bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim().substring(0, 500);
    if (!title) title = h1; 

    let description = (document.querySelector('meta[name="description"]')?.content || '').trim();
    let keywords = (document.querySelector('meta[name="keywords"]')?.content || '').trim();

    if (!currentSearchQuery) {
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes("google.") || urlObj.hostname.includes("bing.")) {
                currentSearchQuery = urlObj.searchParams.get('q');
            }
        } catch (e) {}
    }

    if (currentSearchQuery) await saveSearchContext(currentSearchQuery);
    let queryToSend = currentSearchQuery;
    if (!queryToSend) queryToSend = await getSearchContext();
    if ((!title && !h1) || !url.startsWith('http')) return null;

    return { title, description, h1, url, keywords, bodyText, searchQuery: queryToSend };
}

// --- 2. The Check Runner ---
let checkTimeout = null;

async function runCheck() {
    const currentUrl = window.location.href;
    const currentVideoID = getVideoID(currentUrl);

    if (checkTimeout) clearTimeout(checkTimeout);

    // 1. STRICT LOCK
    if (currentVideoID === lastProcessedVideoID && lastSentTitle !== "") return;

    console.log("Processing:", currentUrl);

    let attempts = 0;
    const maxAttempts = 20; 

    const attemptScrape = async () => {
        attempts++;
        const pageData = await getPageData();
        
        // --- NEW: Check if Shorts logic handled this ---
        if (pageData && pageData.isShortsHandled) {
            console.log("Shorts session logic handled.");
            lastProcessedVideoID = currentVideoID;
            lastSentTitle = "Short-form Video"; // Set generic lock
            
            // We still send a check to the server to see if the "Shorts"
            // category is hard-blocked.
            chrome.runtime.sendMessage({ 
                type: 'PAGE_DATA_RECEIVED', 
                data: { url: currentUrl, title: "Short-form Video" } 
            });
            return; // Stop here
        }

        const isFresh = pageData && 
                       (pageData.title !== "YouTube") && 
                       (pageData.title !== lastSentTitle || attempts >= maxAttempts);

        if (isFresh) {
            const candidateTitle = pageData.title;
            setTimeout(async () => {
                const doubleCheckData = await getPageData();
                if (doubleCheckData && doubleCheckData.title === candidateTitle) {
                    console.log(`Sending Verified Data:`, candidateTitle);
                    lastProcessedVideoID = currentVideoID;
                    lastSentTitle = candidateTitle;
                    chrome.runtime.sendMessage({ type: 'PAGE_DATA_RECEIVED', data: pageData });
                    if (pageData.searchQuery && !currentUrl.includes('/results') && !currentUrl.includes('google.')) {
                         await clearSearchContext();
                    }
                } else {
                    console.log("Title flickered! Retrying...");
                    checkTimeout = setTimeout(attemptScrape, 250);
                }
            }, 250);
        } else {
            checkTimeout = setTimeout(attemptScrape, 500); 
        }
    };

    attemptScrape();
}

// --- 3. Triggers ---
setTimeout(runCheck, 500); 

document.addEventListener('yt-navigate-finish', () => {
    runCheck();
});

let lastUrlObserver = window.location.href;
new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrlObserver) {
        lastUrlObserver = currentUrl;
        runCheck(); 
    }
}).observe(document.body, { childList: true, subtree: true });