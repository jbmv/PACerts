// offscreen.js
const audio = document.getElementById('audioPlayer');

chrome.runtime.onMessage.addListener(async (message) => {
    if (message.type === 'play-sound') {
        audio.src = chrome.runtime.getURL(`sounds/${message.sound}`);
        audio.play();
    }
});