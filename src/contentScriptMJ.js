const isIncognitoMode = chrome.extension.inIncognitoContext;
const facilityIDKey = isIncognitoMode ? 'facilityID-incognito' : 'facilityID';
const stateKey = isIncognitoMode ? 'state-incognito' : 'state';
let currentUrl = window.location.href;
chrome.storage.local.get(stateKey).then(state => {
    if (state['state'] !== 'await activation') {
        // Inject script into MJ page to extend xhttp requests so we can grab response data for processing
        if (currentUrl.indexOf('mjplatform.com') !== -1) {
            var s = document.createElement('script');
            s.src = chrome.runtime.getURL('injectMJ.js');
            s.onload = function () {
                this.remove();
            };
            (document.head || document.documentElement).appendChild(s);
        }
    }
})

// default options before loading from storage
let options = { 'autocert': false }
let limitationsToIgnore = ['None','none','no'];

// Await document load
document.addEventListener('DOMContentLoaded', function () {
    // After page load
    chrome.runtime.onMessage.addListener(handleStateChange);
    chrome.storage.local.get(stateKey).then(state => {
        if (state['state'] !== 'await activation') {
            main();
        }
    })
});

async function handleStateChange(message) {
    if (message.messageFunction === 'activate') {
        window.location.reload();
    }
}

async function main() {
    // wake up background service worker in case it was asleep
    await sendHeartbeat();
    // add listener for internal messages
    chrome.runtime.onMessage.addListener(handleInternalMessage);
    // send heartbeat to service worker every 25 seconds to keep it from going inactive
    setInterval(sendHeartbeat, 25000);
    // function definitions
    function handleInternalMessage(message, sender, sendResponse) {
        console.log('contentScriptMJ received message for: ' + message.messageFunction);
        switch (message.messageFunction) {
            case 'MJGetStateID':
                getStateID(message);
                break;
            case 'MJGetTransactions':
                getMJTransactions();
                break;
            default:
                sendResponse(sendResponse({ success: false }));
        }
        sendResponse({ success: true });
        // function definitions
        function getStateID(message) {
            if (currentUrl.indexOf('app.mjplatform.com/patients') !== -1) {
                let searchBoxClass = document.getElementsByClassName('form-control');
                let searchBox = searchBoxClass[0];
                if (searchBoxClass && searchBox) {
                    // only run if on correct page and elements exit
                    searchBox.value = message.searchTextforMJ;
                    searchBox.dispatchEvent(new Event('change', {bubbles: true}));
                }
                sendResponse({'Content Script getStateID':'success'});
            } else {
                sendResponse({ 'MJGetStateID': 'failed: not on correct page' });
            }
        }
        function getMJTransactions() {
            if (currentUrl.indexOf('app.mjplatform.com/retail/sales-report/transactions') !== -1) {
                let searchBoxClass = document.getElementsByClassName('submit-button');
                let searchBox = searchBoxClass[0];
                if (searchBoxClass && searchBox) {
                    // only run if on correct page and elements exit
                    searchBox.click();
                }
                sendResponse({'Content Script getMJTransactions':'success'});
            } else {
                sendResponse({ 'getMJTransactions': 'failed: not on correct page' });
            }
        }
    }
    function sendHeartbeat() {
        currentUrl = window.location.href;
        let message = {
            'message': 'heartbeat',
            'messageSender': 'MJ content script',
            'url': currentUrl,
            'timeStamp': Date.now()
        };
        try {
            chrome.runtime.sendMessage(message, function (response) {
                if (chrome.runtime.lastError) {
                    // reload page if can't send message to background service worker
                    console.log(
                        'Error sending heartbeat from content script: ',
                        chrome.runtime.lastError.message,
                    );
                } else if (response) {
                    console.info('heartbeat heard: ', response);
                }
            });
        }
        catch (e) {
            console.log('error sending heartbeat: ', e);
        }
    }
}