let currentUrl = window.location.href;
// Inject script into MJ page to extend xhttp requests so we can grab response data for processing
if (currentUrl.indexOf('mjplatform.com') !== -1) {
    var s = document.createElement('script');
    s.src = chrome.runtime.getURL('injectMJ.js');
    s.onload = function () {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(s);
}
// Await page load
document.addEventListener('DOMContentLoaded', function () {
    // After page load
    currentUrl = window.location.href;
    main();
});

async function main() {
    // wake up background service worker in case it was asleep
    await chrome.runtime.sendMessage({ message: 'wakeup' }, function (response) {
        if (chrome.runtime.lastError) {
            // no need to warn, just sending wakeup in case it's inactive
            console.log( 'wakeup not received by background.js ', chrome.runtime.lastError.message );
        } else if (response) {
            console.info('wakeup sent: ', response);
        }
    });
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
    }
    function sendHeartbeat() {
        let message = {
            'message': 'heartbeat',
            'messageSender': 'MJ content script'
        };
        try {
            chrome.runtime.sendMessage(message, function (response) {
                if (chrome.runtime.lastError) {
                    // reload page if can't send message to background service worker
                    console.log(
                        'Error sending heartbeat from content script: ',
                        chrome.runtime.lastError.message,
                    );
                    window.location.reload();
                } else if (response) {
                    console.info('heartbeat heard: ', response);
                }
            });
        }
        catch (e) {
            // reload page if can't send heartbeat
            console.log('error sending heartbeat: ', e);
            window.location.reload();
        }
    }
}